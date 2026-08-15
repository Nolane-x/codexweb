import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

const RUN_ID = /^obs_[A-Za-z0-9_-]{12,80}$/;
const SCREENSHOT_ID = /^[A-Za-z0-9._-]{8,160}\.png$/;
const DEFAULT_MAX_RUNS = 72;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const MEMORY_RUN_LIMIT = 8;
const MEMORY_CHAR_LIMIT = 16_000;

export type CouncilObservationHealth =
  | "healthy"
  | "sleeping"
  | "busy"
  | "limited"
  | "signed-out"
  | "conversation-missing"
  | "surface-unavailable"
  | "connection-error"
  | "response-stalled"
  | "unknown";

export interface CouncilObservationAgentRecord {
  agentId: string;
  name: string;
  role: string;
  capturedAt: string;
  health: CouncilObservationHealth;
  screenshotId?: string;
  note?: string;
}

export interface CouncilObservationRecord {
  id: string;
  projectRoomId: string;
  managerAgentId: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed";
  agents: CouncilObservationAgentRecord[];
  managerAnalysis?: string;
  managerActions?: string[];
  error?: string;
}

export interface CouncilObservationSummary {
  id: string;
  projectRoomId: string;
  managerAgentId: string;
  startedAt: string;
  completedAt?: string;
  status: CouncilObservationRecord["status"];
  agentCount: number;
  screenshotCount: number;
  health: Record<CouncilObservationHealth, number>;
}

interface ObservationIndex { version: 1; runs: CouncilObservationRecord[] }

function safeText(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const text = value.replace(/\u0000/g, "").trim();
  return text ? text.slice(0, max) : undefined;
}

function assertId(value: string, label: string): string {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(text)) throw new Error(`${label} is invalid`);
  return text;
}

function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try { chmodSync(path, 0o700); } catch {}
}

function clone<T>(value: T): T { return structuredClone(value); }

function emptyHealth(): Record<CouncilObservationHealth, number> {
  return {
    healthy: 0,
    sleeping: 0,
    busy: 0,
    limited: 0,
    "signed-out": 0,
    "conversation-missing": 0,
    "surface-unavailable": 0,
    "connection-error": 0,
    "response-stalled": 0,
    unknown: 0,
  };
}

export class CouncilObservationStore {
  private readonly root: string;
  private readonly screenshotRoot: string;
  private readonly indexPath: string;
  private readonly maxRuns: number;
  private readonly maxBytes: number;
  private state: ObservationIndex;

  constructor(root: string, options: { maxRuns?: number; maxBytes?: number } = {}) {
    this.root = root;
    this.screenshotRoot = join(root, "screenshots");
    this.indexPath = join(root, "index.json");
    this.maxRuns = Number.isInteger(options.maxRuns) && (options.maxRuns ?? 0) > 0 ? options.maxRuns! : DEFAULT_MAX_RUNS;
    this.maxBytes = Number.isFinite(options.maxBytes) && (options.maxBytes ?? 0) > 0 ? Math.trunc(options.maxBytes!) : DEFAULT_MAX_BYTES;
    privateDirectory(this.root);
    privateDirectory(this.screenshotRoot);
    this.state = this.load();
    this.prune();
  }

  private load(): ObservationIndex {
    if (!existsSync(this.indexPath)) return { version: 1, runs: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.indexPath, "utf8")) as Partial<ObservationIndex>;
      if (parsed.version !== 1 || !Array.isArray(parsed.runs)) throw new Error("invalid version");
      const runs = parsed.runs.filter(run => run && typeof run === "object" && RUN_ID.test(run.id));
      return { version: 1, runs: clone(runs) };
    } catch {
      const corrupt = `${this.indexPath}.corrupt-${Date.now()}`;
      try { renameSync(this.indexPath, corrupt); } catch {}
      return { version: 1, runs: [] };
    }
  }

  private persist(): void {
    privateDirectory(this.root);
    const temp = `${this.indexPath}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      renameSync(temp, this.indexPath);
      try { chmodSync(this.indexPath, 0o600); } catch {}
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }

  begin(input: { projectRoomId: string; managerAgentId: string; startedAt?: string }): CouncilObservationRecord {
    const startedAt = input.startedAt ?? new Date().toISOString();
    const record: CouncilObservationRecord = {
      id: `obs_${randomUUID().replaceAll("-", "")}`,
      projectRoomId: assertId(input.projectRoomId, "project room id"),
      managerAgentId: assertId(input.managerAgentId, "manager agent id"),
      startedAt,
      status: "running",
      agents: [],
    };
    this.state.runs.push(record);
    this.persist();
    this.prune();
    return clone(record);
  }

  addAgent(
    runId: string,
    input: Omit<CouncilObservationAgentRecord, "screenshotId">,
    screenshot?: Buffer,
  ): CouncilObservationAgentRecord {
    const run = this.requireRun(runId);
    if (run.status !== "running") throw new Error("observation run is already terminal");
    const agentId = assertId(input.agentId, "agent id");
    if (run.agents.some(agent => agent.agentId === agentId)) throw new Error(`agent already observed: ${agentId}`);
    const record: CouncilObservationAgentRecord = {
      agentId,
      name: safeText(input.name, 120) ?? agentId,
      role: safeText(input.role, 200) ?? "Agent",
      capturedAt: input.capturedAt,
      health: input.health,
      ...(safeText(input.note, 1_000) ? { note: safeText(input.note, 1_000) } : {}),
    };
    if (screenshot?.length) {
      const screenshotId = `${agentId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 48)}-${randomUUID().slice(0, 12)}.png`;
      const runDirectory = join(this.screenshotRoot, run.id);
      privateDirectory(runDirectory);
      const target = join(runDirectory, screenshotId);
      writeFileSync(target, screenshot, { mode: 0o600, flag: "wx" });
      try { chmodSync(target, 0o600); } catch {}
      record.screenshotId = screenshotId;
    }
    run.agents.push(record);
    this.persist();
    return clone(record);
  }

  complete(runId: string, input: { managerAnalysis?: string; managerActions?: string[]; completedAt?: string } = {}): CouncilObservationRecord {
    const run = this.requireRun(runId);
    run.status = "completed";
    run.completedAt = input.completedAt ?? new Date().toISOString();
    const analysis = safeText(input.managerAnalysis, 32_000);
    if (analysis) run.managerAnalysis = analysis;
    if (input.managerActions?.length) run.managerActions = input.managerActions.map(value => safeText(value, 2_000)).filter((value): value is string => Boolean(value)).slice(0, 64);
    delete run.error;
    this.persist();
    this.prune();
    return clone(run);
  }

  fail(runId: string, error: string, completedAt = new Date().toISOString()): CouncilObservationRecord {
    const run = this.requireRun(runId);
    run.status = "failed";
    run.completedAt = completedAt;
    run.error = safeText(error, 2_000) ?? "Observation failed";
    this.persist();
    this.prune();
    return clone(run);
  }

  list(): CouncilObservationSummary[] {
    return [...this.state.runs]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map(run => {
        const health = emptyHealth();
        for (const agent of run.agents) health[agent.health] += 1;
        return {
          id: run.id,
          projectRoomId: run.projectRoomId,
          managerAgentId: run.managerAgentId,
          startedAt: run.startedAt,
          ...(run.completedAt ? { completedAt: run.completedAt } : {}),
          status: run.status,
          agentCount: run.agents.length,
          screenshotCount: run.agents.filter(agent => agent.screenshotId).length,
          health,
        };
      });
  }

  get(runId: string): CouncilObservationRecord | undefined {
    const run = this.state.runs.find(candidate => candidate.id === runId);
    return run ? clone(run) : undefined;
  }

  readScreenshot(runId: string, screenshotId: string): Buffer | undefined {
    if (!RUN_ID.test(runId) || !SCREENSHOT_ID.test(screenshotId) || basename(screenshotId) !== screenshotId) return undefined;
    const run = this.state.runs.find(candidate => candidate.id === runId);
    if (!run?.agents.some(agent => agent.screenshotId === screenshotId)) return undefined;
    const path = join(this.screenshotRoot, runId, screenshotId);
    if (!existsSync(path)) return undefined;
    return readFileSync(path);
  }

  delete(runId: string): boolean {
    if (!RUN_ID.test(runId)) return false;
    const index = this.state.runs.findIndex(run => run.id === runId);
    if (index < 0) return false;
    this.state.runs.splice(index, 1);
    rmSync(join(this.screenshotRoot, runId), { recursive: true, force: true });
    this.persist();
    return true;
  }

  clear(): number {
    const count = this.state.runs.length;
    this.state = { version: 1, runs: [] };
    rmSync(this.screenshotRoot, { recursive: true, force: true });
    privateDirectory(this.screenshotRoot);
    this.persist();
    return count;
  }

  memoryDigest(limit = MEMORY_RUN_LIMIT): string {
    const selected = [...this.state.runs]
      .filter(run => run.status !== "running")
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, Math.max(1, Math.min(24, Math.trunc(limit))));
    const blocks = selected.map(run => {
      const health = emptyHealth();
      for (const agent of run.agents) health[agent.health] += 1;
      return JSON.stringify({
        observedAt: run.completedAt ?? run.startedAt,
        status: run.status,
        managerAgentId: run.managerAgentId,
        health,
        managerAnalysis: run.managerAnalysis?.slice(0, 3_000),
        error: run.error?.slice(0, 1_000),
      });
    });
    const joined = blocks.join("\n");
    return joined.length <= MEMORY_CHAR_LIMIT ? joined : joined.slice(0, MEMORY_CHAR_LIMIT);
  }

  private requireRun(runId: string): CouncilObservationRecord {
    if (!RUN_ID.test(runId)) throw new Error("observation run id is invalid");
    const run = this.state.runs.find(candidate => candidate.id === runId);
    if (!run) throw new Error(`observation run does not exist: ${runId}`);
    return run;
  }

  private archiveBytes(): number {
    let total = existsSync(this.indexPath) ? statSync(this.indexPath).size : 0;
    if (!existsSync(this.screenshotRoot)) return total;
    for (const run of readdirSync(this.screenshotRoot, { withFileTypes: true })) {
      if (!run.isDirectory() || !RUN_ID.test(run.name)) continue;
      const directory = join(this.screenshotRoot, run.name);
      for (const file of readdirSync(directory, { withFileTypes: true })) {
        if (!file.isFile() || !SCREENSHOT_ID.test(file.name)) continue;
        try { total += statSync(join(directory, file.name)).size; } catch {}
      }
    }
    return total;
  }

  private prune(): void {
    let changed = false;
    const oldestFirst = () => [...this.state.runs].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    while (this.state.runs.length > this.maxRuns) {
      const victim = oldestFirst()[0];
      if (!victim) break;
      const index = this.state.runs.findIndex(run => run.id === victim.id);
      if (index >= 0) this.state.runs.splice(index, 1);
      rmSync(join(this.screenshotRoot, victim.id), { recursive: true, force: true });
      changed = true;
    }
    while (this.state.runs.length > 1 && this.archiveBytes() > this.maxBytes) {
      const victim = oldestFirst()[0];
      if (!victim) break;
      const index = this.state.runs.findIndex(run => run.id === victim.id);
      if (index >= 0) this.state.runs.splice(index, 1);
      rmSync(join(this.screenshotRoot, victim.id), { recursive: true, force: true });
      changed = true;
    }
    if (changed) this.persist();
  }
}
