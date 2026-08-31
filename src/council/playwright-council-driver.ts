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
import type { CouncilExecutionObserver, CouncilPersistentChatDriver, CouncilPromptAttachment } from "./browser-transport";
import { CouncilConversationUnavailableError, CouncilSurfaceUnavailableError } from "./browser-transport";
import { assertChatGptConversationUrl } from "./conversation-registry";
import { classifyCouncilConnectorObservation } from "./chatgpt-connector-policy";
import { deriveCouncilChatGptState, type CouncilChatGptStateResult } from "./chatgpt-deep-state";
import type { CouncilObservationHealth } from "./observation-store";
import { classifyConversationSurface } from "./playwright-council-surface";

const CHATGPT_HOME_URL = "https://chatgpt.com/";
const COUNCIL_CONNECTOR_NAME = "CodexWeb Council";
const PAGE_TIMEOUT_MS = 60_000;
const SUBMISSION_TIMEOUT_MS = 30_000;
const RESPONSE_TIMEOUT_MS = 45 * 60_000;
const DIAGNOSTIC_SAMPLE_MS = 1_500;
const INSERT_CHUNK_CHARS = 12_000;
const CONNECTOR_MENU_TIMEOUT_MS = 4_000;

interface DriverInput { surfaceId: string; prompt: string; attachments?: CouncilPromptAttachment[]; signal?: AbortSignal; onPhase?: CouncilExecutionObserver }
interface ResumeInput extends DriverInput { conversationUrl: string }

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Council ChatGPT turn aborted", "AbortError");
}

function phase(observer: CouncilExecutionObserver | undefined, value: Parameters<CouncilExecutionObserver>[0]): void {
  observer?.(value);
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

function selectedCouncilConnector(composer: Locator): Locator {
  return composer
    .locator('[data-id^="plugin:"][data-keyword]')
    .filter({ hasText: COUNCIL_CONNECTOR_NAME, visible: true });
}

async function councilConnectorIsSelected(composer: Locator): Promise<boolean> {
  const keywords = await selectedCouncilConnector(composer).evaluateAll(elements => elements.map(element => element.getAttribute("data-keyword")));
  const exact = keywords.filter(keyword => keyword === COUNCIL_CONNECTOR_NAME).length;
  if (exact > 1) throw new Error("ChatGPT exposed duplicate CodexWeb Council connector selections");
  return exact === 1;
}

/** Prefer the real ChatGPT connector when it is available, but keep ordinary Council
 * browser turns usable without it. The action footer is still processed by the local Council
 * runtime, so connector absence is capability degradation rather than a transport failure. */
async function trySelectCouncilConnector(page: Page, signal?: AbortSignal, onPhase?: CouncilExecutionObserver): Promise<{ composer: Locator; connectorSelected: boolean }> {
  let composer = await visibleComposer(page);
  await composer.fill("");
  const selectedExactCount = await selectedCouncilConnector(composer).evaluateAll(elements => elements.filter(element => element.getAttribute("data-keyword") === COUNCIL_CONNECTOR_NAME).length);
  const initial = classifyCouncilConnectorObservation({ selectedExactCount, exactMenuRowCount: 0 });
  if (initial === "ambiguous") throw new Error("ChatGPT exposed duplicate CodexWeb Council connector selections");
  if (initial === "selected") {
    phase(onPhase, "connector-selected");
    return { composer, connectorSelected: true };
  }

  const menuRows = page.locator('.__menu-item[tabindex="0"]');
  const exactRow = menuRows.filter({ has: page.getByText(COUNCIL_CONNECTOR_NAME, { exact: true }) });
  const deadline = Date.now() + CONNECTOR_MENU_TIMEOUT_MS;
  while (Date.now() < deadline) {
    abortIfNeeded(signal);
    composer = await visibleComposer(page);
    await composer.fill("");
    await composer.focus();
    await composer.pressSequentially("@c", { delay: 20 });
    try {
      await exactRow.waitFor({ state: "visible", timeout: Math.min(1_250, Math.max(1, deadline - Date.now())) });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
    }
    const exactMenuRowCount = await exactRow.count().catch(() => 0);
    const disposition = classifyCouncilConnectorObservation({ selectedExactCount: 0, exactMenuRowCount });
    if (disposition === "ambiguous") throw new Error(`ChatGPT exposed duplicate exact ${JSON.stringify(COUNCIL_CONNECTOR_NAME)} connector rows`);
    if (disposition === "selectable" && await exactRow.isVisible().catch(() => false)) {
      await exactRow.click({ force: true, timeout: 10_000 });
      const selectedComposer = await visibleComposer(page);
      await selectedCouncilConnector(selectedComposer).waitFor({ state: "visible", timeout: 10_000 });
      if (!await councilConnectorIsSelected(selectedComposer)) throw new Error("ChatGPT did not commit the CodexWeb Council connector selection");
      phase(onPhase, "connector-selected");
      return { composer: selectedComposer, connectorSelected: true };
    }
  }

  await page.keyboard.press("Escape").catch(() => {});
  composer = await visibleComposer(page);
  await composer.fill("");
  return { composer, connectorSelected: false };
}

async function attachExactPrompt(page: Page, prompt: string, signal?: AbortSignal, onPhase?: CouncilExecutionObserver): Promise<Locator> {
  const { composer, connectorSelected } = await trySelectCouncilConnector(page, signal, onPhase);
  await composer.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  const transported = ` ${prompt}`;
  for (let offset = 0; offset < transported.length;) {
    abortIfNeeded(signal);
    let end = Math.min(offset + INSERT_CHUNK_CHARS, transported.length);
    if (end < transported.length) {
      const previous = transported.charCodeAt(end - 1);
      const next = transported.charCodeAt(end);
      if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end -= 1;
    }
    await page.keyboard.insertText(transported.slice(offset, end));
    offset = end;
  }
  const deadline = Date.now() + 10_000;
  let observed = "";
  do {
    abortIfNeeded(signal);
    observed = await composerText(composer);
    if (observed === prompt) {
      if (connectorSelected && !await councilConnectorIsSelected(composer)) throw new Error("CodexWeb Council connector selection disappeared while attaching the prompt");
      phase(onPhase, "prompt-attached");
      return composer;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  let prefix = 0;
  while (prefix < prompt.length && prompt[prefix] === observed[prefix]) prefix += 1;
  throw new Error(`ChatGPT Council composer did not preserve the complete prompt (expectedChars=${prompt.length}, actualChars=${observed.length}, commonPrefixChars=${prefix})`);
}

async function attachFiles(page: Page, composer: Locator, attachments: CouncilPromptAttachment[] = [], onPhase?: CouncilExecutionObserver): Promise<void> {
  if (attachments.length === 0) {
    phase(onPhase, "files-attached");
    return;
  }
  if (attachments.length > 20) throw new Error("Council manager turn supports at most 20 screenshot attachments");
  const input = page.locator('input[data-testid="upload-photos-input"]');
  await input.waitFor({ state: "attached", timeout: 20_000 });
  await input.setInputFiles(attachments.map(file => ({ name: file.name, mimeType: file.mimeType, buffer: file.buffer })));
  const form = composer.locator("xpath=ancestor::form[1]");
  for (const file of attachments) {
    await form.getByRole("group", { name: file.name, exact: true }).waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
  }
  phase(onPhase, "files-attached");
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
  return (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")).slice(0, 30_000);
}

async function approveCouncilToolIfNeeded(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"], [data-testid="tool-approval-card"]')
    .filter({ hasText: `Allow ChatGPT to use ${COUNCIL_CONNECTOR_NAME}?` })
    .last();
  if (!await dialog.isVisible().catch(() => false)) return;
  const allow = dialog.getByRole("button", { name: "Allow once", exact: true }).last();
  await allow.waitFor({ state: "visible", timeout: 10_000 });
  await allow.press("Enter");
}

function diagnosticSnapshot(text: string): Pick<import("./chatgpt-deep-state").CouncilChatGptSnapshot, "rateLimited" | "conversationLimit" | "connectionLost" | "terminalError"> {
  const compact = text.replace(/\s+/g, " ").trim();
  return {
    conversationLimit: /conversation (?:is )?too long|conversation limit|maximum context|start a new chat to continue/i.test(compact),
    rateLimited: /too many requests|making requests too quickly|rate limit|usage limit|message limit|you(?:'|’)ve reached|try again after|come back later/i.test(compact),
    connectionLost: /network error|connection error|failed to fetch|reconnecting|connection lost/i.test(compact),
    terminalError: /error generating|unable to generate|response failed|there was an error generating|something went wrong while generating/i.test(compact),
  };
}

async function genericUserInputRequired(page: Page): Promise<boolean> {
  const dialog = page.locator('[role="dialog"], [data-testid*="approval"], [data-testid*="confirmation"]').filter({ visible: true }).last();
  if (!await dialog.isVisible().catch(() => false)) return false;
  const text = (await dialog.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (text.includes(`Allow ChatGPT to use ${COUNCIL_CONNECTOR_NAME}?`)) return false;
  return /approval|approve|confirm|verification|verify|choose|select|continue|permission|required/i.test(text);
}

function throwDeepStateFailure(state: CouncilChatGptStateResult): void {
  if (state.state === "DOM_DRIFT") throw new Error(`ChatGPT Council DOM_DRIFT: ${state.reason}`);
  if (state.state === "RATE_LIMITED") throw new Error(`ChatGPT Council RATE_LIMITED: ${state.reason}`);
  if (state.state === "CONVERSATION_LIMIT") throw new Error(`ChatGPT Council CONVERSATION_LIMIT: ${state.reason}`);
  if (state.state === "CONNECTION_LOST") throw new Error(`ChatGPT Council CONNECTION_LOST: ${state.reason}`);
  if (state.state === "FAILED") throw new Error(`ChatGPT Council FAILED: ${state.reason}`);
  if (state.state === "WAITING_USER") throw new Error(`ChatGPT Council WAITING_USER: ${state.reason}`);
  if (state.state === "STALLED") throw new Error(`ChatGPT Council response stalled: ${state.reason}`);
}

async function sendAndWait(page: Page, prompt: string, attachments: CouncilPromptAttachment[] | undefined, signal?: AbortSignal, onPhase?: CouncilExecutionObserver): Promise<string> {
  abortIfNeeded(signal);
  const composer = await attachExactPrompt(page, prompt, signal, onPhase);
  await attachFiles(page, composer, attachments, onPhase);
  const assistantTurns = page.locator(CHATGPT_ASSISTANT_TURN_SELECTOR);
  const userTurns = page.locator(CHATGPT_USER_TURN_SELECTOR);
  const initialAssistantCount = await assistantTurns.count();
  const initialUserCount = await userTurns.count();
  const responseTurn = assistantTurns.nth(initialAssistantCount);
  const send = composer.locator("xpath=ancestor::form[1]").getByTestId("send-button");
  await send.waitFor({ state: "visible", timeout: 20_000 });
  if (!await send.isEnabled()) throw new Error("ChatGPT Council send button is disabled after prompt attachment");
  const submittedAt = Date.now();
  phase(onPhase, "submit-started");
  await send.press("Enter");

  const submissionDeadline = Date.now() + SUBMISSION_TIMEOUT_MS;
  let submissionObserved = false;
  while (Date.now() < submissionDeadline) {
    abortIfNeeded(signal);
    const [users, assistants, running] = await Promise.all([
      userTurns.count(),
      assistantTurns.count(),
      page.locator(CHATGPT_STOP_BUTTON_SELECTOR).filter({ visible: true }).count(),
    ]);
    if (users > initialUserCount || assistants > initialAssistantCount || running > 0) {
      submissionObserved = true;
      phase(onPhase, "submit-observed");
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!submissionObserved) throw new Error("ChatGPT Council did not accept the submitted prompt");

  const responseDeadline = submittedAt + RESPONSE_TIMEOUT_MS;
  let previousState: CouncilChatGptStateResult | undefined;
  let lastText = "";
  let lastAssistantMutationAt = submittedAt;
  let lastStatusMutationAt = submittedAt;
  let lastStatusSignature = "";
  let lastDiagnosticAt = 0;
  let diagnostic = { rateLimited: false, conversationLimit: false, connectionLost: false, terminalError: false };
  let emittedStreaming = false;

  while (Date.now() < responseDeadline) {
    abortIfNeeded(signal);
    if (page.isClosed()) throw new Error("ChatGPT Council browser surface closed during the turn");
    await approveCouncilToolIfNeeded(page);
    const now = Date.now();
    const present = await responseTurn.count() > 0;
    const text = present ? await currentAnswerText(responseTurn) : "";
    if (text !== lastText) {
      lastText = text;
      lastAssistantMutationAt = now;
    }
    const [running, completion, waitingUser] = await Promise.all([
      page.locator(CHATGPT_STOP_BUTTON_SELECTOR).filter({ visible: true }).count().then(count => count > 0),
      present ? responseTurn.locator(CHATGPT_COMPLETION_ACTION_SELECTOR).filter({ visible: true }).count().then(count => count > 0) : Promise.resolve(false),
      genericUserInputRequired(page),
    ]);
    const statusSignature = `${present}:${running}:${completion}:${waitingUser}`;
    if (statusSignature !== lastStatusSignature) {
      lastStatusSignature = statusSignature;
      lastStatusMutationAt = now;
    }
    if (now - lastDiagnosticAt >= DIAGNOSTIC_SAMPLE_MS) {
      diagnostic = diagnosticSnapshot(await bodyDiagnosticText(page));
      lastDiagnosticAt = now;
    }

    const nextState = deriveCouncilChatGptState({
      composerPresent: true,
      responsePresent: present,
      assistantText: text,
      responseSignature: text,
      completionActionVisible: completion,
      generationRunning: running,
      stopVisible: running,
      waitingUser,
      ...diagnostic,
      toolActivities: [],
      lastAssistantMutationAt,
      lastStatusMutationAt,
    }, { submittedAt }, previousState, now);
    previousState = nextState;

    if (present && !emittedStreaming && ["THINKING", "DEEP_THINKING", "STREAMING", "TOOL_RUNNING", "COMPLETING", "COMPLETED"].includes(nextState.state)) {
      emittedStreaming = true;
      phase(onPhase, "response-streaming");
    }
    if (nextState.state === "COMPLETED") {
      phase(onPhase, "response-complete");
      return nextState.lastAssistantText;
    }
    throwDeepStateFailure(nextState);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`ChatGPT Council response exceeded the ${Math.round(RESPONSE_TIMEOUT_MS / 60_000)} minute hard wall-clock limit`);
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

async function scrollConversationToBottom(page: Page, signal?: AbortSignal): Promise<void> {
  for (let pass = 0; pass < 6; pass++) {
    abortIfNeeded(signal);
    await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
      const candidates = [...document.querySelectorAll<HTMLElement>("main, [role='main'], [class*='overflow-y-auto'], [class*='overflow-auto']")];
      for (const element of candidates) {
        if (element.scrollHeight > element.clientHeight + 8) element.scrollTop = element.scrollHeight;
      }
    });
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await new Promise(resolve => setTimeout(resolve, 500));
}

function healthFromDiagnostic(text: string): { health: CouncilObservationHealth; note?: string } {
  const compact = text.replace(/\s+/g, " ").trim();
  if (/too many requests|making requests too quickly|rate limit/i.test(compact)) return { health: "limited", note: "ChatGPT rate-limit evidence is visible" };
  if (/you(?:'|’)ve reached|reached .* limit|usage limit|message limit|try again after|come back later/i.test(compact)) return { health: "limited", note: "ChatGPT usage/message-limit evidence is visible" };
  if (/sign in|log in|session expired|failed to load subscription/i.test(compact)) return { health: "signed-out", note: "ChatGPT authentication/session evidence is unhealthy" };
  if (/something went wrong|network error|connection error|failed to fetch/i.test(compact)) return { health: "connection-error", note: "ChatGPT connection/error evidence is visible" };
  return { health: "healthy" };
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
      phase(input.onPhase, "conversation-ready");
      const answer = await sendAndWait(page, input.prompt, input.attachments, input.signal, input.onPhase);
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
      if (current.origin !== "https://chatgpt.com" || current.pathname !== "/" || current.search) await navigateBeforeSubmit(page, CHATGPT_HOME_URL);
      try { await visibleComposer(page); }
      catch (error) {
        if (surfaceUnavailable(page)) throw new CouncilSurfaceUnavailableError(`Council browser surface unavailable before composer became ready (${page.url()})`);
        throw error;
      }
      phase(input.onPhase, "conversation-ready");
      const answer = await sendAndWait(page, input.prompt, input.attachments, input.signal, input.onPhase);
      return { answer, conversationUrl: await waitForConversationUrl(page) };
    } finally {
      await connection.browser.close().catch(() => {});
    }
  }

  async focus(input: { surfaceId: string; conversationUrl: string; signal?: AbortSignal }): Promise<{ conversationUrl: string }> {
    const expected = assertChatGptConversationUrl(input.conversationUrl);
    const connection = await connectLauncherBrowserHost(this.descriptorPath, PAGE_TIMEOUT_MS, input.surfaceId, input.signal);
    try {
      const page = connection.page;
      if (page.isClosed()) throw new CouncilSurfaceUnavailableError("Council browser surface closed before conversation focus");
      if (page.url() !== expected) await navigateBeforeSubmit(page, expected);
      await new Promise(resolve => setTimeout(resolve, 250));
      const diagnostic = await bodyDiagnosticText(page);
      const surface = classifyConversationSurface(expected, page.url(), diagnostic);
      if (surface === "surface-unavailable") throw new CouncilSurfaceUnavailableError(`Council browser surface unavailable before focus (${page.url()})`);
      if (surface === "unavailable") throw new CouncilConversationUnavailableError(`ChatGPT conversation is unavailable: ${expected}`);
      if (surface === "invalid") throw new Error(`ChatGPT persistent surface left the expected origin: ${page.url()}`);
      try { await visibleComposer(page); }
      catch (error) {
        if (surfaceUnavailable(page)) throw new CouncilSurfaceUnavailableError(`Council browser surface unavailable before focus became ready (${page.url()})`);
        const state = classifyConversationSurface(expected, page.url(), await bodyDiagnosticText(page));
        if (state === "unavailable") throw new CouncilConversationUnavailableError(`ChatGPT conversation is unavailable: ${expected}`);
        throw error;
      }
      return { conversationUrl: assertChatGptConversationUrl(page.url()) };
    } finally {
      await connection.browser.close().catch(() => {});
    }
  }

  async capture(input: { surfaceId: string; conversationUrl: string; signal?: AbortSignal }): Promise<{ png: Buffer; conversationUrl: string; health: CouncilObservationHealth; note?: string }> {
    const expected = assertChatGptConversationUrl(input.conversationUrl);
    const connection = await connectLauncherBrowserHost(this.descriptorPath, PAGE_TIMEOUT_MS, input.surfaceId, input.signal);
    try {
      const page = connection.page;
      if (page.isClosed()) throw new CouncilSurfaceUnavailableError("Council browser surface closed before observation capture");
      if (page.url() !== expected) await navigateBeforeSubmit(page, expected);
      await new Promise(resolve => setTimeout(resolve, 350));
      const diagnostic = await bodyDiagnosticText(page);
      const surface = classifyConversationSurface(expected, page.url(), diagnostic);
      if (surface === "surface-unavailable") throw new CouncilSurfaceUnavailableError(`Council browser surface unavailable before capture (${page.url()})`);
      if (surface === "unavailable") throw new CouncilConversationUnavailableError(`ChatGPT conversation is unavailable: ${expected}`);
      if (surface === "invalid") throw new Error(`ChatGPT observation surface left the expected origin: ${page.url()}`);
      await scrollConversationToBottom(page, input.signal);
      const freshDiagnostic = await bodyDiagnosticText(page);
      const health = healthFromDiagnostic(freshDiagnostic);
      const png = await page.screenshot({ type: "png", fullPage: false, animations: "disabled", caret: "hide", timeout: 20_000 });
      return { png, conversationUrl: assertChatGptConversationUrl(page.url()), ...health };
    } finally {
      await connection.browser.close().catch(() => {});
    }
  }
}
