import { app, safeStorage } from "electron/main";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultTranslationSettings, isRecord, parseSettings, migrateStoredSettings } from "../../common/translation";
import type { TranslationState } from "../../common/translation";

/** Separate store: upstream Config permits plaintext fallback, which API keys must not use. */
export class TranslationStore {
  private path = join(app.getPath("userData"), "translation.json");
  settings = structuredClone(defaultTranslationSettings);
  private encryptedKey = "";
  private encryptedFallbackKey = "";
  constructor() {
    if (existsSync(this.path)) {
      const data: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      if (!isRecord(data) || typeof data['encryptedKey'] !== "string") throw new Error("翻译配置文件损坏。");
      this.settings = migrateStoredSettings(data['settings']);
      this.encryptedKey = data['encryptedKey'];
      const fallbackKey = data['encryptedFallbackKey'] ?? "";
      if (typeof fallbackKey !== "string") throw new Error("备用翻译密钥配置损坏。");
      this.encryptedFallbackKey = fallbackKey;
    }
  }
  private encryptionAvailable() {
    return safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
  }
  state(): TranslationState {
    return { settings: structuredClone(this.settings), hasKey: Boolean(this.encryptedKey), hasFallbackKey: Boolean(this.encryptedFallbackKey), encryptionAvailable: this.encryptionAvailable() };
  }
  key() {
    return this.decrypt(this.encryptedKey);
  }
  fallbackKey() { return this.decrypt(this.encryptedFallbackKey); }
  private decrypt(encrypted: string) {
    if (!encrypted) return "";
    if (!this.encryptionAvailable()) throw new Error("系统安全存储不可用，请解锁系统凭据存储后重试。");
    try { return safeStorage.decryptString(Buffer.from(encrypted, "base64")); }
    catch { throw new Error("无法解密 API Key，请在设置中重新保存。"); }
  }
  private encrypt(key: unknown, existing: string): string {
    if (key !== undefined) {
      if (typeof key !== "string" || key.length > 512 || /[\r\n]/.test(key)) throw new Error("API Key 格式无效。");
      if (key) {
        if (!this.encryptionAvailable()) throw new Error("系统安全存储不可用，API Key 未保存。");
        return safeStorage.encryptString(key.trim()).toString("base64");
      } else return "";
    }
    return existing;
  }
  save(value: unknown, key?: unknown, fallbackKey?: unknown) {
    const settings = parseSettings(value);
    const encryptedKey = this.encrypt(key, this.encryptedKey);
    // Changing the destination must never forward the previous service's key.
    const encryptedFallbackKey = this.encrypt(fallbackKey, settings.fallback.endpoint === this.settings.fallback.endpoint ? this.encryptedFallbackKey : "");
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(this.path + ".tmp", JSON.stringify({ settings, encryptedKey, encryptedFallbackKey }), { mode: 0o600 });
    renameSync(this.path + ".tmp", this.path);
    this.settings = settings;
    this.encryptedKey = encryptedKey;
    this.encryptedFallbackKey = encryptedFallbackKey;
    return this.state();
  }
}
