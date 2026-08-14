import * as z from "zod/v4";
import type { CouncilWakeEvent } from "./types";

export const agentIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
export const agentTokenSchema = z.string().trim().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const roomIdSchema = agentIdSchema;
export const messageIdSchema = z.string().trim().min(1).max(128);
export const bodySchema = z.string().trim().min(1).max(24_000);
export const actorSchema = { agent_id: agentIdSchema, agent_token: agentTokenSchema };
export type ResolveCouncilActor = (extra: unknown, explicit?: string, token?: string) => string;
export interface CouncilWakeDelivery { enqueue(wake: CouncilWakeEvent): void; }

export function assertAgentTokenNotExposed(agentToken: string, values: readonly unknown[]): void {
  const visit = (value: unknown): boolean => {
    if (typeof value === "string") return value.includes(agentToken);
    if (Array.isArray(value)) return value.some(visit);
    if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some(visit);
    return false;
  };
  if (values.some(visit)) throw new Error("Council mutation rejected because it would expose the caller's private agent_token");
}

export function councilMcpResult(value: unknown) { const structured = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { value }; return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: structured }; }
