import { runCouncilMcpMain } from "../../council/mcp-main";

export async function runChatGptMcpMain(args: string[]): Promise<void> {
  await runCouncilMcpMain(args);
}
