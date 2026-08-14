import * as z from "zod/v4";
import type { CouncilWakeEvent } from "./types";
export const agentIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
export const roomIdSchema = agentIdSchema;
export const messageIdSchema = z.string().trim().min(1).max(128);
export const bodySchema = z.string().trim().min(1).max(24_000);
export const actorSchema = { agent_id: agentIdSchema.optional() };
export type ResolveCouncilActor = (extra: unknown, explicit?: string) => string;
export interface CouncilWakeDelivery { enqueue(wake: CouncilWakeEvent): void; }
export function councilMcpResult(value: unknown) { const structured = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { value }; return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: structured }; }
export function councilMcpSessionId(extra: unknown): string | undefined { if (!extra || typeof extra !== "object" || Array.isArray(extra)) return undefined; const value = (extra as { sessionId?: unknown }).sessionId; return typeof value === "string" && value.trim() ? value.trim() : undefined; }
