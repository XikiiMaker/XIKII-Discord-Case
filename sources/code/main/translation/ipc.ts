import { ipcMain, net, app, Menu } from "electron/main";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { conversation, isRecord, parseRequest, ruleFor, languages } from "../../common/translation";
import type { Language } from "../../common/translation";
import type { Reply } from "../../common/translation";
import { TranslationEngine, sourceLanguageHint } from "./engine";
import { TranslationStore } from "./store";
import loadSettingsWindow from "../windows/settings";
import { desktopState, saveDesktop, testDesktopNotification } from "../modules/desktop";

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
  handle("desktop-state", event => { settingsOwner(event); return desktopState(); });
  handle("desktop-save", (event, input) => {
    settingsOwner(event);
    const state = saveDesktop(input);
    if (!state.flash) for (const win of mainWindows) if (!win.isDestroyed()) win.flashFrame(false);
    return state;
  });
  handle("desktop-test-notification", event => { settingsOwner(event); return testDesktopNotification([...mainWindows].find(win => !win.isDestroyed())); });
  handle("save", (event, input) => {
    settingsOwner(event);
    if (!isRecord(input)) throw new Error("设置格式无效。");
    if (!isRecord(input['settings'])) throw new Error("设置格式无效。");
    const state = config().save({ ...input['settings'], channels: config().settings.channels }, input['key'], input['fallbackKey']);
    changed(); return state;
  });
  handle("clear-cache", (event) => { settingsOwner(event); engine.clear(); return true; });
  handle("context-menu", (event, input) => {
    const win = mainOwner(event);
    if (!isRecord(input) || typeof input['url'] !== "string") throw new Error("会话链接无效。");
    const current = conversation(input['url']);
    if (!current) throw new Error("会话链接无效。");
    const rule = ruleFor(config().settings, current);
    const apply = (enabled: boolean) => {
      const next = structuredClone(config().settings);
      next.channels[current.id] = { enabled, target: rule.target };
      config().save(next); changed();
    };
    Menu.buildFromTemplate([
      { label: rule.enabled ? "关闭本会话翻译" : "开启本会话翻译", enabled: config().settings.consent && (!current.dm || config().settings.dmEnabled), click: () => apply(!rule.enabled) },
      { label: "使用默认会话设置", enabled: Object.hasOwn(config().settings.channels, current.id), click: () => {
        const next = structuredClone(config().settings); delete next.channels[current.id]; config().save(next); changed();
      } },
      { label: "发送语言", submenu: (Object.entries(languages) as [Language, string][]).map(([target, label]) => ({
        label, type: "radio", checked: rule.target === target, click: () => {
          const next = structuredClone(config().settings);
          next.channels[current.id] = { enabled: next.channels[current.id]?.enabled ?? current.dm, target };
          config().save(next); changed();
        }
      })) },
      { type: "separator" },
      { label: "翻译设置…", click: () => { loadSettingsWindow(win); } }
    ]).popup({ window: win });
    return true;
  });
  handle("toggle-conversation", (event, input) => {
    mainOwner(event);
    const current = isRecord(input) && typeof input['url'] === "string" ? conversation(input['url']) : null;
    if (!current) throw new Error("会话链接无效。");
    const settings = structuredClone(config().settings);
    if (!settings.consent) throw new Error("请先右键频道或私信，打开翻译设置并确认启用。");
    if (current.dm && !settings.dmEnabled) throw new Error("私信翻译已全局关闭，请先在翻译设置中开启。");
    const rule = ruleFor(settings, current);
    settings.channels[current.id] = { enabled: !rule.enabled, target: rule.target };
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
    if (sourceLanguageHint(request.text) === "other") {
      if (input['direction'] === "incoming") return request.text;
      throw new Error("这一版仅支持中英互译；其他语言请使用发送原文。");
    }
    request.target = input['direction'] === "incoming" ? "zh" : rule.target;
    const requestId = input['requestId'];
    if (requestId !== undefined && (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(requestId))) throw new Error("翻译请求标识无效。");
    const text = await engine.translate(request, settings, config().key(), (partial, provider) => {
      if (requestId && !win.isDestroyed() && conversation(win.webContents.getURL())?.id === current.id)
        win.webContents.send("translation:progress", { requestId, text: partial, provider });
    }, settings.fallback.enabled ? config().fallbackKey() : "");
    if (win.isDestroyed() || conversation(win.webContents.getURL())?.id !== current.id) throw new Error("会话已切换，已丢弃译文。");
    return text;
  });
  // Isolated preload selects only the unchanged composer before asking Electron to insert.
  handle("insert", async (event, input) => {
    const win = mainOwner(event);
    const current = conversation(win.webContents.getURL());
    if (!current || !isRecord(input) || input['id'] !== current.id || typeof input['text'] !== "string" || input['text'].length > 8000) throw new Error("会话或译文无效。");
    if (!ruleFor(config().settings, current).enabled) throw new Error("翻译已关闭。");
    if (input['text']) await win.webContents.insertText(input['text']);
    else {
      // Rich-text translation can remove a selected prose segment without touching a void node.
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Backspace" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Backspace" });
    }
    return true;
  });
  handle("send", (event, input) => {
    const win = mainOwner(event);
    const current = conversation(win.webContents.getURL());
    if (!current || !isRecord(input) || input['id'] !== current.id || (input['raw'] !== true && !ruleFor(config().settings, current).enabled)) throw new Error("会话已变化或翻译已关闭。");
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
