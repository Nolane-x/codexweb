const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const types = readFileSync(join(root, "src", "types.ts"), "utf8");
const agents = readFileSync(join(root, "src", "CouncilAgentsPanel.tsx"), "utf8");

test("managed project view carries sanitized GitHub workspace metadata", () => {
  assert.match(types, /workspace\?:\s*RepoWorkspaceBindingView/);
  assert.match(types, /provider:\s*"github"/);
  assert.match(types, /repoId:\s*string/);
  assert.match(types, /owner:\s*string/);
  assert.match(types, /name:\s*string/);
  assert.match(types, /defaultBranch:\s*string/);
  assert.match(types, /baseCommit:\s*string/);
  assert.doesNotMatch(types, /workspace[^}]*token/i);
  assert.doesNotMatch(types, /workspace[^}]*localPath/i);
});

test("managed agents panel shows repository identity and pinned base without credentials", () => {
  assert.match(agents, /managed\?\.project\?\.workspace/);
  assert.match(agents, /workspace\.owner/);
  assert.match(agents, /workspace\.name/);
  assert.match(agents, /workspace\.defaultBranch/);
  assert.match(agents, /workspace\.baseCommit/);
  assert.doesNotMatch(agents, /workspace\.token/);
  assert.doesNotMatch(agents, /workspace\.path/);
});
