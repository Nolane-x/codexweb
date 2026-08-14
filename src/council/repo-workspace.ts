const REPO_ID = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_ID = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const ALLOWED_KEYS = new Set(["schemaVersion", "provider", "repoId", "defaultBranch", "baseCommit"]);

export interface RepoWorkspaceBinding {
  schemaVersion: 1;
  provider: "github";
  repoId: string;
  defaultBranch: string;
  baseCommit: string;
}

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

export function validateRepoWorkspaceBinding(input: unknown): RepoWorkspaceBinding {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("repository workspace metadata is invalid");
  const value = input as Record<string, unknown>;
  const unexpected = Object.keys(value).filter(key => !ALLOWED_KEYS.has(key));
  if (unexpected.length) throw new Error(`repository workspace metadata contains unsupported field(s): ${unexpected.join(", ")}`);
  if (value.schemaVersion !== 1) throw new Error("repository workspace schemaVersion must be 1");
  if (value.provider !== "github") throw new Error("repository workspace provider must be github");
  if (typeof value.repoId !== "string" || !REPO_ID.test(value.repoId) || value.repoId.length > 240) throw new Error("repository workspace repoId must be owner/repository metadata");
  if (typeof value.defaultBranch !== "string" || invalidBranch(value.defaultBranch)) throw new Error("repository workspace defaultBranch is invalid");
  if (typeof value.baseCommit !== "string" || !COMMIT_ID.test(value.baseCommit)) throw new Error("repository workspace baseCommit must be an immutable Git commit hash");
  return {
    schemaVersion: 1,
    provider: "github",
    repoId: value.repoId,
    defaultBranch: value.defaultBranch,
    baseCommit: value.baseCommit.toLowerCase(),
  };
}
