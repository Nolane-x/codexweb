let councilRuntimeLive = false;
const listeners = new Set();

function setCouncilRuntimeLive(value) {
  const next = value === true;
  if (next === councilRuntimeLive) return councilRuntimeLive;
  councilRuntimeLive = next;
  for (const listener of listeners) {
    try { listener(councilRuntimeLive); }
    catch { /* runtime evidence observers cannot break lifecycle ownership */ }
  }
  return councilRuntimeLive;
}

function isCouncilRuntimeLive() {
  return councilRuntimeLive;
}

function onCouncilRuntimeLiveChanged(listener) {
  if (typeof listener !== "function") throw new TypeError("Council runtime evidence listener must be a function");
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

module.exports = {
  isCouncilRuntimeLive,
  onCouncilRuntimeLiveChanged,
  setCouncilRuntimeLive,
};
