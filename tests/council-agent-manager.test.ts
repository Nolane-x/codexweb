import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilAgentManager } from "../src/council/agent-manager";
import { ManagedAgentStateStore } from "../src/council/managed-agent-state";

class FakeCouncil {
  state: any = { version: 1, agents: [], credentials: [], rooms: [{ id: "core", name: "Core", mission: "Build", createdAt: "", updatedAt: "" }], messages: [], tasks: [], decisions: [], wakes: [], checkpoints: [] };
  snapshot() { return structuredClone(this.state); }
  transaction<T>(work: (store: FakeCouncil) => T): T { const before = structuredClone(this.state); try { return work(this); } catch (error) { this.state = before; throw error; } }
  joinAgent(input: any) { if (!this.state.agents.some((agent: any) => agent.id === input.id)) this.state.agents.push({ ...input, joinedAt: "", updatedAt: "" }); return { agent: input, agentToken: "x", credentialIssued: true }; }
  say(input: any) { const id = `m${this.state.messages.length + 1}`; const message = { id, threadId: input.replyTo || id, createdAt: "", ...input }; this.state.messages.push(message); return message; }
  readRoom(id: string, limit = 40) { return this.state.messages.filter((message: any) => message.roomId === id).slice(-limit); }
  createTask(input: any) { const task = { id: `t${this.state.tasks.length + 1}`, status: "todo", createdAt: "", updatedAt: "", ...input }; this.state.tasks.push(task); return task; }
  updateTask(input: any) { const task = this.state.tasks.find((candidate: any) => candidate.id === input.taskId); if (!task) throw new Error("task does not exist"); Object.assign(task, { status: input.status, assigneeAgentId: input.assigneeAgentId ?? task.assigneeAgentId }); return task; }
  decide(input: any) { const decision = { id: `d${this.state.decisions.length + 1}`, createdAt: "", ...input }; this.state.decisions.push(decision); return decision; }
  wake(input: any) { const wake = { id: `w${this.state.wakes.length + 1}`, status: "pending", attempts: 0, createdAt: new Date().toISOString(), updatedAt: "", ...input }; this.state.wakes.push(wake); return wake; }
  updateWake(id: string, status: string, lastError?: string) { const wake = this.state.wakes.find((candidate: any) => candidate.id === id); wake.status = status; if (lastError) wake.lastError = lastError; return wake; }
  checkpoint(input: any) { const checkpoint = { updatedAt: "", ...input }; this.state.checkpoints.push(checkpoint); return checkpoint; }
  buildContextPacket(input: any) { return { identity: this.state.agents.find((agent: any) => agent.id === input.agentId), room: this.state.rooms.find((room: any) => room.id === input.roomId), recentMessages: this.readRoom(input.roomId, 12), decisions: this.state.decisions, tasks: this.state.tasks, generatedAt: "", instruction: "" }; }
}

class FakeRegistry {
  agents = new Map<string, any>();
  register(input: any) { this.agents.set(input.id, { ...input, status: "sleeping" }); return this.get(input.id); }
  get(id: string) { const agent = this.agents.get(id); return agent && { ...agent }; }
  lease(id: string) { const agent = this.agents.get(id); agent.status = "active"; agent.surfaceId = "A".repeat(32); return { agentId: id, status: "active", surfaceId: agent.surfaceId }; }
  release(id: string) { const agent = this.agents.get(id); if (agent) { agent.status = "sleeping"; delete agent.surfaceId; } return this.get(id); }
  bindConversation(id: string, input: any) { const agent = this.agents.get(id); agent.conversationUrl = input.conversationUrl; return this.get(id); }
}

describe("CouncilAgentManager", () => {
  test("lead spawns a child, records its speech, persists conversation and releases the surface", async () => {
    const root = mkdtempSync(join(tmpdir(), "manager-"));
    try {
      const managed = new ManagedAgentStateStore(join(root, "agents.json"));
      const council = new FakeCouncil();
      const registry = new FakeRegistry();
      const calls: any[] = [];
      const transport = { async run(input: any) { calls.push(input); return { answer: "Bob found a race", conversationUrl: "https://chatgpt.com/c/bob", resumed: false }; }, async release(id: string) { calls.push({ release: id }); return true; } };
      const parse = () => ({ visibleText: "Bob found a race", batch: { version: 1 as const, actions: [{ type: "SAY" as const, room_id: "core", body: "race" }, { type: "SLEEP" as const }] } });
      const manager = new CouncilAgentManager({ council: council as any, managed, registry: registry as any, transport: transport as any, parseAnswer: parse, projectMission: "Build", defaultRoomId: "core" });
      manager.registerLead({ id: "alice", name: "Alice", role: "Lead", mandate: "Lead", permissions: ["spawn", "wake", "finalize", "assign"] });
      const result = await manager.spawnAgent("alice", { name: "Bob", role: "Critic", mandate: "Attack", requestedAgentId: "bob" });
      expect(result.id).toBe("bob");
      expect(managed.get("bob")?.conversationUrl).toBe("https://chatgpt.com/c/bob");
      expect(council.state.messages.at(-1).body).toBe("Bob found a race");
      expect(calls.at(-1).release).toBe("bob");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("managed wake resumes an existing conversation and acknowledges the durable wake", async () => {
    const root = mkdtempSync(join(tmpdir(), "manager-"));
    try {
      const managed = new ManagedAgentStateStore(join(root, "agents.json"));
      const council = new FakeCouncil();
      const registry = new FakeRegistry();
      const calls: any[] = [];
      const transport = { async run(input: any) { calls.push(input); return { answer: "Bob response", conversationUrl: "https://chatgpt.com/c/bob", resumed: true }; }, async release() { return true; } };
      const parse = () => ({ visibleText: "Bob response", batch: { version: 1 as const, actions: [{ type: "SAY" as const, room_id: "core", body: "response" }, { type: "SLEEP" as const }] } });
      const manager = new CouncilAgentManager({ council: council as any, managed, registry: registry as any, transport: transport as any, parseAnswer: parse, projectMission: "Build", defaultRoomId: "core" });
      manager.registerLead({ id: "alice", name: "Alice", role: "Lead", mandate: "Lead", permissions: ["spawn", "wake", "finalize", "assign"] });
      manager.registerLead({ id: "bob", name: "Bob", role: "Critic", mandate: "Attack", permissions: ["wake", "review"] });
      managed.bindConversation("bob", "https://chatgpt.com/c/bob");
      await manager.wakeAgent("alice", "bob", "core", "Review this");
      expect(calls[0].conversationUrl).toBe("https://chatgpt.com/c/bob");
      expect(calls[0].resurrectionPrompt).toContain("Review this");
      expect(council.state.wakes[0].status).toBe("acknowledged");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("critic without spawn permission cannot mint a child", async () => {
    const root = mkdtempSync(join(tmpdir(), "manager-"));
    try {
      const managed = new ManagedAgentStateStore(join(root, "agents.json"));
      const manager = new CouncilAgentManager({ council: new FakeCouncil() as any, managed, registry: new FakeRegistry() as any, transport: {} as any, parseAnswer: (() => null) as any, projectMission: "Build", defaultRoomId: "core" });
      manager.registerLead({ id: "critic", name: "Critic", role: "Critic", mandate: "Attack", permissions: ["wake", "review"] });
      await expect(manager.spawnAgent("critic", { name: "X", role: "Worker", mandate: "Work" })).rejects.toThrow(/spawn/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
