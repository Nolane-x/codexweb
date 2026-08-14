import type { CouncilManagedRuntime } from "./managed-runtime";
import type { CouncilWakeDelivery } from "./mcp-shared";
import type { CouncilStore } from "./store";
import type { CouncilWakeEvent } from "./types";

export class HybridCouncilWakeDelivery implements CouncilWakeDelivery {
  constructor(
    private readonly store: CouncilStore,
    private readonly managed: CouncilManagedRuntime | undefined,
    private readonly fallback: CouncilWakeDelivery | undefined,
  ) {}

  enqueue(wake: CouncilWakeEvent): void {
    if (this.managed?.canDeliverWake(wake.targetAgentId)) {
      void this.managed.deliverWakeEvent(wake).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        this.store.updateWake(wake.id, "failed", "Managed wake delivery failed; inspect local runtime logs");
        console.error(`[council-managed-wake] ${wake.id} failed: ${message}`);
      });
      return;
    }
    if (this.fallback) {
      this.fallback.enqueue(wake);
      return;
    }
    // Keep the durable pending wake for a later runtime that can deliver it.
    console.info(`[council-wake] ${wake.id} queued without an active delivery transport`);
  }
}
