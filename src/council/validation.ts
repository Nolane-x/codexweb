import type { CouncilState } from "./types";

export const COUNCIL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const MAX_COUNCIL_TEXT = 24_000;
export const MAX_COUNCIL_MESSAGES = 5_000;
export const MAX_COUNCIL_DECISIONS = 1_000;
export const MAX_COUNCIL_TASKS = 2_000;
export const MAX_COUNCIL_WAKES = 2_000;
export const DEFAULT_RECENT_MESSAGES = 40;

export function councilNow(): string { return new Date().toISOString(); }
export function assertCouncilId(value: string, label: string): string { const trimmed = value.trim(); if (!COUNCIL_ID.test(trimmed)) throw new Error(`${label} must match ${COUNCIL_ID}`); return trimmed; }
export function councilText(value: string, label: string, max = MAX_COUNCIL_TEXT): string { const trimmed = value.trim(); if (!trimmed) throw new Error(`${label} must not be empty`); if (trimmed.length > max) throw new Error(`${label} exceeds ${max} characters`); return trimmed; }
export function councilStringList(values: readonly string[] | undefined, label: string, maxItems = 64): string[] { if (!values) return []; if (values.length > maxItems) throw new Error(`${label} exceeds ${maxItems} items`); return values.map((value, index) => councilText(value, `${label}[${index}]`, 2_000)); }
export function emptyCouncilState(): CouncilState { return { version: 1, agents: [], rooms: [], messages: [], decisions: [], tasks: [], wakes: [], checkpoints: [] }; }
export function assertCouncilState(value: unknown): CouncilState { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Council state is not an object"); const state = value as Partial<CouncilState>; if (state.version !== 1) throw new Error("Council state version is unsupported"); for (const key of ["agents", "rooms", "messages", "decisions", "tasks", "wakes", "checkpoints"] as const) { if (!Array.isArray(state[key])) throw new Error(`Council state is missing ${key}`); } return state as CouncilState; }
