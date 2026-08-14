import { describe, expect, test } from "bun:test";
import { repoExecutionBaseReceipt, validateRepoWorkspaceBinding } from "../src/council/repo-workspace";

const expectedBaseCommit = "48a596a4fb0caa177ea2967e5c96bbb0c0aec7c3";
const currentHeadCommit = "267bcc797a28fff5707c0ddf83c563db94180ecc";

const workspace = {
  schemaVersion: 1 as const,
  provider: "github" as const,
  repoId: "Nolane-x/codexweb",
  owner: "Nolane-x",
  name: "codexweb",
  defaultBranch: "main",
  baseCommit: expectedBaseCommit,
};

describe("repository workspace execution base", () => {
  test("keeps human-resolvable identity while rejecting mismatched repo metadata", () => {
    expect(validateRepoWorkspaceBinding(workspace)).toEqual(workspace);
    expect(() => validateRepoWorkspaceBinding({ ...workspace, owner: "Other" })).toThrow(/identity|owner|repoId/i);
    expect(() => validateRepoWorkspaceBinding({ ...workspace, name: "other" })).toThrow(/identity|name|repoId/i);
  });

  test("returns a typed STALE_BASE receipt when current HEAD moved after deliberation", () => {
    expect(repoExecutionBaseReceipt(workspace, expectedBaseCommit)).toEqual({
      status: "ready",
      repoId: workspace.repoId,
      baseCommit: expectedBaseCommit,
    });
    expect(repoExecutionBaseReceipt(workspace, currentHeadCommit)).toEqual({
      status: "stale-base",
      repoId: workspace.repoId,
      expectedBaseCommit,
      currentHeadCommit,
      reason: { code: "STALE_BASE" },
    });
  });
});
