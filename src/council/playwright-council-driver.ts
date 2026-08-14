import type { Locator, Page } from "playwright-core";
import {
  CHATGPT_ASSISTANT_TURN_SELECTOR,
  CHATGPT_COMPLETION_ACTION_SELECTOR,
  CHATGPT_COMPOSER_SELECTOR,
  CHATGPT_STOP_BUTTON_SELECTOR,
  CHATGPT_USER_TURN_SELECTOR,
  assertAuthenticatedChatGptPage,
} from "../chatgpt-session";
import { connectLauncherBrowserHost } from "../launcher-browser-host";
import type { CouncilPersistentChatDriver } from "./browser-transport";
import { CouncilConversationUnavailableError, CouncilSurfaceUnavailableError } from "./browser-transport";
import { assertChatGptConversationUrl } from "./conversation-registry";
import { classifyConversationSurface } from "./playwright-council-surface";

const CHATGPT_HOME_URL = "https://chatgpt.com/";
const PAGE_TIMEOUT_MS = 60_000;
const SUBMISSION_TIMEOUT_MS = 30_000;
const RESPONSE_TIMEOUT_MS = 15 * 60_000;
const RESPONSE_SETTLE_MS = 1_250;
const FALLBACK_SETTLE_MS = 3_000;
const INSERT_CHUNK_CHARS = 12_000;

interface DriverInput { surfaceId: string; prompt: string; signal?: AbortSignal }
interface ResumeInput extends DriverInput { conversationUrl: string }

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Council ChatGPT turn aborted", "AbortError");
}

async function visibleComposer(page: Page): Promise<Locator> {
  const composers = page.locator(CHATGPT_COMPOSER_SELECTOR).filter({ visible: true });
  await composers.last().waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  await assertAuthenticatedChatGptPage(page);
  return composers.last();
}

async function composerText(composer: Locator): Promise<string> {
  return await composer.evaluate(element => {
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-id^="plugin:"][data-keyword], [data-inline-selection-pill-cursor-target]').forEach(node => node.remove());
    return [...clone.childNodes].map(child => child.textContent ?? "").join("\n").trimStart();
  });
}

async function attachExactPrompt(page: Page, prompt: string, signal?: AbortSignal): Promise<Locator> {
  const composer = await visibleComposer(page);
  await composer.fill("");
  await composer.focus();
  for (let offset = 0; offset < prompt.length;) {
    abortIfNeeded(signal);
    let end = Math.min(offset + INSERT_CHUNK_CHARS, prompt.length);
    if (end < prompt.length) {
      const previous = prompt.charCodeAt(end - 1);
      const next = prompt.charCodeAt(end);
      if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end -= 1;
    }
    await page.keyboard.insertText(prompt.slice(offset, end));
    offset = end;
  }
  const deadline = Date.now() + 10_000;
  let observed = "";
  do {
    abortIfNeeded(signal);
    observed = await composerText(composer);
    if (observed === prompt) return composer;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  let prefix = 0;
  while (prefix < prompt.length && prompt[prefix] === observed[prefix]) prefix += 1;
  throw new Error(`ChatGPT Council composer did not preserve the complete prompt (expectedChars=${prompt.length}, actualChars=${observed.length}, commonPrefixChars=${prefix})`);
}

async function currentAnswerText(responseTurn: Locator): Promise<string> {
  return await responseTurn.evaluate(element => {
    const root = element as HTMLElement;
    const rendered = [...root.querySelectorAll<HTMLElement>(".markdown")]
      .filter(candidate => !candidate.parentElement?.closest(".markdown"))
      .filter(candidate => candidate.closest("[data-streaming-response-status]") === null)
      .filter(candidate => {
        const style = getComputedStyle(candidate);
        const bounds = candidate.getBoundingClientRect();
        return candidate.isConnected && bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
    return rendered.map(candidate => candidate.innerText.trim()).filter(Boolean).join("\n\n").trim();
  }).catch(() => "");
}

async function bodyDiagnosticText(page: Page): Promise<string> {
  return (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")).slice(0, 20_000);
}

async function sendAndWait(page: Page, prompt: string, signal?: AbortSignal): Promise<string> {
  abortIfNeeded(signal);
  const composer = await attachExactPrompt(page, prompt, signal);
  const assistantTurns = page.locator(CHATGPT_ASSISTANT_TURN_SELECTOR);
  const userTurns = page.locator(CHATGPT_USER_TURN_SELECTOR);
  const initialAssistantCount = await assistantTurns.count();
  const initialUserCount = await userTurns.count();
  const responseTurn = assistantTurns.nth(initialAssistantCount);
  const send = composer.locator("xpath=ancestor::form[1]").getByTestId("send-button");
  await send.waitFor({ state: "visible", timeout: 20_000 });
  if (!await send.isEnabled()) throw new Error("ChatGPT Council send button is disabled after prompt attachment");
  await send.press("Enter");

  const submissionDeadline = Date.now() + SUBMISSION_TIMEOUT_MS;
  while (Date.now() < submissionDeadline) {
    abortIfNeeded(signal);
    const [users, assistants, running] = await Promise.all([
      userTurns.count(),
      assistantTurns.count(),
      page.locator(CHATGPT_STOP_BUTTON_SELECTOR).filter({ visible: true }).count(),
    ]);
    if (users > initialUserCount || assistants > initialAssistantCount || running > 0) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (Date.now() >= submissionDeadline) throw new Error("ChatGPT Council did not accept the submitted prompt");

  const responseDeadline = Date.now() + RESPONSE_TIMEOUT_MS;
  let lastText = "";
  let lastChangedAt = Date.now();
  let sawResponse = false;
  while (Date.now() < responseDeadline) {
    abortIfNeeded(signal);
    if (page.isClosed()) throw new Error("ChatGPT Council browser surface closed during the turn");
    const present = await responseTurn.count() > 0;
    if (present) {
      sawResponse = true;
      const text = await currentAnswerText(responseTurn);
      if (text !== lastText) { lastText = text; lastChangedAt = Date.now(); }
      const running = await page.locator(CHATGPT_STOP_BUTTON_SELECTOR).filter({ visible: true }).count() > 0;
      const completion = await responseTurn.locator(CHATGPT_COMPLETION_ACTION_SELECTOR).filter({ visible: true }).count() > 0;
      const stableFor = Date.now() - lastChangedAt;
      if (lastText && !running && ((completion && stableFor >= RESPONSE_SETTLE_MS) || stableFor >= FALLBACK_SETTLE_MS)) return lastText;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(sawResponse ? "ChatGPT Council response did not reach stable completion" : "ChatGPT Council did not create an assistant response");
}

async function waitForConversationUrl(page: Page, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  do {
    try { return assertChatGptConversationUrl(page.url()); }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`ChatGPT did not establish a persistent conversation URL (${page.url()})`);
}

function surfaceUnavailable(page: Page): boolean {
  return page.isClosed() || page.url() === "about:blank";
}

async function navigateBeforeSubmit(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  } catch (error) {
    if (surfaceUnavailable(page)) throw new CouncilSurfaceUnavailableError(`Council browser surface unavailable before navigation completed (${page.url()})`);
    throw error;
  }
}

export class PlaywrightCouncilChatDriver implements CouncilPersistentChatDriver {
  constructor(private readonly descriptorPath: string) {}

  async resume(input: ResumeInput): Promise<{ answer: string; conversationUrl: string }> {
    const expected = assertChatGptConversationUrl(input.conversationUrl);
    const connection = await connectLauncherBrowserHost(this.descriptorPath, PAGE_TIMEOUT_MS, input.surfaceId, input.signal);
    try {
      const page = connection.page;
      if (page.isClosed()) throw new CouncilSurfaceUnavailableError("Council browser surface closed before conversation resume");
      if (page.url() !== expected) await navigateBeforeSubmit(page, expected);
      await new Promise(resolve => setTimeout(resolve, 250));
      const diagnostic = await bodyDiagnosticText(page);
      const surface = classifyConversationSurface(expected, page.url(), diagnostic);
      if (surface === "surface-unavailable") throw new CouncilSurfaceUnavailableError(`Council browser surface unavailable before submit (${page.url()})`);
      if (surface === "unavailable") throw new CouncilConversationUnavailableError(`ChatGPT conversation is unavailable: ${expected}`);
      if (surface === "invalid") throw new Error(`ChatGPT persistent surface left the expected origin: ${page.url()}`);
      try { await visibleComposer(page); }
      catch (error) {
        if (surfaceUnavailable(page)) throw new CouncilSurfaceUnavailableError(`Council browser surface unavailable before composer became ready (${page.url()})`);
        const state = classifyConversationSurface(expected, page.url(), await bodyDiagnosticText(page));
        if (state === "surface-unavailable") throw new CouncilSurfaceUnavailableError(`Council browser surface unavailable before composer became ready (${page.url()})`);
        if (state === "unavailable") throw new CouncilConversationUnavailableError(`ChatGPT conversation is unavailable: ${expected}`);
        throw error;
      }
      const answer = await sendAndWait(page, input.prompt, input.signal);
      return { answer, conversationUrl: assertChatGptConversationUrl(page.url()) };
    } finally {
      await connection.browser.close().catch(() => {});
    }
  }

  async create(input: DriverInput): Promise<{ answer: string; conversationUrl: string }> {
    const connection = await connectLauncherBrowserHost(this.descriptorPath, PAGE_TIMEOUT_MS, input.surfaceId, input.signal);
    try {
      const page = connection.page;
      if (page.isClosed()) throw new CouncilSurfaceUnavailableError("Council browser surface closed before conversation creation");
      const current = new URL(page.url());
      if (current.origin !== "https://chatgpt.com" || current.pathname !== "/" || current.search) {
        await navigateBeforeSubmit(page, CHATGPT_HOME_URL);
      }
      try { await visibleComposer(page); }
      catch (error) {
        if (surfaceUnavailable(page)) throw new CouncilSurfaceUnavailableError(`Council browser surface unavailable before composer became ready (${page.url()})`);
        throw error;
      }
      const answer = await sendAndWait(page, input.prompt, input.signal);
      return { answer, conversationUrl: await waitForConversationUrl(page) };
    } finally {
      await connection.browser.close().catch(() => {});
    }
  }
}
