import { randomUUID } from "node:crypto";
import { ChatGptBrowserWorker } from "../adapters/chatgpt-web/browser-worker";
import { CHATGPT_WEB_LUNA_MODEL_ID, CHATGPT_WEB_MODEL_ID, type ChatGptWebCapabilities } from "../adapters/chatgpt-web/model";
import { loadConfig, providerConfig, type AppConfig } from "../config";
import { CouncilStore } from "./store";
import type { CouncilContextPacket, CouncilWakeEvent } from "./types";

export const COUNCIL_CONNECTOR_NAME = "CodexWeb Council";
export function buildCouncilWakePrompt(packet: CouncilContextPacket): string {
  return ["<codexweb_council_wake>", "You are being resumed as a named participant in a local ChatGPT Council.", "This is a continuity packet, not a request to reveal private chain-of-thought.", "", `IDENTITY: ${packet.identity.id} (${packet.identity.name}) — ${packet.identity.role}`, `ROOM: ${packet.room.id} — ${packet.room.name}`, `MISSION: ${packet.room.mission}`, `WAKE REASON: ${packet.wake?.reason ?? "Council continuation"}`, "", "Required protocol:", `1. Call council_join with agent_id=${JSON.stringify(packet.identity.id)}, name=${JSON.stringify(packet.identity.name)}, role=${JSON.stringify(packet.identity.role)}.`, `2. Call council_context for room_id=${JSON.stringify(packet.room.id)} and read the latest shared state before deciding what to do.`, "3. Read/reply to relevant Council messages. Do not merely answer this transport prompt; record useful discussion in the Council room with council_say/council_reply.", "4. If the deliberation is mature and your role permits it, record a decision and create/assign concrete tasks. Otherwise challenge assumptions, add evidence, or request another participant with council_wake.", "5. Save a compact council_checkpoint before finishing so a later wake can restore you quickly.", "6. Do not expose credentials, connector internals, hidden reasoning, or chain-of-thought. Share conclusions, evidence, objections, decisions, and work state only.", "", "BOOTSTRAP CONTEXT PACKET:", JSON.stringify(packet, null, 2), "</codexweb_council_wake>"].join("\n");
}
function wakeProvider(config: AppConfig) { const provider = providerConfig(config); provider.chatgptWeb = { ...provider.chatgptWeb, appName: COUNCIL_CONNECTOR_NAME, localToolsEnabled: true }; return provider; }

export class CouncilWakeEngine {
  private readonly tails = new Map<string, Promise<void>>(); private readonly config: AppConfig; private readonly worker: ChatGptBrowserWorker;
  constructor(private readonly store: CouncilStore, config: AppConfig = loadConfig()) { this.config = config; this.worker = ChatGptBrowserWorker.forProvider(wakeProvider(config)); }
  enqueue(wake: CouncilWakeEvent): void { const previous = this.tails.get(wake.targetAgentId) ?? Promise.resolve(); const next = previous.catch(() => {}).then(() => this.deliver(wake.id)); this.tails.set(wake.targetAgentId, next); void next.finally(() => { if (this.tails.get(wake.targetAgentId) === next) this.tails.delete(wake.targetAgentId); }).catch(() => {}); }
  private async deliver(wakeId: string): Promise<void> {
    const initial = this.store.snapshot().wakes.find(candidate => candidate.id === wakeId); if (!initial || initial.status !== "pending") return;
    if (this.config.mode !== "full") { this.store.updateWake(wakeId, "failed", "Council wake delivery requires the Full MCP/tunnel mode"); return; }
    const target = initial.targetAgentId;
    try {
      this.store.updateWake(wakeId, "delivering"); this.store.setAgentStatus(target, "awake"); const packet = this.store.buildContextPacket({ agentId: target, roomId: initial.roomId, wakeId }); const before = this.store.snapshot(); const authoredBefore = before.messages.filter(message => message.roomId === initial.roomId && message.authorAgentId === target).length; const checkpointBefore = before.checkpoints.find(item => item.agentId === target && item.roomId === initial.roomId)?.updatedAt;
      const capabilities: ChatGptWebCapabilities = { localToolsEnabled: true, solAvailable: this.config.solAvailable, proAvailable: this.config.proAvailable }; const modelId = this.config.solAvailable ? CHATGPT_WEB_MODEL_ID : CHATGPT_WEB_LUNA_MODEL_ID; const reasoning = this.config.solAvailable ? "high" : "low"; const deltas: string[] = [];
      const answer = await this.worker.run({ traceId: `councilwake_${randomUUID().replaceAll("-", "")}`, modelId, reasoning, capabilities, prepare: async () => ({ text: buildCouncilWakePrompt(packet), images: [], release: () => {} }), onTextDelta: delta => deltas.push(delta) });
      const finalText = answer.trim() || deltas.join("").trim(); const after = this.store.snapshot(); const authoredAfter = after.messages.filter(message => message.roomId === initial.roomId && message.authorAgentId === target).length;
      if (authoredAfter === authoredBefore && finalText) this.store.say({ roomId: initial.roomId, authorAgentId: target, kind: "message", body: finalText.slice(0, 24_000), mentions: initial.sourceAgentId ? [initial.sourceAgentId] : [] });
      const checkpointAfter = this.store.snapshot().checkpoints.find(item => item.agentId === target && item.roomId === initial.roomId)?.updatedAt; if (checkpointAfter === checkpointBefore && finalText) this.store.checkpoint({ agentId: target, roomId: initial.roomId, summary: `Wake ${wakeId} completed.\n\n${finalText.slice(0, 20_000)}` });
      this.store.updateWake(wakeId, "acknowledged"); this.store.setAgentStatus(target, "sleeping");
    } catch (error) { const message = error instanceof Error ? error.message : String(error); this.store.updateWake(wakeId, "failed", message.slice(0, 4_000)); this.store.setAgentStatus(target, "sleeping"); console.error(`[council-wake] ${wakeId} failed: ${message}`); }
  }
}
