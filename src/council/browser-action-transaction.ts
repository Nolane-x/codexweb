import type { CouncilActionBatch, CouncilBrowserAction } from "./browser-actions";

export interface CouncilActionTransactionAdapter<TState, TEffect = unknown> {
  snapshot(): TState;
  applyToDraft(draft: TState, sourceAgentId: string, action: CouncilBrowserAction): readonly TEffect[];
  commit(nextState: TState): void;
}

export function applyCouncilActionBatch<TState, TEffect = unknown>(
  sourceAgentId: string,
  batch: CouncilActionBatch,
  adapter: CouncilActionTransactionAdapter<TState, TEffect>,
): { effects: TEffect[] } {
  const source = sourceAgentId.trim();
  if (!source) throw new Error("source agent id is required");
  const draft = structuredClone(adapter.snapshot());
  const effects: TEffect[] = [];
  for (const action of batch.actions) effects.push(...adapter.applyToDraft(draft, source, action));
  adapter.commit(draft);
  return { effects };
}
