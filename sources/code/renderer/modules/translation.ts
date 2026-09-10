import { ipcRenderer as ipc } from "electron/renderer";
import { conversation, isRecord, languages, ruleFor } from "../../common/translation";
import type { Reply, TranslationState } from "../../common/translation";
import { composerSelector, conversationMessages, messageText, messageId, draftText, plainComposer } from "./discord-translation-dom";
import { ConversationContext } from "../../common/translation-context";

const nodes = () => conversationMessages(document, conversation(location.href)?.id ?? "0");
async function invoke<T>(name: string, input?: unknown): Promise<T> {
  const result = await ipc.invoke(`translation:${name}`, input) as Reply<T>;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

export function startTranslation() {
  if (location.origin !== "https://discord.com" || window !== window.top) return;
  let state: TranslationState | undefined;
  let route = "";
  let generation = 0;
  let busy = false;
  let replayUntil = 0;
  let dispatchingSend = false;
  let preview: { original: string; translated: string; editor: HTMLElement; id: string; generation: number } | undefined;
  let seen = new WeakMap<Element, string>();
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  const context = new ConversationContext();
  const progressListeners = new Map<string, (text: string) => void>();
  async function translate(input: Record<string, unknown>, progress: (text: string) => void) {
    const requestId = crypto.randomUUID();
    progressListeners.set(requestId, progress);
    try { return await invoke<string>("translate", { ...input, requestId }); }
    finally { progressListeners.delete(requestId); }
  }
  ipc.on("translation:progress", (_event, payload: unknown) => {
    if (isRecord(payload) && typeof payload['requestId'] === "string" && typeof payload['text'] === "string") progressListeners.get(payload['requestId'])?.(payload['text']);
  });
  const hiddenOriginals = new Map<HTMLElement, { display: string; priority: string }>();
  const host = document.createElement("div");
  host.id = "xikii-translation-toolbar";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = ':host{display:block;margin:8px 12px;font:13px system-ui;color:#eee} .bar{background:#23252d;border:1px solid #505667;border-radius:8px;padding:9px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}button,select{background:#343847;color:#fff;border:1px solid #697086;border-radius:5px;padding:5px 8px}button:disabled{opacity:.45}p{white-space:pre-wrap;max-height:180px;overflow:auto;margin:7px 0}';
  const bar = document.createElement("div"); bar.className = "bar";
  function button(text: string) { const node = document.createElement("button"); node.type = "button"; node.textContent = text; bar.append(node); return node; }
  const toggle = button("翻译关闭");
  const target = document.createElement("select"); target.setAttribute("aria-label", "本会话目标语言");
  for (const [value, label] of Object.entries(languages)) { const option = document.createElement("option"); option.value = value; option.textContent = label; target.append(option); }
  bar.append(target);
  const translateButton = button("翻译 / 预览");
  const send = button("发送译文"); send.hidden = true;
  const cancel = button("取消预览"); cancel.hidden = true;
  const status = document.createElement("span"); status.setAttribute("role", "status"); bar.append(status);
  const output = document.createElement("p"); output.hidden = true;
  shadow.append(style, bar, output);
  function errorText(error: unknown) { status.textContent = error instanceof Error ? error.message : "翻译失败，原文已保留。"; }
  function clearPreview() { preview = undefined; output.hidden = send.hidden = cancel.hidden = true; output.textContent = ""; }
  function showOriginal(node: Element) {
    if (!(node instanceof HTMLElement)) return;
    const saved = hiddenOriginals.get(node);
    if (!saved) return;
    if (saved.display) node.style.setProperty("display", saved.display, saved.priority); else node.style.removeProperty("display");
    hiddenOriginals.delete(node);
  }
  function hideOriginal(node: Element) {
    if (!(node instanceof HTMLElement) || hiddenOriginals.has(node)) return;
    hiddenOriginals.set(node, { display: node.style.getPropertyValue("display"), priority: node.style.getPropertyPriority("display") });
    node.style.setProperty("display", "none", "important");
  }
  function reset() {
    generation++; seen = new WeakMap(); clearPreview();
    progressListeners.clear();
    for (const node of hiddenOriginals.keys()) showOriginal(node);
    for (const node of document.querySelectorAll('[data-xikii-translation]')) node.remove();
  }
  async function refresh() {
    try { state = await invoke<TranslationState>("state"); context.clear(); reset(); scan(); }
    catch (error) { errorText(error); }
  }
  function enabled() {
    const current = conversation(location.href);
    return Boolean(current && state && state.hasKey && ruleFor(state.settings, current).enabled);
  }
  function scan() {
    const current = conversation(location.href);
    if (route !== location.pathname) { route = location.pathname; reset(); }
    if (!current) { host.remove(); return; }
    const editor = document.querySelector<HTMLElement>(composerSelector);
    const form = editor?.closest("form");
    if (form && host.nextElementSibling !== form) form.before(host);
    if (!state) return;
    for (const node of hiddenOriginals.keys()) if (!node.isConnected) hiddenOriginals.delete(node);
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href*="/channels/"]')) {
      if (anchor.closest('main, [role="main"], [id^="chat-messages-"]')) continue;
      const linked = conversation(anchor.href);
      if (!linked) continue;
      const badge = anchor.querySelector('[data-xikii-translation-badge]');
      if (!ruleFor(state.settings, linked).enabled) { badge?.remove(); continue; }
      if (!badge) {
        const icon = document.createElement("span"); icon.dataset['xikiiTranslationBadge'] = "true";
        icon.textContent = "译"; icon.title = "本会话已开启翻译"; icon.setAttribute("aria-label", icon.title);
        icon.style.cssText = 'margin-inline-start:6px;color:#a8b3ff;font-size:11px;border:1px solid currentColor;border-radius:3px;padding:0 3px';
        anchor.append(icon);
      }
    }
    const rule = ruleFor(state.settings, current);
    toggle.textContent = rule.enabled ? "翻译已开启" : "翻译已关闭";
    target.value = rule.target;
    translateButton.disabled = !enabled() || busy;
    if (!state.settings.consent) status.textContent = "请先到 文件 → 设置 → 翻译设置，确认启用。";
    else if (!state.hasKey) status.textContent = "请先在翻译设置中保存 API Key。";
    if (!enabled()) return;
    const all = nodes();
    if (state.settings.contextCount > 0) context.update(current.id, all.flatMap(node => {
      const id = messageId(node); return id ? [{ id, text: messageText(node) }] : [];
    }));
    // Only recently rendered messages, never request server history or hidden channels.
    for (const node of all.slice(-30)) {
      const rect = node.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) continue;
      const original = messageText(node);
      if (!original.trim() || seen.get(node) === original) continue;
      seen.set(node, original);
      showOriginal(node);
      const existing = node.nextElementSibling;
      if (existing?.hasAttribute("data-xikii-translation")) existing.remove();
      const translated = document.createElement("div"); translated.dataset['xikiiTranslation'] = "true";
      translated.style.cssText = 'white-space:pre-wrap;color:var(--text-muted,#aaa);font-size:0.9em;margin-top:5px;border-left:2px solid #7585ef;padding-left:8px';
      translated.textContent = "翻译中…"; node.after(translated);
      const version = generation;
      void translate({ id: current.id, direction: "incoming", text: original, target: "zh", context: context.before(current.id, messageId(node), state.settings.contextCount) }, partial => {
        if (version === generation && node.isConnected && messageText(node) === original) translated.textContent = partial || "翻译中…";
      }).then(text => {
        if (version !== generation || !node.isConnected || messageText(node) !== original) { translated.remove(); return; }
        if (text === original) translated.remove(); else {
          translated.textContent = text;
          if (state && !state.settings.showOriginal) hideOriginal(node);
        }
      }).catch(error => {
        if (version !== generation || !node.isConnected || messageText(node) !== original) { translated.remove(); return; }
        translated.textContent = (error instanceof Error ? error.message : "翻译失败") + " · 点击重试";
        translated.setAttribute("role", "button"); translated.tabIndex = 0;
        const retry = (event: Event) => { if (!event.isTrusted) return; seen.delete(node); translated.remove(); schedule(); };
        translated.addEventListener("click", retry, { once: true });
        translated.addEventListener("keydown", event => { if (event.key === "Enter") retry(event); });
      });
    }
  }
  function schedule() { if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = undefined; scan(); }, 150); }
  async function sendPreview() {
    const item = preview;
    if (!item || busy) return;
    if (!enabled() || generation !== item.generation || conversation(location.href)?.id !== item.id || !item.editor.isConnected || draftText(item.editor) !== item.original) {
      clearPreview(); status.textContent = "草稿、设置或会话已变化，请重新翻译。"; return;
    }
    busy = true;
    try {
      item.editor.focus();
      const selection = window.getSelection();
      if (!selection) throw new Error("无法选中输入框，草稿已保留。");
      const range = document.createRange(); range.selectNodeContents(item.editor); selection.removeAllRanges(); selection.addRange(range);
      await invoke("insert", { id: item.id, text: item.translated });
      if (generation !== item.generation || conversation(location.href)?.id !== item.id || !item.editor.isConnected || draftText(item.editor) !== item.translated) throw new Error("输入框或会话已变化，未自动发送，请检查草稿。");
      item.editor.focus();
      replayUntil = Date.now() + 1000;
      dispatchingSend = true;
      await invoke("send", { id: item.id });
      clearPreview(); status.textContent = "已触发发送，请以 Discord 消息状态为准。";
    } catch (error) { errorText(error); }
    finally { replayUntil = 0; dispatchingSend = false; busy = false; scan(); }
  }
  async function translateDraft() {
    if (busy || !state) return;
    if (!enabled()) { status.textContent = "请先在翻译设置中启用翻译并保存 API Key。原文未发送。"; return; }
    const current = conversation(location.href);
    const editor = document.querySelector<HTMLElement>(composerSelector);
    if (!current || !editor) return;
    if (!plainComposer(editor)) { status.textContent = "首版暂不自动处理提及或自定义表情输入块；可用 Ctrl+Enter 发送原文。"; return; }
    const original = draftText(editor);
    if (!original.trim()) return;
    clearPreview(); busy = true; status.textContent = "正在翻译，草稿会保留…"; translateButton.disabled = true;
    const version = generation;
    try {
      const translated = await translate({ id: current.id, direction: "outgoing", text: original,
        target: ruleFor(state.settings, current).target, context: context.before(current.id, null, state.settings.contextCount) }, partial => {
        if (version === generation && conversation(location.href)?.id === current.id && draftText(editor) === original) {
          output.textContent = partial; output.hidden = false;
        }
      });
      if (version !== generation || conversation(location.href)?.id !== current.id || !editor.isConnected || draftText(editor) !== original) throw new Error("草稿或会话已变化，译文未发送，请重新翻译。");
      preview = { original, translated, editor, id: current.id, generation: version };
      output.textContent = translated; output.hidden = send.hidden = cancel.hidden = false;
      status.textContent = "预览译文；点击发送译文确认。";
    } catch (error) { clearPreview(); errorText(error); }
    finally { busy = false; scan(); }
    if (preview && state.settings.sendMode === "auto") await sendPreview();
  }
  async function changeRule() {
    const current = conversation(location.href);
    if (!current || !state) return;
    if (!state.settings.consent) { status.textContent = "请先在客户端翻译设置中确认启用。"; return; }
    try { state = await invoke<TranslationState>("conversation", { id: current.id, enabled: !ruleFor(state.settings, current).enabled, target: target.value }); reset(); scan(); }
    catch (error) { errorText(error); }
  }
  toggle.addEventListener("click", event => { if (event.isTrusted) void changeRule(); });
  target.addEventListener("change", event => {
    const current = conversation(location.href);
    if (!event.isTrusted || !current || !state) return;
    void invoke<TranslationState>("conversation", { id: current.id, enabled: ruleFor(state.settings, current).enabled, target: target.value }).then(value => { state = value; reset(); scan(); }).catch(errorText);
  });
  translateButton.addEventListener("click", event => { if (event.isTrusted) void translateDraft(); });
  send.addEventListener("click", event => { if (event.isTrusted) void sendPreview(); });
  cancel.addEventListener("click", event => { if (event.isTrusted) { clearPreview(); status.textContent = "预览已取消，原文草稿保留。"; } });
  document.addEventListener("keydown", event => {
    if (event.isTrusted && event.ctrlKey && event.altKey && event.code === "KeyT") {
      event.preventDefault(); event.stopImmediatePropagation(); void changeRule(); return;
    }
    if (!event.isTrusted || event.key !== "Enter" || event.isComposing || event.keyCode === 229 || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof HTMLElement) || !event.target.closest(composerSelector)) return;
    if (replayUntil > Date.now()) { replayUntil = 0; return; }
    const current = conversation(location.href);
    if (event.ctrlKey || event.metaKey || !current || !state || !ruleFor(state.settings, current).enabled) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void translateDraft();
  }, true);
  // Discord can also submit from a visible send button. Catch native form submits
  // and the known accessible button names; never intercept attachment controls.
  function interceptSubmit(event: Event) {
    if (!event.isTrusted || dispatchingSend || replayUntil > Date.now()) return;
    const current = conversation(location.href);
    const editor = document.querySelector<HTMLElement>(composerSelector);
    if (!current || !state || !editor || !ruleFor(state.settings, current).enabled) return;
    const form = editor.closest("form");
    if (!(event.target instanceof Element) || !form?.contains(event.target)) return;
    if (event.type === "click") {
      const submitControl = event.target.closest('button, [role="button"]');
      if (!submitControl || !(submitControl.getAttribute("type") === "submit" || /^(send|send message|发送|发送消息)$/i.test(submitControl.getAttribute("aria-label") ?? ""))) return;
    }
    event.preventDefault(); event.stopImmediatePropagation(); void translateDraft();
  }
  document.addEventListener("submit", interceptSubmit, true);
  document.addEventListener("click", interceptSubmit, true);
  document.addEventListener("contextmenu", event => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>('a[href*="/channels/"]');
    if (!anchor || anchor.closest('[id^="chat-messages-"]') || !conversation(anchor.href)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void invoke("context-menu", { url: anchor.href }).catch(errorText);
  }, true);
  document.addEventListener("input", event => { if (preview && event.target instanceof Node && preview.editor.contains(event.target) && !busy) clearPreview(); }, true);
  const observer = new MutationObserver(records => {
    if (records.some(record => !(record.target instanceof Element && (record.target.closest('[data-xikii-translation], [data-xikii-translation-badge]') || record.target === host)))) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener("scroll", schedule, true);
  const routeTimer = setInterval(() => { if (route !== location.pathname) scan(); }, 500);
  ipc.on("translation:changed", () => { void refresh(); });
  window.addEventListener("beforeunload", () => { observer.disconnect(); context.clear(); clearInterval(routeTimer); if (scanTimer) clearTimeout(scanTimer); });
  void refresh();
}
