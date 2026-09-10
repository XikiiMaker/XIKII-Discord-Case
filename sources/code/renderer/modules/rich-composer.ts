/** Keep native Slate void nodes (mentions/emoji) and paragraph boundaries in place. */
export interface ComposerSegment { text: string; nodes: Text[] }
export interface ComposerSnapshot {
  text: string;
  segments: ComposerSegment[];
  markers: string[];
  objects: string[];
  signature: string;
}
export function snapshotComposer(editor: HTMLElement, nonce: string): ComposerSnapshot {
  const segments: ComposerSegment[] = [{ text: "", nodes: [] }];
  const markers: string[] = [], objects: string[] = [];
  const boundary = (identity: string) => {
    objects.push(identity); markers.push(`\`XIKII_NODE_${nonce}_${markers.length}\``);
    segments.push({ text: "", nodes: [] });
  };
  const visit = (node: Node) => {
    const segment = segments.at(-1)!;
    if (node.nodeType === 3) {
      const text = node as Text;
      segment.nodes.push(text);
      // Slate's required empty leaves contain a zero-width DOM character.
      segment.text += text.parentElement?.closest('[data-slate-zero-width]') ? "" : text.data;
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    if (element.matches('[data-slate-void="true"], [contenteditable="false"]')) { boundary(element.outerHTML); return; }
    if (element.tagName === "BR") {
      if (!element.closest('[data-slate-zero-width]')) throw new Error("此输入框的换行结构尚未适配，未修改草稿。");
      return;
    }
    for (const child of element.childNodes) visit(child);
  };
  let blocks = 0;
  for (const child of editor.childNodes) {
    if (child.nodeType === 1 && (child as Element).matches('[data-slate-node="element"]:not([data-slate-inline="true"]):not([data-slate-void="true"])')) {
      if (blocks++) boundary("paragraph-break");
    }
    visit(child);
  }
  if (objects.length > 64) throw new Error("输入中的提及、表情或段落过多，请分成几条发送。");
  const text = segments.map((segment, index) => segment.text + (markers[index] ?? "")).join("");
  return { text, segments, markers, objects, signature: JSON.stringify([segments.map(segment => segment.text), objects]) };
}

export function translatedSegments(snapshot: ComposerSnapshot, translated: string): string[] {
  const result: string[] = [];
  let offset = 0;
  for (const marker of snapshot.markers) {
    const index = translated.indexOf(marker, offset);
    if (index < 0 || translated.indexOf(marker, index + marker.length) >= 0) throw new Error("译文中的提及、表情或段落标记损坏，未修改草稿。");
    result.push(translated.slice(offset, index)); offset = index + marker.length;
  }
  result.push(translated.slice(offset));
  if (result.some(text => snapshot.markers.some(marker => text.includes(marker)))) throw new Error("译文改变了提及顺序，未修改草稿。");
  for (const [index, text] of result.entries()) {
    if (text !== snapshot.segments[index]?.text && !snapshot.segments[index]?.nodes.length) throw new Error("无法定位提及旁的文字，未修改草稿。");
  }
  return result;
}

/** Select editable text only; never select the whole composer around void nodes. */
export function selectComposerSegment(editor: HTMLElement, segment: ComposerSegment) {
  const first = segment.nodes[0], last = segment.nodes.at(-1);
  if (!first || !last || !editor.contains(first) || !editor.contains(last)) throw new Error("输入框已变化，未发送译文。");
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error("无法选中输入框，未发送译文。");
  const range = editor.ownerDocument.createRange();
  range.setStart(first, 0); range.setEnd(last, last.data.length);
  editor.focus(); selection.removeAllRanges(); selection.addRange(range);
}

export async function replaceRichComposer(
  editor: HTMLElement, nonce: string, original: ComposerSnapshot, translated: string,
  valid: () => boolean, insert: (text: string) => Promise<void>
) {
  const next = translatedSegments(original, translated);
  const expected = original.segments.map(segment => segment.text);
  const check = () => {
    const current = snapshotComposer(editor, nonce);
    if (!valid() || !editor.isConnected || current.signature !== JSON.stringify([expected, original.objects])) throw new Error("草稿或会话已变化，未发送译文。请检查当前草稿。");
    return current;
  };
  check();
  // Work from the end; reacquire live leaves after every Slate render.
  for (let index = next.length - 1; index >= 0; index--) {
    const text = next[index]!;
    if (text === expected[index]) continue;
    const current = check();
    selectComposerSegment(editor, current.segments[index]!);
    // Each native edit must finish and verify before another edit starts.
    // oxlint-disable-next-line no-await-in-loop
    await insert(text);
    expected[index] = text;
    check();
  }
  check();
}
