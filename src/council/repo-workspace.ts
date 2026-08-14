const REPO_PART = /^[A-Za-z0-9_.-]+$/;
const REPO_ID = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_ID = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const ALLOWED_KEYS = new Set(["schemaVersion", "provider", "repoId", "owner", "name", "defaultBranch", "baseCommit"]);

export interface RepoWorkspaceBinding {
  schemaVersion: 1;
  provider: "github";
  repoId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  baseCommit: string;
}

export type RepoExecutionBaseReceipt =
  | { status: "ready"; repoId: string; baseCommit: string }
  | {
      status: "stale-base";
      repoId: string;
      expectedBaseCommit: string;
      currentHeadCommit: string;
      reason: { code: "STALE_BASE" };
    };

function invalidBranch(value: string): boolean {
  return !value
    || value.length > 255
    || /^[-/.]/.test(value)
    || /[\u0000-\u001f\u007f ~^:?*\[\\]/.test(value)
    || value.includes("..")
    || value.includes("@{")
    || value.endsWith(".")
    || value.endsWith("/")
    || value.endsWith(".lock")
    || value.includes("//");
}

function commitId(value: unknown, field: string): string {
  if (typeof value !== "string" || !COMMIT_ID.test(value)) throw new Error(`${field} must be an immutable Git commit hash`);
  return value.toLowerCase();
}

export function validateRepoWorkspaceBinding(input: unknown): RepoWorkspaceBinding {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("repository workspace metadata is invalid");
  const value = input as Record<string, unknown>;
  const unexpected = Object.keys(value).filter(key => !ALLOWED_KEYS.has(key));
  if (unexpected.length) throw new Error(`repository workspace metadata contains unsupported field(s): ${unexpected.join(", ")}`);
  if (value.schemaVersion !== 1) throw new Error("repository workspace schemaVersion must be 1");
  if (value.provider !== "github") throw new Error("repository workspace provider must be github");
  if (typeof value.owner !== "string" || !REPO_PART.test(value.owner) || value.owner.length > 100) throw new Error("repository workspace owner is invalid");
  if (typeof value.name !== "string" || !REPO_PART.test(value.name) || value.name.length > 100) throw new Error("repository workspace name is invalid");
  if (typeof value.repoId !== "string" || !REPO_ID.test(value.repoId) || value.repoId.length > 240) throw new Error("repository workspace repoId must be owner/repository metadata");
  if (value.repoId !== `${value.owner}/${value.name}`) throw new Error("repository workspace identity mismatch: repoId must equal owner/name");
  if (typeof value.defaultBranch !== "string" || invalidBranch(value.defaultBranch)) throw new Error("repository workspace defaultBranch is invalid");
  return {
    schemaVersion: 1,
    provider: "github",
    repoId: value.repoId,
    owner: value.owner,
    name: value.name,
    defaultBranch: value.defaultBranch,
    baseCommit: commitId(value.baseCommit, "repository workspace baseCommit"),
  };
}

export function repoExecutionBaseReceipt(binding: RepoWorkspaceBinding, observedHead: string): RepoExecutionBaseReceipt {
  const workspace = validateRepoWorkspaceBinding(binding);
  const currentHeadCommit = commitId(observedHead, "current repository HEAD");
  if (currentHeadCommit === workspace.baseCommit) return { status: "ready", repoId: workspace.repoId, baseCommit: workspace.baseCommit };
  return {
    status: "stale-base",
    repoId: workspace.repoId,
    expectedBaseCommit: workspace.baseCommit,
    currentHeadCommit,
    reason: { code: "STALE_BASE" },
  };
}
