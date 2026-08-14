const { AgentSurfaceRegistry } = require("./agent-surface-registry.cjs");

function createCouncilBrowserHostClass(LegacyBrowserHost) {
  return class CouncilBrowserHost extends LegacyBrowserHost {
    constructor(options) {
      super(options);
      this.agentSurfaceRegistry = new AgentSurfaceRegistry({ maxSurfaces: 5 });
    }

    snapshot() {
      const value = super.snapshot();
      return {
        ...value,
        tabs: (value.tabs || []).map(tab => {
          const binding = this.agentSurfaceRegistry.findByTab(tab.id);
          const agentId = binding?.bindingKey?.startsWith("agent:") ? binding.bindingKey.slice("agent:".length) : null;
          return agentId ? { ...tab, agentId } : tab;
        }),
      };
    }

    beginTurn(traceId, reveal, helperPid, bindingKey) {
      if (!bindingKey) return super.beginTurn(traceId, reveal, helperPid);
      const bound = this.agentSurfaceRegistry.find(bindingKey);
      if (bound) {
        const tab = this.turnTabs.get(bound.tabId);
        if (!tab || tab.surfaceId !== bound.surfaceId || tab.view?.webContents?.isDestroyed?.()) {
          this.agentSurfaceRegistry.release(bindingKey);
          if (tab) super.removeTurnTab(tab, true);
          return this.beginTurn(traceId, reveal, helperPid, bindingKey);
        }
        if (tab.status === "running" && tab.traceId !== traceId) throw new Error(`Council agent surface ${bindingKey} already has an active turn`);
        tab.traceId = traceId;
        tab.helperPid = helperPid;
        tab.status = "running";
        tab.loading = false;
        tab.message = "ChatGPT Council agent is working";
        tab.lastHeartbeatAt = Date.now();
        tab.bootstrapReady = true;
        tab.bindingKey = bindingKey;
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.setBackgroundThrottling(false);
        this.selectedTabId = tab.id;
        if (reveal) this.show?.(); else this.syncViewVisibility?.();
        this.publishState?.(this.snapshot());
        this.writeDescriptor?.();
        this.logger?.info?.("browser.agent_tab_reused", { tabId: tab.id, traceId, bindingKey });
        return { surfaceId: tab.surfaceId, tabId: tab.id, persistent: true };
      }
      const lease = super.beginTurn(traceId, reveal, helperPid);
      const tab = [...this.turnTabs.values()].find(candidate => candidate.traceId === traceId);
      if (!tab) throw new Error(`Council browser host could not resolve newly leased turn ${traceId}`);
      try {
        tab.bindingKey = bindingKey;
        this.agentSurfaceRegistry.attach({ bindingKey, tabId: tab.id, surfaceId: tab.surfaceId });
      } catch (error) {
        delete tab.bindingKey;
        super.removeTurnTab(tab, true);
        throw error;
      }
      this.publishState?.(this.snapshot());
      this.writeDescriptor?.();
      return { ...lease, persistent: true };
    }

    async endTurn(traceId, helperPid, status, hideAfterTurn, message) {
      const tab = [...this.turnTabs.values()].find(candidate => candidate.traceId === traceId);
      if (!tab?.bindingKey) return await super.endTurn(traceId, helperPid, status, hideAfterTurn, message);
      if (tab.helperPid !== helperPid) throw new Error(`Browser helper ownership mismatch: expected ${tab.helperPid}, received ${helperPid}`);
      tab.status = status === "completed" ? "ready" : status === "aborted" ? "aborted" : "error";
      tab.message = status === "completed" ? "Council agent ready" : message || `ChatGPT turn ${status}`;
      tab.loading = false;
      tab.lastHeartbeatAt = Date.now();
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.setBackgroundThrottling(true);
      if (hideAfterTurn && !this.activeTraceId) this.hide?.();
      this.syncViewVisibility?.();
      this.publishState?.(this.snapshot());
      this.writeDescriptor?.();
      this.logger?.info?.("browser.agent_tab_parked", { tabId: tab.id, traceId, bindingKey: tab.bindingKey, status: tab.status });
    }

    releaseAgentSurface(bindingKey) {
      const bound = this.agentSurfaceRegistry.find(bindingKey);
      if (!bound) return false;
      const tab = this.turnTabs.get(bound.tabId);
      if (tab?.status === "running") throw new Error(`Council agent surface ${bindingKey} still has an active turn`);
      if (tab) this.removeTurnTab(tab, false);
      else this.agentSurfaceRegistry.release(bindingKey);
      this.publishState?.(this.snapshot());
      this.writeDescriptor?.();
      this.logger?.info?.("browser.agent_tab_released", { bindingKey });
      return true;
    }

    removeTurnTab(tab, abortRunning) {
      if (tab?.bindingKey) this.agentSurfaceRegistry.release(tab.bindingKey);
      return super.removeTurnTab(tab, abortRunning);
    }
  };
}

module.exports = { createCouncilBrowserHostClass };
