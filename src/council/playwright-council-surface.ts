export type CouncilConversationSurfaceState = "available" | "unavailable" | "invalid";

export function classifyConversationSurface(expectedUrl: string, actualUrl: string, visibleText: string): CouncilConversationSurfaceState {
  let expected: URL;
  let actual: URL;
  try { expected = new URL(expectedUrl); actual = new URL(actualUrl); }
  catch { return "invalid"; }
  if (expected.protocol !== "https:" || expected.hostname !== "chatgpt.com" || !/^\/c\/[A-Za-z0-9_-]+$/.test(expected.pathname)) return "invalid";
  if (actual.protocol !== "https:" || actual.hostname !== "chatgpt.com") return "invalid";
  const missing = /conversation\s+(?:not found|unavailable)|unable to load (?:the )?conversation|couldn['’]t load (?:the )?conversation/i.test(visibleText);
  if (missing) return "unavailable";
  if (actual.pathname !== expected.pathname) return "unavailable";
  return "available";
}
