import { conversation, ruleFor, languages } from "../../common/translation";
import type { TranslationSettings } from "../../common/translation";

export const incomingTranslationStyle = 'display:block;box-sizing:border-box;min-width:0;max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;color:var(--text-muted,#949ba4);font-family:var(--font-primary,inherit);font-size:0.9em;font-weight:400;line-height:1.6;letter-spacing:normal;margin:4px 0 6px;border-inline-start:2px solid var(--brand-500,#5865f2);padding:0 0 0 8px';

const switches = new WeakMap<HTMLAnchorElement, HTMLElement>();
const positionedLinks = new WeakSet<HTMLAnchorElement>();
/** The only persistent translation UI: a compact switch alongside each channel/DM name. */
export function syncTranslationToggles(document: Document, settings: TranslationSettings, toggle: (url: string) => Promise<void>, busyId?: string) {
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href*="/channels/"]')) {
    if (anchor.closest('main, [role="main"], [id^="chat-messages-"]')) continue;
    const linked = conversation(anchor.href);
    if (!linked) continue;
    if (!positionedLinks.has(anchor)) {
      // Reserve a column outside the native row, including its hover-only actions.
      const computed = document.defaultView?.getComputedStyle(anchor);
      if (!computed || computed.position === "static") anchor.style.position = "relative";
      anchor.style.boxSizing = "border-box";
      anchor.style.setProperty("padding-inline-end", `${(parseFloat(computed?.paddingInlineEnd ?? "") || 0) + 40}px`, "important");
      positionedLinks.add(anchor);
    }
    const name = anchor.querySelector<HTMLElement>('[class*="name_"], [class*="channelName"], [class*="nameContainer"]') ??
      Array.from(anchor.querySelectorAll<HTMLElement>('span,div')).find(node => !node.hasAttribute('data-xikii-translation-toggle') && node.childElementCount === 0 && Boolean(node.textContent?.trim()));
    let control = switches.get(anchor);
    if (!control) {
      control = document.createElement("span"); control.dataset['xikiiTranslationToggle'] = "true";
      control.setAttribute("role", "switch"); control.tabIndex = 0;
      control.style.cssText = 'position:absolute;inset-inline-end:8px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:24px;height:20px;min-width:24px;max-width:24px;margin:0;padding:0;border:0;background:none;cursor:pointer;user-select:none;z-index:1';
      const shadow = control.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = ':host(:focus-visible){outline:2px solid var(--focus-primary,#00a8fc);outline-offset:2px;border-radius:4px}.track{display:block;width:24px;height:14px;border-radius:8px;background:var(--background-modifier-accent,#4e5058);padding:2px;box-sizing:border-box;transition:background .15s}.thumb{display:block;width:10px;height:10px;border-radius:50%;background:#b5bac1;transition:transform .15s}:host([aria-checked=true]) .track{background:var(--brand-500,#5865f2)}:host([aria-checked=true]) .thumb{transform:translateX(10px);background:white}:host([aria-disabled=true]){opacity:.5;cursor:wait}:host([aria-busy=true]) .thumb{animation:pulse .8s infinite alternate}@keyframes pulse{to{opacity:.4}}@media(prefers-reduced-motion:reduce){.track,.thumb{transition:none}:host([aria-busy=true]) .thumb{animation:none}}';
      const track = document.createElement("span"); track.className = "track";
      const thumb = document.createElement("span"); thumb.className = "thumb"; track.append(thumb); shadow.append(style, track);
      const element = control;
      const activate = (event: Event) => {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.isTrusted || element.getAttribute("aria-disabled") === "true") return;
        element.setAttribute("aria-disabled", "true");
        void toggle(anchor.href).finally(() => element.removeAttribute("aria-disabled"));
      };
      control.addEventListener("click", activate);
      control.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") activate(event); });
      control.addEventListener("mousedown", event => event.stopPropagation());
      switches.set(anchor, control);
    }
    const rule = ruleFor(settings, linked);
    control.setAttribute("aria-checked", String(rule.enabled));
    control.setAttribute("aria-busy", String(busyId === linked.id));
    control.setAttribute("aria-label", `${name?.textContent ?? "本会话"}自动翻译`);
    control.title = busyId === linked.id ? "正在翻译发送消息…" : `${rule.enabled ? "关闭" : "开启"}自动翻译 · 发送${languages[rule.target]}`;
    if (control.parentElement !== anchor) anchor.append(control);
  }
}

/** Temporary failures are shown away from the composer; there is no persistent status bar. */
export function createTranslationNotice(document: Document) {
  const host = document.createElement("div"); host.style.cssText = 'position:fixed;width:0;height:0;inset:0';
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = '.notice{position:fixed;inset:16px 16px auto auto;margin:0;width:min(360px,calc(100vw - 32px));padding:12px 36px 12px 14px;border:1px solid var(--border-subtle,#4e5058);border-radius:8px;background:var(--background-floating,#111214);color:var(--text-normal,#dbdee1);box-shadow:0 8px 24px #0005;font:13px/1.6 var(--font-primary,system-ui);overflow-wrap:anywhere}.notice:not(:popover-open){display:none}p{margin:0}button{position:absolute;inset:8px 8px auto auto;border:0;background:none;color:inherit;font-size:18px;cursor:pointer}';
  const notice = document.createElement("div"); notice.className = "notice"; notice.setAttribute("popover", "manual"); notice.setAttribute("role", "alert");
  const text = document.createElement("p"); const close = document.createElement("button"); close.type = "button"; close.textContent = "×"; close.setAttribute("aria-label", "关闭提示");
  notice.append(text, close); shadow.append(style, notice); document.body.append(host);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (timer) clearTimeout(timer); if (notice.matches(':popover-open')) notice.hidePopover(); };
  close.addEventListener("click", clear);
  return {
    show(message: string) { clear(); text.textContent = message; if (notice.isConnected) notice.showPopover(); timer = setTimeout(clear, 10_000); },
    clear,
    destroy() { clear(); host.remove(); }
  };
}
