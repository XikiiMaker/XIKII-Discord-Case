import { ipcRenderer as ipc } from "electron/renderer";
import { conversation, isRecord, ruleFor } from "../../common/translation";
import type { Reply, TranslationState } from "../../common/translation";
import { composerSelector, conversationMessages, messageText, messageId, draftText, plainComposer } from "./discord-translation-dom";
import { ConversationContext } from "../../common/translation-context";
import { syncTranslationToggles, createTranslationNotice, incomingTranslationStyle } from "./translation-ui";

async function invoke<T>(name: string, input?: unknown): Promise<T> {
  const result = await ipc.invoke(`translation:${name}`, input) as Reply<T>;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
export function startTranslation() {
  if (location.origin !== "https://discord.com" || window !== window.top) return;
  let state: TranslationState | undefined;
  let route = "", generation = 0, busy = false, writingDraft = false;
  let replayUntil = 0, dispatchingSend = false;
  let seen = new WeakMap<Element, string>();
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  const context = new ConversationContext();
  const notice = createTranslationNotice(document);
  const progressListeners = new Map<string, (text: string, provider?: string) => void>();
  const hiddenOriginals = new Map<HTMLElement, { display: string; priority: string }>();
  function errorText(error: unknown) { notice.show(error instanceof Error ? error.message : "翻译失败，草稿已保留。"); }
  async function translate(input: Record<string, unknown>, progress?: (text: string, provider?: string) => void) {
    const requestId = crypto.randomUUID();
    if (progress) progressListeners.set(requestId, progress);
    try { return await invoke<string>("translate", { ...input, requestId }); }
    finally { progressListeners.delete(requestId); }
  }
  ipc.on("translation:progress", (_event, payload: unknown) => {
    if (isRecord(payload) && typeof payload['requestId'] === "string" && typeof payload['text'] === "string")
      progressListeners.get(payload['requestId'])?.(payload['text'], typeof payload['provider'] === "string" ? payload['provider'] : undefined);
  });
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
  function invalidateSend() { generation++; busy = false; }
  function reset() {
    invalidateSend(); seen = new WeakMap(); progressListeners.clear(); notice.clear();
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
  async function toggleConversation(url: string) {
    try { state = await invoke<TranslationState>("toggle-conversation", { url }); reset(); scan(); }
    catch (error) { errorText(error); }
  }
  function scan() {
    const current = conversation(location.href);
    if (route !== location.pathname) { route = location.pathname; reset(); }
    if (!current || !state) return;
    syncTranslationToggles(document, state.settings, toggleConversation, busy ? current.id : undefined);
    for (const node of hiddenOriginals.keys()) if (!node.isConnected) hiddenOriginals.delete(node);
    if (!enabled()) return;
    const all = conversationMessages(document, current.id);
    if (state.settings.contextCount > 0) context.update(current.id, all.flatMap(node => {
      const id = messageId(node); return id ? [{ id, text: messageText(node) }] : [];
    }));
    for (const node of all.slice(-30)) {
      const rect = node.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) continue;
      const original = messageText(node);
      if (!original.trim() || seen.get(node) === original) continue;
      seen.set(node, original); showOriginal(node);
      const existing = node.nextElementSibling;
      if (existing?.hasAttribute("data-xikii-translation")) existing.remove();
      const translated = document.createElement("div"); translated.dataset['xikiiTranslation'] = "true";
      translated.lang = "zh-CN"; translated.style.cssText = incomingTranslationStyle;
      translated.textContent = "翻译中…"; node.after(translated);
      // Outgoing cancellation must not invalidate independent incoming messages.
      const currentRoute = location.pathname;
      void translate({ id: current.id, direction: "incoming", text: original, target: "zh", context: context.before(current.id, messageId(node), state.settings.contextCount) }, (partial, provider) => {
        if (translated.isConnected && location.pathname === currentRoute && messageText(node) === original) {
          translated.textContent = partial || (provider === "libretranslate" ? "备用引擎翻译中…" : "翻译中…");
          translated.title = provider === "libretranslate" ? "译文来自备用引擎 LibreTranslate" : "译文来自 Qwen";
        }
      }).then(text => {
        if (!translated.isConnected || location.pathname !== currentRoute || !node.isConnected || messageText(node) !== original) { translated.remove(); return; }
        if (text === original) translated.remove(); else {
          translated.textContent = text;
          if (state && !state.settings.showOriginal) hideOriginal(node);
        }
      }).catch(error => {
        if (!translated.isConnected || location.pathname !== currentRoute || !node.isConnected || messageText(node) !== original) { translated.remove(); return; }
        translated.textContent = (error instanceof Error ? error.message : "翻译失败") + " · 点击重试";
        translated.setAttribute("role", "button"); translated.tabIndex = 0;
        const retry = (event: Event) => { if (!event.isTrusted) return; seen.delete(node); translated.remove(); schedule(); };
        translated.addEventListener("click", retry, { once: true });
        translated.addEventListener("keydown", event => { if (event.key === "Enter") retry(event); });
      });
    }
  }
  function schedule() { if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = undefined; scan(); }, 150); }
  async function triggerSend(id: string, raw = false) {
    replayUntil = Date.now() + 1000; dispatchingSend = true;
    try { await invoke("send", { id, raw }); }
    finally { replayUntil = 0; dispatchingSend = false; }
  }
  async function sendRaw() {
    const current = conversation(location.href);
    if (!current) return;
    invalidateSend(); notice.clear();
    try { await triggerSend(current.id, true); }
    catch (error) { errorText(error); }
    finally { scan(); }
  }
  async function translateDraft() {
    if (busy) return;
    if (!state) { notice.show("正在加载翻译配置，请稍后重试；Ctrl+Enter 可发送原文。"); return; }
    if (!enabled()) { notice.show("请先在翻译设置中启用翻译并保存 API Key。草稿未发送。"); return; }
    const current = conversation(location.href);
    const editor = document.querySelector<HTMLElement>(composerSelector);
    if (!current || !editor) return;
    if (!plainComposer(editor)) { notice.show("提及或自定义表情输入块尚未适配；草稿已保留，可用 Ctrl+Enter 发送原文。"); return; }
    const original = draftText(editor);
    if (!original.trim()) return;
    busy = true; notice.clear(); scan();
    const version = generation;
    try {
      const translated = await translate({ id: current.id, direction: "outgoing", text: original, target: ruleFor(state.settings, current).target, context: context.before(current.id, null, state.settings.contextCount) });
      if (version !== generation) return;
      if (!enabled() || conversation(location.href)?.id !== current.id || !editor.isConnected || draftText(editor) !== original) throw new Error("草稿或会话已变化，未发送旧译文，请重新发送。");
      editor.focus();
      const selection = window.getSelection();
      if (!selection) throw new Error("无法选中输入框，草稿已保留。");
      const range = document.createRange(); range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range);
      writingDraft = true;
      try { await invoke("insert", { id: current.id, text: translated }); }
      finally { writingDraft = false; }
      if (version !== generation || conversation(location.href)?.id !== current.id || !editor.isConnected || draftText(editor) !== translated) throw new Error("输入框或会话已变化，未发送，请检查草稿。");
      editor.focus(); await triggerSend(current.id);
    } catch (error) { if (version === generation) errorText(error); }
    finally { if (version === generation) { busy = false; scan(); } }
  }
  document.addEventListener("keydown", event => {
    if (event.isTrusted && event.ctrlKey && event.altKey && event.code === "KeyT") {
      event.preventDefault(); event.stopImmediatePropagation(); void toggleConversation(location.href); return;
    }
    if (!event.isTrusted || event.key !== "Enter" || event.isComposing || event.keyCode === 229 || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof HTMLElement) || !event.target.closest(composerSelector)) return;
    if (replayUntil > Date.now()) { replayUntil = 0; return; }
    const current = conversation(location.href);
    if (!current) return;
    if (event.ctrlKey || event.metaKey) { event.preventDefault(); event.stopImmediatePropagation(); void sendRaw(); return; }
    if (state && !ruleFor(state.settings, current).enabled) return;
    event.preventDefault(); event.stopImmediatePropagation(); void translateDraft();
  }, true);
  function interceptSubmit(event: Event) {
    if (!event.isTrusted || dispatchingSend || replayUntil > Date.now()) return;
    const current = conversation(location.href), editor = document.querySelector<HTMLElement>(composerSelector);
    if (!current || !editor || (state && !ruleFor(state.settings, current).enabled)) return;
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
    event.preventDefault(); event.stopImmediatePropagation(); void invoke("context-menu", { url: anchor.href }).catch(errorText);
  }, true);
  document.addEventListener("input", event => {
    if (busy && !writingDraft && event.target instanceof Element && event.target.closest(composerSelector)) { invalidateSend(); schedule(); }
  }, true);
  const observer = new MutationObserver(records => {
    if (records.some(record => !(record.target instanceof Element && record.target.closest('[data-xikii-translation], [data-xikii-translation-toggle]')))) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener("scroll", schedule, true);
  const routeTimer = setInterval(() => { if (route !== location.pathname) scan(); }, 500);
  ipc.on("translation:changed", () => { void refresh(); });
  window.addEventListener("beforeunload", () => { observer.disconnect(); context.clear(); notice.destroy(); clearInterval(routeTimer); if (scanTimer) clearTimeout(scanTimer); });
  void refresh();
}
