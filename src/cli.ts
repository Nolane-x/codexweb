import { runCouncilSetupCommand } from "./council/setup";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let commandIndex = 0;

  // Preserve the legacy global --home flag while allowing Council setup to be intercepted
  // before loading the legacy CLI. The legacy CLI still receives the original argv for every
  // non-Council command.
  if (args[0] === "--home") {
    const home = args[1]?.trim();
    if (!home) throw new Error("--home requires a value");
    process.env.CODEX_CHATGPT_WEB_HOME = home;
    commandIndex = 2;
  }

  const command = args[commandIndex];
  if (command === "council-setup") {
    await runCouncilSetupCommand(args.slice(commandIndex + 1));
    return;
  }

  await import("./cli-legacy");
}

main().catch(error => {
  process.stderr.write(`codexweb: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
