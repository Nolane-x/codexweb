import { uninstallCodexIntegration } from "../codex-integration";

export function removeManagedCodexRoute(): ReturnType<typeof uninstallCodexIntegration> {
  return uninstallCodexIntegration();
}
