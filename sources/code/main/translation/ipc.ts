import { ipcMain, net, app } from "electron/main";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { conversation, isRecord, parseRequest, ruleFor, isLanguage } from "../../common/translation";
import type { Reply } from "../../common/translation";
import { TranslationEngine } from "./engine";
import { TranslationStore } from "./store";

const mainWindows = new Set<Electron.BrowserWindow>();
const settingsWindows = new Set<Electron.BrowserWindow>();
let store: TranslationStore | undefined;
let registered = false;
const engine = new TranslationEngine((url, init) => net.fetch(url, init));
function config() { return store ??= new TranslationStore(); }
function owner(event: Electron.IpcMainInvokeEvent, windows: Set<Electron.BrowserWindow>) {
  for (const win of windows)
    if (!win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame) return win;
  throw new Error("未授权的翻译请求。");
}
function mainOwner(event: Electron.IpcMainInvokeEvent) {
  const win = owner(event, mainWindows);
  if (new URL(event.senderFrame?.url ?? "about:blank").origin !== "https://discord.com") throw new Error("翻译仅支持 Discord 主页面。");
  return win;
}
function changed() {
  engine.clear();
  for (const win of mainWindows) if (!win.isDestroyed()) win.webContents.send("translation:changed");
}
function handle(name: string, callback: (event: Electron.IpcMainInvokeEvent, input: unknown) => unknown) {
    ipcMain.handle(`translation:${name}`, async (event, input: unknown): Promise<Reply<unknown>> => {
      try { return { ok: true, value: await callback(event, input) }; }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : "翻译操作失败。" }; }
    });
}
function register() {
  if (registered) return;
  registered = true;
  function settingsOwner(event: Electron.IpcMainInvokeEvent) {
    owner(event, settingsWindows);
    if (event.senderFrame?.url !== pathToFileURL(resolve(app.getAppPath(), "sources/assets/web/html/settings.html")).href)
      throw new Error("设置页面来源无效。");
  }
  handle("state", (event) => { mainOwner(event); return config().state(); });
  handle("settings", (event) => { settingsOwner(event); return config().state(); });
  handle("save", (event, input) => {
    settingsOwner(event);
    if (!isRecord(input)) throw new Error("设置格式无效。");
    if (!isRecord(input['settings'])) throw new Error("设置格式无效。");
    const state = config().save({ ...input['settings'], channels: config().settings.channels }, input['key']);
    changed(); return state;
  });
  handle("clear-cache", (event) => { settingsOwner(event); engine.clear(); return true; });
  handle("conversation", (event, input) => {
    const win = mainOwner(event);
    const current = conversation(win.webContents.getURL());
    if (!current || !isRecord(input) || input['id'] !== current.id || typeof input['enabled'] !== "boolean" || !isLanguage(input['target'])) throw new Error("会话已变化，请重试。");
    const settings = structuredClone(config().settings);
    settings.channels[current.id] = { enabled: input['enabled'], target: input['target'] };
    const state = config().save(settings);
    changed(); return state;
  });
  handle("translate", async (event, input) => {
    const win = mainOwner(event);
    const current = conversation(win.webContents.getURL());
    if (!current || !isRecord(input) || input['id'] !== current.id) throw new Error("会话已变化。");
    const settings = structuredClone(config().settings);
    const rule = ruleFor(settings, current);
    if (!rule.enabled) throw new Error("本会话翻译未开启，请检查翻译设置。");
    if (input['direction'] !== "incoming" && input['direction'] !== "outgoing") throw new Error("翻译方向无效。");
    const request = parseRequest(input);
    request.target = input['direction'] === "incoming" ? "zh" : rule.target;
    const text = await engine.translate(request, settings, config().key());
    if (win.isDestroyed() || conversation(win.webContents.getURL())?.id !== current.id) throw new Error("会话已切换，已丢弃译文。");
    return text;
  });
  // Isolated preload selects only the unchanged composer before asking Electron to insert.
  handle("insert", async (event, input) => {
    const win = mainOwner(event);
    const current = conversation(win.webContents.getURL());
    if (!current || !isRecord(input) || input['id'] !== current.id || typeof input['text'] !== "string" || input['text'].length > 8000 || !input['text'].trim()) throw new Error("会话或译文无效。");
    if (!ruleFor(config().settings, current).enabled) throw new Error("翻译已关闭。");
    await win.webContents.insertText(input['text']);
    return true;
  });
  handle("send", (event, input) => {
    const win = mainOwner(event);
    const current = conversation(win.webContents.getURL());
    if (!current || !isRecord(input) || input['id'] !== current.id || !ruleFor(config().settings, current).enabled) throw new Error("会话已变化或翻译已关闭。");
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
    return true;
  });
}
export function attachTranslation(win: Electron.BrowserWindow, settings = false) {
  register();
  const windows = settings ? settingsWindows : mainWindows;
  windows.add(win);
  win.once("closed", () => { windows.delete(win); if (!settings) engine.clear(); });
}
