function capabilityUnavailable(configured = false) {
  return {
    available: false,
    state: configured ? "degraded" : "idle",
    reason: { code: "CAPABILITY_UNAVAILABLE", retryable: true },
  };
}

function capabilityReady() {
  return { available: true, state: "ready" };
}

function deriveCouncilCapabilities(input = {}) {
  const configured = input.configured === true;
  const runtimeLive = input.runtimeLive === true;
  const runtimeCapability = runtimeLive ? capabilityReady() : capabilityUnavailable(configured);

  return {
    secureTunnel: { ...runtimeCapability },
    localRepo: capabilityUnavailable(false),
    githubConnector: capabilityUnavailable(false),
    fullMcp: { ...runtimeCapability },
    wakeEngine: { ...runtimeCapability },
  };
}

module.exports = { deriveCouncilCapabilities };
