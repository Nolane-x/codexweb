const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function assertChatGptConversationUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("ChatGPT conversation URL is invalid"); }
  if (url.protocol !== "https:" || url.hostname !== "chatgpt.com" || url.username || url.password || url.search || url.hash) {
    throw new Error("ChatGPT conversation URL is invalid");
  }
  if (!/^\/c\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw new Error("ChatGPT conversation URL must identify a conversation");
  return url.toString();
}

export class CouncilConversationRegistry {
  private readonly values = new Map<string, string>();

  bind(agentId: string, conversationUrl: string): string {
    const id = agentId.trim();
    if (!AGENT_ID.test(id)) throw new Error("agent id is invalid");
    const url = assertChatGptConversationUrl(conversationUrl);
    this.values.set(id, url);
    return url;
  }
  get(agentId: string): string | undefined { return this.values.get(agentId); }
  remove(agentId: string): boolean { return this.values.delete(agentId); }
  snapshot(): Record<string, string> { return Object.fromEntries(this.values); }
}
