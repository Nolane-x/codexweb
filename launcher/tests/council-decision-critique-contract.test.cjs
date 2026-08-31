const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const gate = fs.readFileSync(path.join(root, 'src/council/decision-gate.ts'), 'utf8');

test('managed finalization gate enforces independent critique helper', () => {
  assert.match(gate, /evaluateIndependentCritiqueGate/);
  assert.match(gate, /critique\.satisfied/);
  assert.match(gate, /critique\.reason/);
});
