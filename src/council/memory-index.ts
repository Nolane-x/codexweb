import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type CouncilMemorySourceType = "manager-analysis" | "observation" | "decision" | "task" | "audit" | "digest";
export interface CouncilMemoryEntry {
  id: string;
  projectRoomId: string;
  sourceType: CouncilMemorySourceType;
  sourceId: string;
  text: string;
  agentIds: string[];
  taskIds: string[];
  createdAt: string;
  updatedAt: string;
}
export interface CouncilMemoryResult extends CouncilMemoryEntry {
  score: number;
  provenance: { sourceType: CouncilMemorySourceType; sourceId: string };
}
interface MemoryState { version: 1; entries: CouncilMemoryEntry[] }

const DEFAULT_MAX_ENTRIES = 20_000;
const DEFAULT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function safeId(value: string, label: string): string {
  const id = value.trim();
  if (!ID.test(id)) throw new Error(`Council memory ${label} is invalid`);
  return id;
}
function sanitize(value: string): string {
  return value
    .replace(/[\r\t]+/g, " ")
    .replace(/https?:\/\/[^\s)\]}>,]+/gi, "[url]")
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)+[^\s]*/g, "[path]")
    .replace(/(?:^|\s)\/(?:Users|home|var|tmp|private|mnt|opt|srv)\/[^\s]*/g, match => `${match.startsWith(" ") ? " " : ""}[path]`)
    .replace(/((?:bearer|token|api[_ -]?key))\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}
function tokens(value: string): string[] {
  return [...new Set(value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\p{L}\p{N}]+/gu, " ").split(/\s+/).filter(token => token.length >= 2).slice(0, 80))];
}
function stableId(projectRoomId: string, sourceType: CouncilMemorySourceType, sourceId: string): string {
  return `mem_${createHash("sha256").update(`${projectRoomId}\0${sourceType}\0${sourceId}`).digest("hex").slice(0, 32)}`;
}
function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class CouncilMemoryIndex {
  private readonly path: string;
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly maxAgeMs: number;
  private state: MemoryState;

  constructor(path: string, options: { now?: () => number; maxEntries?: number; maxAgeMs?: number } = {}) {
    this.path = path;
    this.now = options.now ?? Date.now;
    this.maxEntries = Math.max(100, Math.min(100_000, Math.trunc(options.maxEntries ?? DEFAULT_MAX_ENTRIES)));
    this.maxAgeMs = Math.max(24 * 60 * 60 * 1_000, Math.min(365 * 24 * 60 * 60 * 1_000, Math.trunc(options.maxAgeMs ?? DEFAULT_MAX_AGE_MS)));
    this.state = this.load();
    this.prune();
  }

  upsert(input: { projectRoomId: string; sourceType: CouncilMemorySourceType; sourceId: string; text: string; agentIds?: string[]; taskIds?: string[]; createdAt?: string }): CouncilMemoryEntry {
    const projectRoomId = safeId(input.projectRoomId, "projectRoomId");
    const sourceId = safeId(input.sourceId, "sourceId");
    const text = sanitize(input.text);
    if (!text) throw new Error("Council memory text is empty after sanitization");
    const id = stableId(projectRoomId, input.sourceType, sourceId);
    const now = new Date(this.now()).toISOString();
    const existing = this.state.entries.find(entry => entry.id === id);
    const agentIds = [...new Set((input.agentIds ?? []).map(value => safeId(value, "agentId")))].sort().slice(0, 32);
    const taskIds = [...new Set((input.taskIds ?? []).map(value => safeId(value, "taskId")))].sort().slice(0, 32);
    const createdAt = existing?.createdAt ?? (input.createdAt && Number.isFinite(new Date(input.createdAt).getTime()) ? new Date(input.createdAt).toISOString() : now);
    if (existing && existing.text === text && sameList(existing.agentIds, agentIds) && sameList(existing.taskIds, taskIds)) return structuredClone(existing);
    const entry: CouncilMemoryEntry = {
      id,
      projectRoomId,
      sourceType: input.sourceType,
      sourceId,
      text,
      agentIds,
      taskIds,
      createdAt,
      updatedAt: now,
    };
    if (existing) Object.assign(existing, entry);
    else this.state.entries.push(entry);
    this.prune();
    this.write();
    return structuredClone(entry);
  }

  deleteSource(sourceType: CouncilMemorySourceType, sourceId: string): number {
    const id = safeId(sourceId, "sourceId");
    const before = this.state.entries.length;
    this.state.entries = this.state.entries.filter(entry => !(entry.sourceType === sourceType && entry.sourceId === id));
    const removed = before - this.state.entries.length;
    if (removed) this.write();
    return removed;
  }

  deleteProjectSource(projectRoomId: string, sourceType: CouncilMemorySourceType, sourceId: string): number {
    const room = safeId(projectRoomId, "projectRoomId");
    const source = safeId(sourceId, "sourceId");
    const before = this.state.entries.length;
    this.state.entries = this.state.entries.filter(entry => !(entry.projectRoomId === room && entry.sourceType === sourceType && entry.sourceId === source));
    const removed = before - this.state.entries.length;
    if (removed) this.write();
    return removed;
  }

  retainProjectSources(projectRoomId: string, sourceType: CouncilMemorySourceType, sourceIds: Iterable<string>): number {
    const room = safeId(projectRoomId, "projectRoomId");
    const allowed = new Set([...sourceIds].map(value => safeId(value, "sourceId")));
    const before = this.state.entries.length;
    this.state.entries = this.state.entries.filter(entry => entry.projectRoomId !== room || entry.sourceType !== sourceType || allowed.has(entry.sourceId));
    const removed = before - this.state.entries.length;
    if (removed) this.write();
    return removed;
  }

  search(input: { projectRoomId: string; query: string; limit?: number; sourceTypes?: CouncilMemorySourceType[]; agentId?: string; taskId?: string }): CouncilMemoryResult[] {
    const room = safeId(input.projectRoomId, "projectRoomId");
    const queryTokens = tokens(input.query);
    if (!queryTokens.length) return [];
    const now = this.now();
    const limit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 10)));
    const agent = input.agentId ? safeId(input.agentId, "agentId") : undefined;
    const task = input.taskId ? safeId(input.taskId, "taskId") : undefined;
    return this.state.entries
      .filter(entry => entry.projectRoomId === room)
      .filter(entry => !input.sourceTypes?.length || input.sourceTypes.includes(entry.sourceType))
      .filter(entry => !agent || entry.agentIds.includes(agent))
      .filter(entry => !task || entry.taskIds.includes(task))
      .map(entry => {
        const haystack = new Set(tokens(`${entry.text} ${entry.agentIds.join(" ")} ${entry.taskIds.join(" ")} ${entry.sourceType}`));
        const matches = queryTokens.filter(token => haystack.has(token)).length;
        const coverage = matches / queryTokens.length;
        const ageDays = Math.max(0, (now - new Date(entry.updatedAt).getTime()) / 86_400_000);
        const recency = 1 / (1 + ageDays / 14);
        const score = coverage * 0.85 + recency * 0.15;
        return { ...structuredClone(entry), score, provenance: { sourceType: entry.sourceType, sourceId: entry.sourceId } } satisfies CouncilMemoryResult;
      })
      .filter(result => result.score > 0.15)
      .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  recent(input: { projectRoomId: string; limit?: number; sourceTypes?: CouncilMemorySourceType[] }): CouncilMemoryResult[] {
    const room = safeId(input.projectRoomId, "projectRoomId");
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 20)));
    return this.state.entries
      .filter(entry => entry.projectRoomId === room && (!input.sourceTypes?.length || input.sourceTypes.includes(entry.sourceType)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(entry => ({ ...structuredClone(entry), score: 1, provenance: { sourceType: entry.sourceType, sourceId: entry.sourceId } }));
  }

  stats(projectRoomId?: string): { entries: number; oldestAt: string | null; newestAt: string | null } {
    const room = projectRoomId ? safeId(projectRoomId, "projectRoomId") : undefined;
    const entries = room ? this.state.entries.filter(entry => entry.projectRoomId === room) : this.state.entries;
    const ordered = [...entries].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    return { entries: entries.length, oldestAt: ordered[0]?.updatedAt ?? null, newestAt: ordered.at(-1)?.updatedAt ?? null };
  }

  clearProject(projectRoomId: string): number {
    const room = safeId(projectRoomId, "projectRoomId");
    const before = this.state.entries.length;
    this.state.entries = this.state.entries.filter(entry => entry.projectRoomId !== room);
    const removed = before - this.state.entries.length;
    if (removed) this.write();
    return removed;
  }

  private prune(): void {
    const cutoff = this.now() - this.maxAgeMs;
    this.state.entries = this.state.entries.filter(entry => new Date(entry.updatedAt).getTime() >= cutoff);
    if (this.state.entries.length > this.maxEntries) this.state.entries = this.state.entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, this.maxEntries);
  }

  private load(): MemoryState {
    if (!existsSync(this.path)) return { version: 1, entries: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as MemoryState;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) throw new Error("invalid memory index");
      return parsed;
    } catch (error) {
      try { renameSync(this.path, `${this.path}.corrupt-${Date.now()}`); } catch {}
      throw new Error(`Council memory index is corrupt and was quarantined: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private write(): void {
    const directory = dirname(this.path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { chmodSync(directory, 0o700); } catch {}
    const temp = `${this.path}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      renameSync(temp, this.path);
      try { chmodSync(this.path, 0o600); } catch {}
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }
}
