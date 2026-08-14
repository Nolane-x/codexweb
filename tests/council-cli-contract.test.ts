import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const cli = readFileSync(join(root, "src", "cli.ts"), "utf8");

describe("Council CLI dispatch", () => {
  test("intercepts council-setup before loading the legacy CLI", () => {
    expect(cli).toContain("const command = args[commandIndex]");
    expect(cli).toContain('command === "council-setup"');
    expect(cli).toContain("runCouncilSetupCommand");
    expect(cli).toContain('await import("./cli-legacy")');
    expect(cli.indexOf('command === "council-setup"')).toBeLessThan(cli.indexOf('await import("./cli-legacy")'));
  });

  test("preserves the global --home prefix for Council setup", () => {
    expect(cli).toContain('if (args[0] === "--home")');
    expect(cli).toContain("process.env.CODEX_CHATGPT_WEB_HOME = home");
    expect(cli).toContain("commandIndex = 2");
  });
});
