import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { CouncilAgentsPanel } from "./CouncilAgentsPanel";
import { CouncilDock } from "./CouncilDock";
import { CouncilSetupPanel } from "./CouncilSetupPanel";
import { CouncilUpdatePrompt } from "./CouncilUpdatePrompt";
import "./tokens.css";
import "./styles.css";
import "./council.css";
import "./council-agents.css";
import "./council-presence.css";
import "./council-setup.css";
import "./council-update.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <CouncilDock />
    <CouncilAgentsPanel />
    <CouncilSetupPanel />
    <CouncilUpdatePrompt />
  </React.StrictMode>,
);
