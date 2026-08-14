const BINDING_KEY = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;

class AgentSurfaceRegistry {
  constructor({ maxSurfaces = 5 } = {}) {
    if (!Number.isInteger(maxSurfaces) || maxSurfaces < 1 || maxSurfaces > 32) throw new Error("maxSurfaces is invalid");
    this.maxSurfaces = maxSurfaces;
    this.byBinding = new Map();
    this.byTab = new Map();
    this.bySurface = new Map();
  }

  attach({ bindingKey, tabId, surfaceId }) {
    const key = this.validateKey(bindingKey);
    if (typeof tabId !== "string" || !tabId || typeof surfaceId !== "string" || !surfaceId) throw new Error("tabId and surfaceId are required");
    const existing = this.byBinding.get(key);
    if (existing) {
      if (existing.tabId !== tabId || existing.surfaceId !== surfaceId) throw new Error(`binding ${key} is already bound to another surface`);
      return { ...existing };
    }
    if (this.byBinding.size >= this.maxSurfaces) throw new Error("durable agent surface capacity is full");
    if (this.byTab.has(tabId) || this.bySurface.has(surfaceId)) throw new Error("tab or surface is already bound");
    const record = { bindingKey: key, tabId, surfaceId };
    this.byBinding.set(key, record);
    this.byTab.set(tabId, key);
    this.bySurface.set(surfaceId, key);
    return { ...record };
  }

  find(bindingKey) {
    const record = this.byBinding.get(this.validateKey(bindingKey));
    return record ? { ...record } : null;
  }

  release(bindingKey) {
    const key = this.validateKey(bindingKey);
    const record = this.byBinding.get(key);
    if (!record) return false;
    this.byBinding.delete(key);
    this.byTab.delete(record.tabId);
    this.bySurface.delete(record.surfaceId);
    return true;
  }

  releaseTab(tabId) {
    const key = this.byTab.get(tabId);
    return key ? this.release(key) : false;
  }

  validateKey(value) {
    const key = String(value || "").trim();
    if (!BINDING_KEY.test(key)) throw new Error("bindingKey is invalid");
    return key;
  }
}

module.exports = { AgentSurfaceRegistry, BINDING_KEY };
