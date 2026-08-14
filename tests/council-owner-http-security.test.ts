import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCouncilHttpServer } from "../src/council/http-server";
import { CouncilStore } from "../src/council/store";

const TOKEN = "a".repeat(64);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "council-owner-http-"));
  const store = new CouncilStore(join(root, "state.json"));
  const calls: Array<{ conversationUrl: string; projectName: string }> = [];
  const server = startCouncilHttpServer(store, {
    port: 0,
    owner: {
      token: () => TOKEN,
      startLead: async input => {
        calls.push(input);
        return { lead: "lead", bound: true };
      },
    },
  });
  if (!server || typeof server.port !== "number") throw new Error("owner HTTP test server failed to start");
  return { root, server, calls, url: `http://127.0.0.1:${server.port}/api/owner/start-lead` };
}

function cleanup(value: ReturnType<typeof fixture>) {
  value.server.stop(true);
  rmSync(value.root, { recursive: true, force: true });
}

describe("Council owner HTTP boundary", () => {
  test("rejects missing or wrong owner bearer", async () => {
    const value = fixture();
    try {
      for (const authorization of [undefined, "Bearer wrong-token"]) {
        const response = await fetch(value.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(authorization ? { authorization } : {}),
          },
          body: JSON.stringify({ conversation_url: "https://chatgpt.com/c/abc", project_name: "Project" }),
        });
        expect(response.status).toBe(401);
      }
      expect(value.calls).toHaveLength(0);
    } finally { cleanup(value); }
  });

  test("rejects every browser Origin including file:// Origin null", async () => {
    const value = fixture();
    try {
      for (const origin of ["null", "https://chatgpt.com", "http://127.0.0.1:3000"]) {
        const response = await fetch(value.url, {
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", origin },
          body: JSON.stringify({ conversation_url: "https://chatgpt.com/c/abc", project_name: "Project" }),
        });
        expect(response.status).toBe(403);
      }
      expect(value.calls).toHaveLength(0);
    } finally { cleanup(value); }
  });

  test("accepts only the bearer-authenticated Electron-main request shape", async () => {
    const value = fixture();
    try {
      const response = await fetch(value.url, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ conversation_url: "https://chatgpt.com/c/abc_123", project_name: "Nolane" }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, result: { lead: "lead", bound: true } });
      expect(value.calls).toEqual([{ conversationUrl: "https://chatgpt.com/c/abc_123", projectName: "Nolane" }]);
    } finally { cleanup(value); }
  });

  test("fails closed on malformed owner payload", async () => {
    const value = fixture();
    try {
      const response = await fetch(value.url, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ conversation_url: 123, project_name: "Nolane" }),
      });
      expect(response.status).toBe(400);
      expect(value.calls).toHaveLength(0);
    } finally { cleanup(value); }
  });
});
