const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "CouncilApp.tsx"), "utf8");
const types = fs.readFileSync(path.join(root, "src", "types.ts"), "utf8");
const inspectorPath = path.join(root, "src", "CouncilExecutionInspector.tsx");
const cssPath = path.join(root, "src", "council-execution.css");
const inspector = fs.existsSync(inspectorPath) ? fs.readFileSync(inspectorPath, "utf8") : "";

test("Mission Control adds executions as one destination in the existing single shell", () => {
  assert.match(app, /type View\s*=\s*[^;]*["']executions["']/s);
  assert.match(app, /id:\s*["']executions["],\s*label:\s*["']Executions["],\s*hint:/);
  assert.match(app, /view\s*===\s*["']executions["]\s*\?\s*<ExecutionInspector/);
  assert.doesNotMatch(app, /ExecutionShell|ExecutionWindow|createRoot\([^)]*Execution/);
  assert.equal(fs.existsSync(inspectorPath), true, "CouncilExecutionInspector.tsx must exist inside the Mission Control composition");
  assert.equal(fs.existsSync(cssPath), true, "council-execution.css must be created for the inspector");
});

test("execution inspector consumes only the trusted typed launcher API", () => {
  for (const method of [
    "councilExecutionRuns",
    "councilExecutionEvents",
    "councilExecutionReceipts",
    "cancelCouncilExecution",
    "focusCouncilExecutionAgent",
    "captureCouncilExecutionAgent",
    "retryCouncilExecution",
  ]) assert.match(inspector, new RegExp(`(?:api!?|launcherApi)\\.${method}\\(`), `${method} must be used through the typed launcher API`);
  assert.match(inspector, /launcherApi:\s*LauncherApi\s*\|\s*undefined/);
  assert.match(types, /CouncilExecutionRunView/);
  assert.match(types, /CouncilExecutionEventView/);
  assert.match(types, /CouncilExecutionCommandReceiptView/);
  assert.doesNotMatch(inspector, /http:\/\/127\.0\.0\.1|conversationUrl|selector|script|javascript:|webContents|executeJavaScript/);
});

test("execution truth is abnormal-first and exposes safety state without reasoning theatre", () => {
  assert.match(inspector, /Execution Inspector/i);
  assert.match(inspector, /Deep State/i);
  assert.match(inspector, /Retry safety/i);
  assert.match(inspector, /Operator resolution required/i);
  assert.match(inspector, /Retry forbidden after submit/i);
  assert.match(inspector, /safe-before-submit/);
  assert.match(inspector, /operator-resolution-required/);
  assert.match(inspector, /uncertain/);
  assert.match(inspector, /failureCode/);
  assert.match(inspector, /executionPriority|abnormal|attention/i);
  assert.doesNotMatch(inspector, /chain[- ]of[- ]thought|reasoning trace|hidden reasoning|thought process/i);
});

test("retry and cancel actions are mechanically guarded by current run state", () => {
  assert.match(inspector, /retrySafety\s*===\s*["']safe-before-submit["']/);
  assert.match(inspector, /status\s*===\s*["']failed["].*status\s*===\s*["']aborted["]|status\s*===\s*["']aborted["].*status\s*===\s*["']failed["]/s);
  assert.match(inspector, /status\s*===\s*["']active["].*cancel|cancel.*status\s*===\s*["']active["]/si);
  assert.doesNotMatch(inspector, /retryCouncilExecution\([^)]*,/);
  assert.doesNotMatch(inspector, /cancelCouncilExecution\([^)]*,/);
});

test("inspector renders bounded events and immutable command receipts", () => {
  assert.match(inspector, /events\.map/);
  assert.match(inspector, /event\.kind/);
  assert.match(inspector, /event\.phase|event\.deepState/);
  assert.match(inspector, /receipts\.map/);
  assert.match(inspector, /receipt\.outcome/);
  assert.match(inspector, /receipt\.actorId/);
  assert.match(inspector, /receipt\.reason/);
});

test("Overview and Agents consume latest public execution state per agent", () => {
  assert.match(app, /executionByAgent/);
  assert.match(app, /<Overview[^>]*executionByAgent=/s);
  assert.match(app, /<AgentsWorkspace[^>]*executionByAgent=/s);
  assert.match(app, /ExecutionBadge/);
});

test("execution styling stays flat and attention-oriented", () => {
  const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : "";
  assert.match(css, /\.execution-inspector/);
  assert.match(css, /\.execution-run-list/);
  assert.match(css, /\.execution-timeline/);
  assert.match(css, /\.execution-receipts/);
  assert.match(css, /\.execution-attention/);
  assert.doesNotMatch(css, /perspective:|transform-style:\s*preserve-3d|backdrop-filter:\s*blur\(2[5-9]|backdrop-filter:\s*blur\([3-9][0-9]/);
});
