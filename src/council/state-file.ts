import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CouncilState } from "./types";
import { assertCouncilState, emptyCouncilState } from "./validation";

export function loadCouncilState(path: string): CouncilState { if (!existsSync(path)) return emptyCouncilState(); return assertCouncilState(JSON.parse(readFileSync(path, "utf8"))); }
export function persistCouncilState(path: string, state: CouncilState): void { const directory = dirname(path); mkdirSync(directory, { recursive: true, mode: 0o700 }); try { chmodSync(directory, 0o700); } catch {} const temp = `${path}.tmp-${process.pid}-${randomUUID()}`; writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); try { renameSync(temp, path); try { chmodSync(path, 0o600); } catch {} } catch (error) { rmSync(temp, { force: true }); throw error; } }
