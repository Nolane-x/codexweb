import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface CouncilOwnerControlDescriptor {
  version: 1;
  endpoint: string;
  token: string;
  issuedAt: string;
}

export function issueCouncilOwnerControl(path: string, port: number): CouncilOwnerControlDescriptor {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("owner control port is invalid");
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { chmodSync(directory, 0o700); } catch {}
  const descriptor: CouncilOwnerControlDescriptor = {
    version: 1,
    endpoint: `http://127.0.0.1:${port}/api/owner`,
    token: randomBytes(32).toString("base64url"),
    issuedAt: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(descriptor, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { chmodSync(path, 0o600); } catch {}
  return descriptor;
}

export function ownerBearerMatches(expected: string, authorization: string | null): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}
