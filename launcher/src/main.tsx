import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { CouncilUpdatePrompt } from "./CouncilUpdatePrompt";
import "./tokens.css";
import "./styles.css";
import "./council-presence.css";
import "./council-project-tabs.css";
import "./council-4-shell-foundation.css";
import "./council-4-workspaces.css";
import "./council-4-detail.css";
import "./council-4-responsive.css";
import "./council-update.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <CouncilUpdatePrompt />
  </React.StrictMode>,
);
