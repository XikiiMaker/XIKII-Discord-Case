import { ipcRenderer as ipc } from "electron/renderer";
import type { DesktopState } from "../../common/desktop";
import type { Reply } from "../../common/translation";

export async function renderDesktopSettings(parent: HTMLElement) {
  const section = document.createElement("section"); section.id = "xikii-desktop-settings";
  section.className = "xikii-settings-form";
  const heading = document.createElement("h1"); heading.textContent = "启动、登录与消息提醒";
  const note = document.createElement("p");
  note.textContent = "登录状态默认保存在本机，正常退出及升级后继续使用。无需另存密码；主动退出账号、会话过期或 Discord 安全验证时需要重新登录。";
  const status = document.createElement("p"); status.setAttribute("role", "status");
  section.append(heading, note, status); parent.prepend(section);
  const result = await ipc.invoke("translation:desktop-state") as Reply<DesktopState>;
  if (!result.ok) { status.textContent = result.error; return; }
  let state = result.value;
  const field = (label: string, input: HTMLElement) => {
    const row = document.createElement("label"); row.className = "xikii-settings-field";
    const text = document.createElement("span"); text.textContent = label; row.append(text, input); section.append(row);
  };
  const startup = document.createElement("input"); startup.type = "checkbox"; startup.id = "desktop-startup";
  startup.checked = state.openAtLogin; startup.disabled = !state.startupSupported;
  field("开机自动启动（登录 Windows 后启动到托盘）", startup);
  if (!state.startupSupported) { const tip = document.createElement("p"); tip.textContent = "开机启动请在 Windows 打包版中设置。"; section.append(tip); }
  const notifications = document.createElement("select"); notifications.id = "desktop-notifications";
  for (const [value, label] of [["ask", "首次使用时询问"], ["allow", "允许 Discord 桌面通知"], ["deny", "关闭 Discord 桌面通知"]]) {
    const option = document.createElement("option"); option.value = value ?? ""; option.textContent = label ?? ""; notifications.append(option);
  }
  notifications.value = state.notifications === null ? "ask" : state.notifications ? "allow" : "deny";
  field("桌面通知权限", notifications);
  const flash = document.createElement("input"); flash.type = "checkbox"; flash.id = "desktop-flash"; flash.checked = state.flash;
  field("收到提及或私信时闪烁任务栏（窗口在后台时）", flash);
  const help = document.createElement("p");
  help.textContent = "消息声音及各频道提醒范围沿用 Discord → 用户设置 → 通知。关闭窗口默认继续在托盘接收消息；彻底退出后不接收。Windows 勿扰模式及频道静音也会影响提醒。";
  section.append(help);
  const save = document.createElement("button"); save.type = "button"; save.id = "desktop-save"; save.textContent = "保存客户端设置";
  const test = document.createElement("button"); test.type = "button"; test.textContent = "发送系统测试通知"; test.disabled = !state.notificationSupported;
  section.append(save, test);
  save.addEventListener("click", event => {
    if (!event.isTrusted || save.disabled) return;
    save.disabled = true;
    void ipc.invoke("translation:desktop-save", { openAtLogin: startup.checked, flash: flash.checked, notifications: notifications.value === "ask" ? null : notifications.value === "allow" }).then((reply: Reply<DesktopState>) => {
      if (!reply.ok) throw new Error(reply.error);
      state = reply.value; startup.checked = state.openAtLogin;
      status.textContent = "客户端设置已保存。";
    }).catch((error: unknown) => { status.textContent = error instanceof Error ? error.message : "保存失败。"; }).finally(() => { save.disabled = false; });
  });
  test.addEventListener("click", event => {
    if (!event.isTrusted || test.disabled) return;
    test.disabled = true;
    void ipc.invoke("translation:desktop-test-notification").then((reply: Reply<string>) => { status.textContent = reply.ok ? reply.value : reply.error; })
      .finally(() => { test.disabled = false; });
  });
}
