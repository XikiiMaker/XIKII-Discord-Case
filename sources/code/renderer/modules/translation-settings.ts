import { ipcRenderer as ipc } from "electron/renderer";
import { languages } from "../../common/translation";
import type { Reply, TranslationState, TranslationSettings } from "../../common/translation";

export async function renderTranslationSettings() {
  const existing = document.createElement("section"); existing.id = "webcord-client-settings";
  existing.append(...document.body.childNodes); document.body.append(existing);
  const section = document.createElement("section");
  section.id = "xikii-translation-settings";
  const heading = document.createElement("h1"); heading.textContent = "翻译设置 · Qwen";
  const status = document.createElement("p"); status.setAttribute("role", "status");
  section.append(heading, status);
  document.body.prepend(section);
  const tabs = document.createElement("nav"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "客户端设置分类"); tabs.className = "xikii-settings-tabs";
  for (const [id, label, panel] of [["translation", "翻译设置", section], ["client", "客户端设置", existing]] as const) {
    const tab = document.createElement("button"); tab.type = "button"; tab.id = `settings-tab-${id}`;
    tab.textContent = label; tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", panel.id);
    tab.setAttribute("aria-selected", String(panel === section));
    panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", tab.id); panel.hidden = panel !== section;
    tab.addEventListener("click", () => {
      section.hidden = panel !== section; existing.hidden = panel !== existing;
      for (const item of tabs.querySelectorAll("button")) item.setAttribute("aria-selected", String(item === tab));
    });
    tabs.append(tab);
  }
  document.body.prepend(tabs);
  const response = await ipc.invoke("translation:settings") as Reply<TranslationState>;
  if (!response.ok) { status.textContent = response.error; return; }
  let state = response.value;
  const form = document.createElement("form"); form.className = "xikii-settings-form";
  const notice = document.createElement("p");
  notice.textContent = "启用后，本会话的消息将发送至阿里云翻译；打开上下文后也会发送最近 N 条对话。API Key 仅保存在本机安全存储。群聊中对方收到的是你选定语言的消息。";
  form.append(notice);
  function field(label: string, input: HTMLElement) {
    const row = document.createElement("label"); row.className = "xikii-settings-field";
    const span = document.createElement("span"); span.textContent = label;
    row.append(span, input); form.append(row); return input;
  }
  function checkbox(label: string, checked: boolean) {
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = checked;
    field(label, input); return input;
  }
  function text(label: string, value: string, type = "text") {
    const input = document.createElement("input"); input.type = type; input.value = value;
    field(label, input); return input;
  }
  function select(label: string, choices: Record<string, string>, value: string) {
    const input = document.createElement("select");
    for (const [id, name] of Object.entries(choices)) { const option = document.createElement("option"); option.value = id; option.textContent = name; input.append(option); }
    input.value = value; field(label, input); return input;
  }
  const consent = checkbox("我同意将消息发送至阿里云，启用翻译", state.settings.consent);
  const dm = checkbox("私信默认开启翻译（含群组私信）", state.settings.dmEnabled);
  const auto = checkbox("自动发送译文（关闭时先预览）", state.settings.sendMode === "auto");
  const showOriginal = checkbox("保留接收消息原文（关闭后仅显示成功译文）", state.settings.showOriginal);
  const streaming = checkbox("流式显示翻译进度（完整译文校验通过后才能发送）", state.settings.streaming);
  const target = select("默认发送语言", languages, state.settings.target);
  const region = select("API 地域（必须与 Key 所属地域一致）", { china: "中国内地 · dashscope.aliyuncs.com", singapore: "新加坡 · dashscope-intl.aliyuncs.com", us: "美国 · dashscope-us.aliyuncs.com" }, state.settings.region);
  const model = text("模型（qwen-turbo / qwen-plus / qwen-max 或可用 Qwen 模型 ID）", state.settings.model);
  model.required = true;
  const key = text("DashScope API Key（留空保留现有 Key）", "", "password"); key.autocomplete = "off";
  key.placeholder = state.hasKey ? "已安全保存" : "尚未配置"; key.disabled = !state.encryptionAvailable;
  const context = text("上下文条数（0 = 关闭，最多 10）", String(state.settings.contextCount), "number"); context.min = "0"; context.max = "10";
  const concurrency = text("并发请求（1–4）", String(state.settings.concurrency), "number"); concurrency.min = "1"; concurrency.max = "4";
  const cache = text("内存缓存条数（0–2000，30 分钟过期）", String(state.settings.cacheSize), "number"); cache.min = "0"; cache.max = "2000";
  const save = document.createElement("button"); save.type = "submit"; save.textContent = "保存翻译设置";
  const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "删除已保存的 Key";
  const clear = document.createElement("button"); clear.type = "button"; clear.textContent = "清空翻译缓存";
  form.append(save, remove, clear); section.append(form);
  if (!state.encryptionAvailable) status.textContent = "系统安全存储不可用，无法保存或使用 API Key。";
  let saving = false;
  async function persist(removeKey = false) {
    if (saving) return;
    saving = true; save.disabled = remove.disabled = true;
    try {
      const settings: TranslationSettings = { ...state.settings, consent: consent.checked, dmEnabled: dm.checked,
        sendMode: auto.checked ? "auto" : "preview", target: target.value as TranslationSettings['target'],
        region: region.value as TranslationSettings['region'], model: model.value.trim(),
        contextCount: Number(context.value), concurrency: Number(concurrency.value), cacheSize: Number(cache.value),
        showOriginal: showOriginal.checked, streaming: streaming.checked };
      const result = await ipc.invoke("translation:save", { settings, ...(removeKey ? { key: "" } : key.value.trim() ? { key: key.value.trim() } : {}) }) as Reply<TranslationState>;
      if (!result.ok) throw new Error(result.error);
      state = result.value; key.value = ""; key.placeholder = state.hasKey ? "已安全保存" : "尚未配置";
      status.textContent = removeKey ? "API Key 已删除。" : "设置已保存，立即生效。";
    } catch (error) { status.textContent = error instanceof Error ? error.message : "保存失败。"; }
    finally { saving = false; save.disabled = remove.disabled = false; }
  }
  form.addEventListener("submit", (event) => { event.preventDefault(); if (event.isTrusted) void persist(); });
  remove.addEventListener("click", (event) => { if (event.isTrusted) void persist(true); });
  clear.addEventListener("click", (event) => { if (event.isTrusted) void ipc.invoke("translation:clear-cache").then(() => { status.textContent = "内存缓存已清空。"; }); });
}
