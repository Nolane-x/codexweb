import { existsSync } from "node:fs";
import { getConfigPath, loadConfig } from "../../config";
import { runCouncilMcpMain } from "../../council/mcp-main";
import { COUNCIL_CONNECTOR_NAME } from "../../council/wake-engine";
import { runChatGptMcpServer } from "./mcp-server";

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

export async function runChatGptMcpMain(input: string[]): Promise<void> {
  const config = existsSync(getConfigPath()) ? loadConfig() : undefined;
  if (config?.appName === COUNCIL_CONNECTOR_NAME) {
    await runCouncilMcpMain(input);
    return;
  }

  // Preserve the original direct-token broker contract for legacy Codex installations and its
  // regression harness. Council setup writes the distinct CodexWeb Council connector identity,
  // so a configured Council runtime cannot accidentally fall back into this compatibility path.
  const args = [...input];
  const brokerSocketPath = takeOption(args, "--broker-socket") ?? config?.brokerSocketPath;
  if (args.length > 0) throw new Error(`Unknown legacy MCP arguments: ${args.join(" ")}`);
  if (!brokerSocketPath) throw new Error("Legacy ChatGPT MCP requires --broker-socket or a configured brokerSocketPath");
  await runChatGptMcpServer({ brokerSocketPath });
}
