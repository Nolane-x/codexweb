// Council 3.1 is a standalone ChatGPT/Electron product. The retired Codex launcher UI no longer
// participates in the packaged renderer; keeping this compatibility export avoids a broad import
// churn while making the active App surface Codex-free.
export { CouncilApp as App } from "./CouncilApp";
