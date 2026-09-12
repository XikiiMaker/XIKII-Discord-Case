import { app, safeStorage } from "electron/main";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../common/translation";

export type CachedProvider = "qwen" | "libretranslate";
export interface CachedTranslation { text: string; expires: number; provider: CachedProvider }

/** Translations survive restarts only through this interface, so the engine stays testable. */
export interface TranslationCachePersistence {
  get(hash: string): CachedTranslation | undefined;
  set(hash: string, entry: CachedTranslation): void;
  clear(): void;
}

const maxEntries = 5000;
const flushDelay = 5_000;

/**
 * Persists finished translations so switching channels or restarting never pays twice.
 * Chat text is sensitive, so nothing is written unless the OS can encrypt it.
 */
export class TranslationCacheStore implements TranslationCachePersistence {
  private path = "";
  private entries: Map<string, CachedTranslation> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private usable(): boolean {
    return safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
  }
  private load(): Map<string, CachedTranslation> {
    if (this.entries) return this.entries;
    this.entries = new Map();
    if (!this.usable()) return this.entries;
    this.path ||= join(app.getPath("userData"), "translation-cache.json");
    if (!existsSync(this.path)) return this.entries;
    try {
      const file: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      if (!isRecord(file) || typeof file['encrypted'] !== "string") throw new Error("cache header");
      const decoded: unknown = JSON.parse(safeStorage.decryptString(Buffer.from(file['encrypted'], "base64")));
      if (!Array.isArray(decoded)) throw new Error("cache body");
      const now = Date.now();
      for (const row of decoded) {
        if (!Array.isArray(row) || row.length !== 2) continue;
        const [hash, entry] = row as [unknown, unknown];
        if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash) || !isRecord(entry)) continue;
        if (typeof entry['text'] !== "string" || typeof entry['expires'] !== "number") continue;
        if (entry['provider'] !== "qwen" && entry['provider'] !== "libretranslate") continue;
        if (entry['expires'] <= now) continue;
        this.entries.set(hash, { text: entry['text'], expires: entry['expires'], provider: entry['provider'] });
      }
    } catch {
      // A corrupt or undecryptable cache is disposable; translation must still work.
      this.entries = new Map();
    }
    return this.entries;
  }
  get(hash: string): CachedTranslation | undefined {
    const entry = this.load().get(hash);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) { this.load().delete(hash); return undefined; }
    return entry;
  }
  set(hash: string, entry: CachedTranslation): void {
    if (!this.usable()) return;
    const entries = this.load();
    entries.delete(hash); entries.set(hash, entry);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    this.schedule();
  }
  clear(): void {
    this.entries = new Map();
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    // The path is resolved lazily, so a session that never touched the cache still must delete it.
    this.path ||= join(app.getPath("userData"), "translation-cache.json");
    try { rmSync(this.path, { force: true }); } catch { /* nothing left to protect */ }
  }
  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, flushDelay);
    this.timer.unref?.();
  }
  flush(): void {
    if (this.entries === null || !this.usable()) return;
    const now = Date.now();
    for (const [hash, entry] of this.entries) if (entry.expires <= now) this.entries.delete(hash);
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify([...this.entries])).toString("base64");
      mkdirSync(app.getPath("userData"), { recursive: true });
      writeFileSync(this.path + ".tmp", JSON.stringify({ version: 1, encrypted }), { mode: 0o600 });
      renameSync(this.path + ".tmp", this.path);
    } catch { /* losing the cache only costs a re-translation */ }
  }
}
