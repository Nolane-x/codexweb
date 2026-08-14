export const MAX_ACTIVE_AGENT_SURFACES = 5;
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type CouncilManagedAgentStatus = "active" | "sleeping" | "queued" | "failed";

export interface CouncilManagedAgent {
  id: string;
  name: string;
  role: string;
  mandate: string;
  status: CouncilManagedAgentStatus;
  surfaceId?: string;
  conversationUrl?: string;
  lastCouncilEventId?: string;
  checkpoint?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CouncilAgentLease {
  agentId: string;
  status: "active" | "queued";
  surfaceId?: string;
}

export class CouncilAgentRegistry {
  private readonly agents = new Map<string, CouncilManagedAgent>();
  private readonly surfaceOwners = new Map<string, string>();

  register(input: { id: string; name: string; role: string; mandate: string }): CouncilManagedAgent {
    const id = input.id.trim();
    if (!AGENT_ID.test(id)) throw new Error("agent id is invalid");
    if (this.agents.has(id)) throw new Error(`agent already exists: ${id}`);
    const now = new Date().toISOString();
    const agent: CouncilManagedAgent = {
      id,
      name: required(input.name, "agent name", 120),
      role: required(input.role, "agent role", 200),
      mandate: required(input.mandate, "agent mandate", 4_000),
      status: "sleeping",
      createdAt: now,
      updatedAt: now,
    };
    this.agents.set(id, agent);
    return clone(agent);
  }

  get(agentId: string): CouncilManagedAgent | undefined {
    const value = this.agents.get(agentId);
    return value ? clone(value) : undefined;
  }

  list(): CouncilManagedAgent[] { return [...this.agents.values()].map(clone); }

  lease(agentId: string): CouncilAgentLease {
    const agent = this.require(agentId);
    if (agent.surfaceId && this.surfaceOwners.get(agent.surfaceId) === agent.id) {
      agent.status = "active";
      agent.updatedAt = new Date().toISOString();
      return { agentId: agent.id, status: "active", surfaceId: agent.surfaceId };
    }
    for (let index = 1; index <= MAX_ACTIVE_AGENT_SURFACES; index++) {
      const surfaceId = `council-surface-${index}`;
      if (this.surfaceOwners.has(surfaceId)) continue;
      this.surfaceOwners.set(surfaceId, agent.id);
      agent.surfaceId = surfaceId;
      agent.status = "active";
      agent.updatedAt = new Date().toISOString();
      return { agentId: agent.id, status: "active", surfaceId };
    }
    agent.status = "queued";
    agent.updatedAt = new Date().toISOString();
    return { agentId: agent.id, status: "queued" };
  }

  release(agentId: string): CouncilManagedAgent {
    const agent = this.require(agentId);
    if (agent.surfaceId && this.surfaceOwners.get(agent.surfaceId) === agent.id) {
      this.surfaceOwners.delete(agent.surfaceId);
      delete agent.surfaceId;
    }
    if (agent.status !== "failed") agent.status = "sleeping";
    agent.updatedAt = new Date().toISOString();
    return clone(agent);
  }

  bindConversation(agentId: string, input: { surfaceId: string; conversationUrl: string }): CouncilManagedAgent {
    const agent = this.require(agentId);
    if (!input.surfaceId || this.surfaceOwners.get(input.surfaceId) !== agent.id) throw new Error("surface is not leased by agent");
    const url = new URL(input.conversationUrl);
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com" || !url.pathname.startsWith("/c/")) throw new Error("conversation URL is not a ChatGPT conversation");
    agent.surfaceId = input.surfaceId;
    agent.conversationUrl = url.toString();
    agent.updatedAt = new Date().toISOString();
    return clone(agent);
  }

  markFailed(agentId: string): CouncilManagedAgent {
    const agent = this.require(agentId);
    agent.status = "failed";
    agent.updatedAt = new Date().toISOString();
    return clone(agent);
  }

  private require(agentId: string): CouncilManagedAgent {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`agent does not exist: ${agentId}`);
    return agent;
  }
}

function required(value: string, label: string, max: number): string {
  const text = value.trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return text;
}
function clone<T>(value: T): T { return structuredClone(value); }
