export interface ContextMessage { id: string; text: string }
/** Bounded, in-memory conversations. IDs are Discord snowflakes, ordered without Number precision loss. */
export class ConversationContext {
  private conversations = new Map<string, Map<string, string>>();
  constructor(private capacity = 50, private messageCapacity = 30) {}
  clear() { this.conversations.clear(); }
  update(id: string, messages: ContextMessage[]) {
    const existing = this.conversations.get(id) ?? new Map<string, string>();
    for (const message of messages) {
      if (!/^\d+$/.test(message.id)) continue;
      if (message.text.trim()) existing.set(message.id, message.text.slice(0, 1000));
      else existing.delete(message.id);
    }
    const sorted = [...existing].sort(([a], [b]) => a.length - b.length || a.localeCompare(b));
    this.conversations.delete(id);
    this.conversations.set(id, new Map(sorted.slice(-this.messageCapacity)));
    while (this.conversations.size > this.capacity) {
      const oldest = this.conversations.keys().next().value;
      if (oldest !== undefined) this.conversations.delete(oldest);
    }
  }
  remove(id: string, messageId: string) { this.conversations.get(id)?.delete(messageId); }
  before(id: string, beforeId: string | null, count: number): string[] {
    if (count <= 0) return [];
    const messages = [...(this.conversations.get(id) ?? [])];
    const previous = beforeId === null ? messages : messages.filter(([messageId]) => messageId.length < beforeId.length || (messageId.length === beforeId.length && messageId < beforeId));
    return previous.slice(-Math.min(10, count)).map(([, text]) => text);
  }
}
