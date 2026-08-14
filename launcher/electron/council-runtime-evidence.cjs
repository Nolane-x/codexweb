let councilRuntimeLive = false;

function setCouncilRuntimeLive(value) {
  councilRuntimeLive = value === true;
  return councilRuntimeLive;
}

function isCouncilRuntimeLive() {
  return councilRuntimeLive;
}

module.exports = {
  isCouncilRuntimeLive,
  setCouncilRuntimeLive,
};
