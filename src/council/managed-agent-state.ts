import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { assertChatGptConversationUrl } from "./conversation-registry";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const COUNCIL_PERMISSIONS = ["spawn", "finalize", "reopen", "assign", "wake", "review"] as const;
export type CouncilPermission = typeof COUNCIL_PERMISSIONS[number];
const PERMISSIONS = new Set<string>(COUNCIL_PERMISSIONS);

export interface ManagedAgentRecord {
  id: string;
  name: string;
  role: string;
  mandate: string;
  permissions: CouncilPermission[];
  conversationUrl?: string;
  checkpoint?: string;
  createdAt: string;
  updatedAt: string;
}
interface ManagedAgentFileState { version: 1; agents: ManagedAgentRecord[] }

function text(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return normalized;
}

export class ManagedAgentStateStore {
  private state: ManagedAgentFileState;
  private readonly path: string;

  constructor(path: string) { this.path = path; this.state = this.load(); }

  private load(): ManagedAgentFileState {
    if (!existsSync(this.path)) return { version: 1, agents: [] };
    const raw = JSON.parse(readFileSync(this.path, "utf8")) as Partial<ManagedAgentFileState>;
    if (raw.version !== 1 || !Array.isArray(raw.agents)) throw new Error("managed agent state is invalid");
    return raw as ManagedAgentFileState;
  }

  private persist(): void {
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

  upsert(input: { id: string; name: string; role: string; mandate: string; permissions: CouncilPermission[] }): ManagedAgentRecord {
    const id = input.id.trim();
    if (!ID.test(id)) throw new Error("agent id is invalid");
    const permissions = [...new Set(input.permissions)];
    if (permissions.some(permission => !PERMISSIONS.has(permission))) throw new Error("agent permission is invalid");
    const now = new Date().toISOString();
    const existing = this.state.agents.find(agent => agent.id === id);
    if (existing) {
      existing.name = text(input.name, "name", 120);
      existing.role = text(input.role, "role", 200);
      existing.mandate = text(input.mandate, "mandate", 4_000);
      existing.permissions = permissions;
      existing.updatedAt = now;
      this.persist();
      return structuredClone(existing);
    }
    const record: ManagedAgentRecord = { id, name: text(input.name, "name", 120), role: text(input.role, "role", 200), mandate: text(input.mandate, "mandate", 4_000), permissions, createdAt: now, updatedAt: now };
    this.state.agents.push(record);
    this.persist();
    return structuredClone(record);
  }

  bindConversation(agentId: string, value: string): ManagedAgentRecord {
    const agent = this.require(agentId);
    agent.conversationUrl = assertChatGptConversationUrl(value);
    agent.updatedAt = new Date().toISOString();
    this.persist();
    return structuredClone(agent);
  }

  checkpoint(agentId: string, summary: string): ManagedAgentRecord {
    const agent = this.require(agentId);
    agent.checkpoint = text(summary, "checkpoint", 24_000);
    agent.updatedAt = new Date().toISOString();
    this.persist();
    return structuredClone(agent);
  }

  get(agentId: string): ManagedAgentRecord | undefined {
    const agent = this.state.agents.find(candidate => candidate.id === agentId);
    return agent ? structuredClone(agent) : undefined;
  }
  list(): ManagedAgentRecord[] { return structuredClone(this.state.agents); }

  private require(agentId: string): ManagedAgentRecord {
    const agent = this.state.agents.find(candidate => candidate.id === agentId);
    if (!agent) throw new Error(`managed agent does not exist: ${agentId}`);
    return agent;
  }
}
