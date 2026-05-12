/**
 * In-memory cache of "last image this conversation sent us", with a
 * 5-minute TTL. Used by the `/image` skill for image-to-image edits
 * when the user sends an image in one message and asks for an edit in
 * a follow-up.
 */
export interface LastImage {
  filePath: string;
  mimeType?: string;
  receivedAt: number;
}

export class LastImageStore {
  private cache = new Map<string, LastImage>();
  private readonly maxAgeMs: number;

  constructor(maxAgeMs = 5 * 60 * 1000) {
    this.maxAgeMs = maxAgeMs;
  }

  put(conversationId: string, filePath: string, mimeType?: string): void {
    this.cache.set(conversationId, { filePath, mimeType, receivedAt: Date.now() });
  }

  get(conversationId: string): LastImage | null {
    const v = this.cache.get(conversationId);
    if (!v) return null;
    if (Date.now() - v.receivedAt > this.maxAgeMs) {
      this.cache.delete(conversationId);
      return null;
    }
    return v;
  }

  clear(conversationId: string): void {
    this.cache.delete(conversationId);
  }
}
