export interface DesktopState {
  startupSupported: boolean;
  openAtLogin: boolean;
  notifications: boolean | null;
  notificationSupported: boolean;
  flash: boolean;
  persistentSession: boolean;
}

/** Match the whole unread value, so 1 -> 2 mentions also refreshes the tray. */
export function unreadFromTitle(title: string): string | boolean {
  const prefix = title.split("|")[0] ?? "";
  const count = prefix.match(/\(([0-9]+)\)/)?.[1];
  return count && Number(count) > 0 ? count : prefix.includes("•");
}

export function shouldFlash(unread: string | boolean, previous: string | boolean | undefined, enabled: boolean, focused: boolean) {
  return enabled && !focused && typeof unread === "string" && unread !== previous;
}
