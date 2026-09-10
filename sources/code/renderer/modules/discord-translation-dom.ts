/** The Discord DOM contract is isolated here so it can be tested and updated. */
export const messageSelector = '[id^="message-content-"]';
export const composerSelector = 'main [role="textbox"][contenteditable="true"][data-slate-editor="true"], [role="main"] [role="textbox"][contenteditable="true"][data-slate-editor="true"]';
function read(node: Node): string {
    if (node.nodeType === 3) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    if (node instanceof HTMLImageElement) return node.alt;
    if (node.tagName === "BR") return "\n";
    const content = Array.from(node.childNodes, read).join("");
    if (node.tagName === "PRE") return "```\n" + (node.textContent ?? "") + "\n```";
    if (node.tagName === "CODE") return "`" + content + "`";
    if (node.tagName === "STRONG" || node.tagName === "B") return "**" + content + "**";
    if (node.tagName === "EM" || node.tagName === "I") return "*" + content + "*";
    if (node.tagName === "S") return "~~" + content + "~~";
    if (node instanceof HTMLAnchorElement && /^https?:/.test(node.href)) {
      const href = node.getAttribute("href") ?? node.href;
      return content === href ? href : `[${content}](${href})`;
    }
    return content;
}
export function messageText(element: Element): string {
  return read(element);
}
export function draftText(editor: HTMLElement): string { return editor.innerText.replace(/\r\n/g, "\n").replace(/\n$/, ""); }
export function plainComposer(editor: HTMLElement): boolean {
  return !editor.querySelector('[data-slate-void="true"], [contenteditable="false"]');
}
export function conversationMessages(document: Document, id: string): Element[] {
  return Array.from(document.querySelectorAll(messageSelector)).filter(node => node.closest(`[id^="chat-messages-${id}-"]`));
}
export function recentContext(nodes: Element[], before: Element | null, count: number): string[] {
  if (count === 0) return [];
  const index = before ? nodes.indexOf(before) : nodes.length;
  return nodes.slice(Math.max(0, index - count), index).map(node => messageText(node).slice(0, 1000));
}
