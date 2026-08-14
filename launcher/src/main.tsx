import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { CouncilDock } from "./CouncilDock";
import { CouncilSetupPanel } from "./CouncilSetupPanel";
import "./tokens.css";
import "./styles.css";
import "./council.css";
import "./council-setup.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <CouncilDock />
    <CouncilSetupPanel />
  </React.StrictMode>,
);
