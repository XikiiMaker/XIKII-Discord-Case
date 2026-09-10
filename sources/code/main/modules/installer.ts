import { app } from "electron/main";
import { spawnSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

/** Return null for ordinary launches, including Squirrel's post-install first run. */
export function handleInstallerEvent(): number | null {
  if (process.platform !== "win32") return null;
  const event = process.argv[1];
  if (event === "--squirrel-obsolete") return 0;
  if (event !== "--squirrel-install" && event !== "--squirrel-updated" && event !== "--squirrel-uninstall") return null;

  const folder = dirname(process.execPath);
  const root = resolve(folder, "..");
  const updater = resolve(root, "Update.exe");
  // Only the updater beside this Squirrel installation may modify its shortcuts.
  if (!/^app-\d/.test(basename(folder)) || !existsSync(updater)) {
    console.error("安装程序目录无效，无法更新快捷方式。");
    return 1;
  }
  let cleanupFailed = false;
  if (event === "--squirrel-uninstall") {
    try {
      app.setLoginItemSettings({
        name: "XIKII Discord Case", path: resolve(root, basename(process.execPath)),
        args: ["--start-minimized"], openAtLogin: false, enabled: false
      });
    } catch {
      cleanupFailed = true;
      console.error("无法移除开机启动项。");
    }
  }
  const result = spawnSync(updater, [
    event === "--squirrel-uninstall" ? "--removeShortcut" : "--createShortcut",
    basename(process.execPath)
  ], { windowsHide: true, timeout: 10000, stdio: "ignore" });
  if (result.error || result.status !== 0 || cleanupFailed) {
    console.error("安装快捷方式处理未完成，请重试安装或卸载。");
    return 1;
  }
  return 0;
}
