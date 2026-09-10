/** Shared, secret-free translation contracts. */
export const languages = { en: "英语", zh: "中文" } as const;
export type Language = keyof typeof languages;
export const endpoints = {
  china: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  singapore: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
  us: "https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions"
} as const;
export interface TranslationSettings {
  consent: boolean;
  dmEnabled: boolean;
  target: Language;
  model: string;
  region: keyof typeof endpoints;
  contextCount: number;
  concurrency: number;
  cacheSize: number;
  showOriginal: boolean;
  streaming: boolean;
  fallback: { enabled: boolean; endpoint: string };
  channels: Record<string, { enabled: boolean; target: Language }>;
}
export interface TranslationState { settings: TranslationSettings; hasKey: boolean; hasFallbackKey: boolean; encryptionAvailable: boolean }
export interface TranslationRequest { text: string; target: Language; context: string[] }
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
export const defaultTranslationSettings: TranslationSettings = {
  consent: false, dmEnabled: true, target: "en", model: "qwen-turbo", region: "china",
  contextCount: 0, concurrency: 2, cacheSize: 500,
  showOriginal: true, streaming: false, fallback: { enabled: false, endpoint: "" }, channels: {}
};
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && Object.hasOwn(languages, value);
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
/** Only a trusted settings page can configure the destination. Never accept credentials in URLs. */
export function parseFallback(value: unknown): TranslationSettings['fallback'] {
  if (value === undefined) return { enabled: false, endpoint: "" };
  if (!isRecord(value) || typeof value['enabled'] !== "boolean" || typeof value['endpoint'] !== "string" || value['endpoint'].length > 2048)
    throw new Error("备用引擎设置无效。");
  const endpoint = value['endpoint'].trim();
  if (!endpoint && !value['enabled']) return { enabled: false, endpoint: "" };
  try {
    const url = new URL(endpoint);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/translate")) throw new Error();
    return { enabled: value['enabled'], endpoint: url.href };
  } catch { throw new Error("备用服务需填写完整 HTTPS /translate 地址；本机 localhost 可用 HTTP，地址不可含账号或查询参数。"); }
}
export function parseSettings(value: unknown): TranslationSettings {
  if (!isRecord(value) || typeof value['consent'] !== "boolean" || typeof value['dmEnabled'] !== "boolean" ||
      !isLanguage(value['target']) || typeof value['model'] !== "string" || !/^qwen-[a-zA-Z0-9.-]{1,80}$/.test(value['model']) ||
      typeof value['region'] !== "string" || !Object.hasOwn(endpoints, value['region']) ||
      !integer(value['contextCount'], 0, 10) || !integer(value['concurrency'], 1, 4) ||
      !integer(value['cacheSize'], 0, 2000) || !isRecord(value['channels']) || Object.keys(value['channels']).length > 2000)
    throw new Error("翻译设置无效，请检查模型、语言和数值范围。");
  const showOriginal = value['showOriginal'] ?? true;
  const streaming = value['streaming'] ?? false;
  const fallback = parseFallback(value['fallback']);
  if (typeof showOriginal !== "boolean" || typeof streaming !== "boolean") throw new Error("翻译显示设置无效。");
  const channels: TranslationSettings['channels'] = {};
  for (const [id, rule] of Object.entries(value['channels'])) {
    if (!/^\d{1,25}$/.test(id) || !isRecord(rule) || typeof rule['enabled'] !== "boolean" || !isLanguage(rule['target']))
      throw new Error("会话设置无效。");
    channels[id] = { enabled: rule['enabled'], target: rule['target'] };
  }
  return {
    consent: value['consent'], dmEnabled: value['dmEnabled'], target: value['target'], model: value['model'],
    region: value['region'] as TranslationSettings['region'],
    contextCount: value['contextCount'], concurrency: value['concurrency'], cacheSize: value['cacheSize'],
    showOriginal, streaming, fallback, channels
  };
}
export function parseRequest(value: unknown): TranslationRequest {
  if (!isRecord(value) || typeof value['text'] !== "string" || value['text'].length < 1 || value['text'].length > 8000 ||
      !isLanguage(value['target']) || !Array.isArray(value['context']) || value['context'].length > 10 ||
      !value['context'].every((item: unknown) => typeof item === "string" && item.length <= 1000))
    throw new Error("消息过长或翻译请求无效（上限 8000 字符）。");
  return { text: value['text'], target: value['target'], context: value['context'] as string[] };
}
/** Migrate previously saved multilingual prototypes; new writes remain strictly validated. */
export function migrateStoredSettings(value: unknown): TranslationSettings {
  if (!isRecord(value) || !isRecord(value['channels'])) return parseSettings(value);
  const legacy = new Set(["ja", "ko", "fr", "de", "es", "ru", "it", "ar", "pt", "zh-TW", "th", "vi"]);
  const channels = Object.fromEntries(Object.entries(value['channels']).map(([id, rule]) => [id,
    isRecord(rule) && typeof rule['target'] === "string" && legacy.has(rule['target']) ? { ...rule, target: "en" } : rule]));
  return parseSettings({ ...value, channels, target: typeof value['target'] === "string" && legacy.has(value['target']) ? "en" : value['target'] });
}
export function conversation(url: string): { id: string; dm: boolean } | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== "https://discord.com") return null;
    const match = /^\/channels\/(@me|\d+)\/(\d+)$/.exec(parsed.pathname);
    return match?.[2] ? { id: match[2], dm: match[1] === "@me" } : null;
  } catch { return null; }
}
export function ruleFor(settings: TranslationSettings, current: { id: string; dm: boolean }) {
  const override = settings.channels[current.id];
  return { enabled: settings.consent && (current.dm && !settings.dmEnabled ? false : (override?.enabled ?? current.dm)), target: override?.target ?? settings.target };
}
