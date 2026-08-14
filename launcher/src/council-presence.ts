import type { CouncilAgentPresenceView } from "./types";

export type EffectivePresenceFreshness = "unknown" | "fresh" | "stale";

/**
 * The server publishes a lease snapshot, but expiry is a local-clock concern.
 * A renderer must never keep displaying `fresh` forever just because no new
 * Council mutation arrived after the lease deadline.
 */
export function effectivePresenceFreshness(
  presence: CouncilAgentPresenceView | undefined,
  nowMs = Date.now(),
): EffectivePresenceFreshness {
  if (!presence || presence.freshness === "unknown") return "unknown";
  if (presence.freshness === "stale") return "stale";
  const leaseExpiresAt = Date.parse(presence.leaseExpiresAt);
  if (!Number.isFinite(leaseExpiresAt)) return "unknown";
  return nowMs <= leaseExpiresAt ? "fresh" : "stale";
}

export function presenceLabel(freshness: EffectivePresenceFreshness): string {
  return freshness === "fresh" ? "online" : freshness;
}
