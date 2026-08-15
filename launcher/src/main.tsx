import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { CouncilAgentsPanel } from "./CouncilAgentsPanel";
import { CouncilDock } from "./CouncilDock";
import { CouncilSetupPanel } from "./CouncilSetupPanel";
import { CouncilSupervisorPanel } from "./CouncilSupervisorPanel";
import { CouncilUpdatePrompt } from "./CouncilUpdatePrompt";
import "./tokens.css";
import "./styles.css";
import "./council.css";
import "./council-agents.css";
import "./council-presence.css";
import "./council-project-tabs.css";
import "./council-setup.css";
import "./council-supervisor.css";
import "./council-update.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <CouncilDock />
    <CouncilAgentsPanel />
    <CouncilSupervisorPanel />
    <CouncilSetupPanel />
    <CouncilUpdatePrompt />
  </React.StrictMode>,
);
