import { existsSync, readFileSync } from "node:fs";
import { atomicWriteFile } from "../config";
import { type RepoWorkspaceBinding, validateRepoWorkspaceBinding } from "./repo-workspace";
import { assertCouncilId, councilText } from "./validation";

export interface ManagedCouncilProject {
  version: 1;
  roomId: string;
  name: string;
  mission: string;
  leadAgentId: string;
  workspace?: RepoWorkspaceBinding;
  createdAt: string;
  updatedAt: string;
}

export class ManagedProjectStateStore {
  constructor(private readonly path: string) {}

  get(): ManagedCouncilProject | undefined {
    if (!existsSync(this.path)) return undefined;
    const value = JSON.parse(readFileSync(this.path, "utf8")) as Partial<ManagedCouncilProject>;
    if (value.version !== 1) throw new Error("managed Council project version is unsupported");
    if (typeof value.roomId !== "string" || typeof value.name !== "string" || typeof value.mission !== "string" || typeof value.leadAgentId !== "string" || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") throw new Error("managed Council project state is invalid");
    assertCouncilId(value.roomId, "managed project room id");
    assertCouncilId(value.leadAgentId, "managed project lead id");
    const project = value as ManagedCouncilProject;
    if (project.workspace !== undefined) project.workspace = validateRepoWorkspaceBinding(project.workspace);
    return project;
  }

  start(input: { roomId: string; name: string; mission: string; leadAgentId: string }): ManagedCouncilProject {
    const roomId = assertCouncilId(input.roomId, "managed project room id");
    const leadAgentId = assertCouncilId(input.leadAgentId, "managed project lead id");
    const existing = this.get();
    if (existing && (existing.roomId !== roomId || existing.leadAgentId !== leadAgentId)) {
      throw new Error(`A managed Council project is already active in room ${existing.roomId} with lead ${existing.leadAgentId}`);
    }
    const now = new Date().toISOString();
    const project: ManagedCouncilProject = {
      version: 1,
      roomId,
      name: councilText(input.name, "managed project name", 160),
      mission: councilText(input.mission, "managed project mission", 8_000),
      leadAgentId,
      ...(existing?.workspace ? { workspace: existing.workspace } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    atomicWriteFile(this.path, `${JSON.stringify(project, null, 2)}\n`);
    return structuredClone(project);
  }

  bindWorkspace(input: unknown): ManagedCouncilProject {
    const existing = this.get();
    if (!existing) throw new Error("No managed Council project is active; start the project before binding repository workspace metadata");
    const workspace = validateRepoWorkspaceBinding(input);
    const project: ManagedCouncilProject = {
      ...existing,
      workspace,
      updatedAt: new Date().toISOString(),
    };
    atomicWriteFile(this.path, `${JSON.stringify(project, null, 2)}\n`);
    return structuredClone(project);
  }
}
