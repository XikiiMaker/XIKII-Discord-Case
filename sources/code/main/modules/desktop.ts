import { app, session, Notification } from "electron/main";
import { shell } from "electron/common";
import { basename, dirname, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { appConfig } from "./config";
import { getBuildInfo } from "../../common/modules/client";
import type { DesktopState } from "../../common/desktop";

const startupName = "XIKII Discord Case";
export function launcherPath(executable = process.execPath, exists = existsSync) {
  // Squirrel's stable launcher survives updates to app-<version> directories.
  const stub = resolve(dirname(executable), "..", basename(executable));
  return /^app-[\d.]+/.test(basename(dirname(executable))) && exists(stub) ? stub : executable;
}
function loginOptions() { return { path: launcherPath(), args: ["--start-minimized"] }; }
export function desktopState(): DesktopState {
  const startupSupported = process.platform === "win32" && app.isPackaged;
  const settings = appConfig.value.settings;
  const login = startupSupported ? app.getLoginItemSettings(loginOptions()) : null;
  return {
    startupSupported,
    openAtLogin: Boolean(login?.openAtLogin && login.launchItems.some(item => item.name === startupName && item.enabled)),
    notifications: settings.privacy.permissions.notifications,
    notificationSupported: Notification.isSupported(),
    flash: settings.general.taskbar.flash,
    persistentSession: session.defaultSession.storagePath !== null
  };
}
export function saveDesktop(input: unknown): DesktopState {
  if (typeof input !== "object" || input === null) throw new Error("客户端设置格式无效。");
  const data = input as Record<string, unknown>;
  if (typeof data['openAtLogin'] !== "boolean" || typeof data['flash'] !== "boolean" || !(data['notifications'] === null || typeof data['notifications'] === "boolean")) throw new Error("客户端设置格式无效。");
  if (process.platform === "win32" && app.isPackaged) {
    app.setLoginItemSettings({ ...loginOptions(), name: startupName, openAtLogin: data['openAtLogin'], enabled: data['openAtLogin'] });
    if (desktopState().openAtLogin !== data['openAtLogin']) throw new Error("Windows 未保存开机启动设置，请检查系统启动应用设置。");
  } else if (data['openAtLogin']) throw new Error("请在 Windows 打包版中设置开机启动。");
  const config = appConfig.value;
  config.settings.privacy.permissions.notifications = data['notifications'];
  config.settings.general.taskbar.flash = data['flash'];
  appConfig.value = config;
  return desktopState();
}

/** A matching Start Menu shortcut is required for Windows desktop notifications. */
export function ensureNotificationShortcut() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const directory = resolve(app.getPath("appData"), "Microsoft/Windows/Start Menu/Programs");
  mkdirSync(directory, { recursive: true });
  const shortcut = resolve(directory, `${startupName}.lnk`);
  const target = launcherPath();
  if (!shell.writeShortcutLink(shortcut, existsSync(shortcut) ? "update" : "create", {
    target, cwd: dirname(target), description: "XIKII Discord Case",
    appUserModelId: getBuildInfo().AppUserModelId ?? "XikiiMaker.DiscordCase"
  })) throw new Error("无法注册 Windows 通知快捷方式。");
}

/** Flush Chromium's existing persistent session; never read or store the password. */
export function installSessionPersistence() {
  let flushing = false, flushed = false;
  app.on("before-quit", event => {
    if (flushed) return;
    event.preventDefault();
    if (flushing) return;
    flushing = true;
    session.defaultSession.flushStorageData();
    const timeout = setTimeout(finish, 2000);
    function finish() { if (flushed) return; clearTimeout(timeout); flushed = true; app.quit(); }
    void session.defaultSession.cookies.flushStore().catch(() => {
      console.warn("保存登录会话时发生错误；下次启动可能需要重新登录。");
    }).finally(finish);
  });
}

const activeNotifications = new Set<Electron.Notification>();
export function testDesktopNotification(win: Electron.BrowserWindow | undefined): Promise<string> {
  if (!Notification.isSupported()) throw new Error("当前系统不支持桌面通知。");
  ensureNotificationShortcut();
  const notification = new Notification({ title: "XIKII Discord Case · 提醒测试", body: "新消息提醒测试。点击这条通知返回客户端。", silent: false });
  activeNotifications.add(notification);
  notification.on("click", () => { if (win && !win.isDestroyed()) { win.restore(); win.show(); win.focus(); } });
  notification.once("close", () => activeNotifications.delete(notification));
  return new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => resolveResult("已请求系统通知；请检查 Windows 通知中心及勿扰模式。"), 2500);
    notification.once("show", () => { clearTimeout(timer); resolveResult("系统已接收测试通知。请检查是否有横幅和声音，点击可返回客户端。"); });
    notification.once("failed", () => { clearTimeout(timer); activeNotifications.delete(notification); reject(new Error("Windows 拒绝显示通知，请检查系统通知权限。")); });
    notification.show();
  });
}
