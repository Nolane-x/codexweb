const ACTION_REQUIREMENTS = Object.freeze({
  readCouncil: [],
  attachManagedProject: ["projection:live"],
  wakeAgent: ["projection:live", "capability:wakeEngine"],
  pushBranch: ["projection:live", "project:attached", "capability:localRepo", "capability:githubConnector"],
  runFullMcp: ["capability:fullMcp"],
});

function requirementSatisfied(requirement, runtime) {
  if (requirement === "projection:live") return runtime?.projection?.syncState === "live";
  if (requirement === "project:attached") return runtime?.managedProject?.state === "attached";
  if (requirement.startsWith("capability:")) {
    const name = requirement.slice("capability:".length);
    return runtime?.capabilities?.[name]?.available === true;
  }
  return false;
}

function reasonCode(requirement) {
  if (requirement === "projection:live") return "PROJECTION_NOT_LIVE";
  if (requirement === "project:attached") return "PROJECT_UNATTACHED";
  if (requirement.startsWith("capability:")) return "CAPABILITY_UNAVAILABLE";
  return "REQUIREMENT_UNAVAILABLE";
}

function evaluateCouncilAction(action, runtime) {
  const requirements = ACTION_REQUIREMENTS[action];
  if (!requirements) throw new Error(`Unknown Council action: ${action}`);
  const missingRequirements = requirements.filter(requirement => !requirementSatisfied(requirement, runtime));
  return {
    enabled: missingRequirements.length === 0,
    missingRequirements,
    reasonCodes: [...new Set(missingRequirements.map(reasonCode))],
  };
}

module.exports = { ACTION_REQUIREMENTS, evaluateCouncilAction };
