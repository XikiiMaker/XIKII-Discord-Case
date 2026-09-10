import { isRecord, parseFallback } from "../../common/translation";
import type { Language, TranslationSettings } from "../../common/translation";
import { readBoundedJson } from "./stream";

export interface TranslationPart { text: string; protected: boolean }
/** LibreTranslate's documented batch /translate API. Context and Qwen credentials are never passed. */
export async function translateFallback(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  settings: TranslationSettings['fallback'], key: string, parts: TranslationPart[], target: Language, signal: AbortSignal
): Promise<string> {
  const fallback = parseFallback(settings);
  if (!fallback.enabled) throw new Error("备用翻译未开启。");
  const prose = parts.filter(part => !part.protected && /\p{L}/u.test(part.text));
  if (!prose.length) return parts.map(part => part.text).join("");
  const response = await fetcher(fallback.endpoint, {
    method: "POST", redirect: "error", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: prose.map(part => part.text.trim()), source: "auto", target, format: "text", ...(key ? { api_key: key } : {}) })
  });
  if (!response.ok) throw new Error(`备用翻译服务失败（HTTP ${response.status}），原文已保留。`);
  const body = await readBoundedJson(response);
  const translated: unknown = isRecord(body) ? body['translatedText'] : null;
  if (!Array.isArray(translated) || translated.length !== prose.length || !translated.every((text: unknown) => typeof text === "string" && text.trim() && text.length <= 16000))
    throw new Error("备用引擎返回无效译文，原文已保留。");
  const replacements = new Map(prose.map((part, index) => [part, String(translated[index]).trim()]));
  const result = parts.map(part => {
    const replacement = replacements.get(part);
    return replacement === undefined ? part.text : (part.text.match(/^\s*/u)?.[0] ?? "") + replacement + (part.text.match(/\s*$/u)?.[0] ?? "");
  }).join("");
  if (result.length > 16000) throw new Error("备用译文过长，原文已保留。");
  return result;
}
