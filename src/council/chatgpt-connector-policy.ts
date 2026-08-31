export type CouncilConnectorDisposition = "selected" | "selectable" | "unavailable" | "ambiguous";

export interface CouncilConnectorObservation {
  selectedExactCount: number;
  exactMenuRowCount: number;
}

function boundedCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function classifyCouncilConnectorObservation(input: CouncilConnectorObservation): CouncilConnectorDisposition {
  const selected = boundedCount(input.selectedExactCount);
  const menu = boundedCount(input.exactMenuRowCount);
  if (selected > 1 || menu > 1) return "ambiguous";
  if (selected === 1) return "selected";
  if (menu === 1) return "selectable";
  return "unavailable";
}
