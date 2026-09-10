import { isRecord } from "../../common/translation";

/** Parse OpenAI-compatible SSE without depending on chunk / UTF-8 character boundaries. */
export async function readTranslationStream(response: Response, progress: (text: string) => void): Promise<string> {
  if (!response.body) throw new Error("Qwen 未返回流式内容。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", text = "", totalBytes = 0, stopped = false, done = false;
  let data: string[] = [];
  function dispatch() {
    if (!data.length) return;
    const payload = data.join("\n"); data = [];
    if (payload === "[DONE]") { done = true; return; }
    if (done) return;
    let event: unknown;
    try { event = JSON.parse(payload); } catch { throw new Error("Qwen 流式响应格式无效。"); }
    if (!isRecord(event) || event['error']) throw new Error("Qwen 流式响应失败。");
    const choice: unknown = Array.isArray(event['choices']) ? event['choices'][0] : null;
    if (!isRecord(choice)) return; // usage-only frames
    const finish = choice['finish_reason'];
    if (finish !== null && finish !== undefined) {
      if (finish !== "stop") throw new Error("Qwen 译文不完整，请重试。");
      stopped = true;
    }
    const delta = choice['delta'];
    if (isRecord(delta) && typeof delta['content'] === "string") {
      text += delta['content'];
      if (text.length > 16000) throw new Error("Qwen 译文过长，原文已保留。");
      progress(text);
    }
  }
  function consume() {
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line === "") dispatch(); else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
  }
  try {
    while (true) {
      if (done) break;
      // SSE must be decoded in sequence to preserve UTF-8 boundaries.
      // oxlint-disable-next-line no-await-in-loop
      const chunk = await reader.read();
      if (chunk.done) { buffer += decoder.decode(); consume(); break; }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > 256_000) throw new Error("Qwen 流式响应超过大小限制。");
      buffer += decoder.decode(chunk.value, { stream: true }); consume();
    }
    if (!done || !stopped || !text.trim()) throw new Error("Qwen 流式响应中断，原文已保留。");
    return text;
  } finally { await reader.cancel(); reader.releaseLock(); }
}
