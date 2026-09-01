const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '../../.github/workflows/release.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

test('release workflow treats an already-published package version as a clean no-op', () => {
  assert.match(
    workflow,
    /release_required:\s*\$\{\{ steps\.meta\.outputs\.release_required \}\}/,
    'prepare must publish an explicit release_required output',
  );
  assert.match(
    workflow,
    /if \[ -n "\$existing" \]; then[\s\S]*?release_required=false[\s\S]*?else[\s\S]*?release_required=true/,
    'an existing version tag must disable release work rather than fail the push',
  );
  assert.doesNotMatch(
    workflow,
    /::error::\$\{tag\} already points to/,
    'an unchanged package version must not make an ordinary main push fail',
  );
  const guardedJobs = workflow.match(/if:\s*\$\{\{ needs\.prepare\.outputs\.release_required == 'true' \}\}/g) ?? [];
  assert.equal(guardedJobs.length, 2, 'both build and publish jobs must be gated by release_required');
});
