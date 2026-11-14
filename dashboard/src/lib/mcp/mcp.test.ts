// MCP: keys, JSON-RPC handling, and the tools end to end against the mock n8n.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { resetEnvCache } from "../env";
import { resetRateLimit } from "../guards";
import { resetSnapshotCache } from "../snapshot";
import { keyFor, userForKey } from "./keys";
import { handleMcpPost, handleRpc } from "./server";
import type { SessionUser } from "../types";

const lists = { approverEmails: ["nil@example.com"], adminEmails: ["admin@example.com"] };

describe("MCP keys", () => {
  const secret = "s".repeat(32);
  it("derives a stable key per email, none without a secret", () => {
    expect(keyFor("Nil@Example.com", secret)).toBe(keyFor("nil@example.com", secret));
    expect(keyFor("nil@example.com", secret)).not.toBe(keyFor("admin@example.com", secret));
    expect(keyFor("nil@example.com", secret)).not.toBe(keyFor("nil@example.com", "other-secret"));
    expect(keyFor("nil@example.com", "")).toBeNull();
  });
  it("maps a key to its user with the allowlist role", () => {
    const nilKey = keyFor("nil@example.com", secret)!;
    expect(userForKey(nilKey, secret, lists)).toEqual({ email: "nil@example.com", role: "approver" });
    expect(userForKey(keyFor("admin@example.com", secret), secret, lists)).toEqual({ email: "admin@example.com", role: "admin" });
    expect(userForKey("x".repeat(43), secret, lists)).toBeNull();
    expect(userForKey("", secret, lists)).toBeNull();
    expect(userForKey(nilKey, "other-secret", lists)).toBeNull(); // secret changed
    expect(userForKey(nilKey, "", lists)).toBeNull(); // connector off
    expect(userForKey(nilKey, secret, { approverEmails: [], adminEmails: [] })).toBeNull(); // removed from the allowlists
  });
});

const admin: SessionUser = { email: "admin@example.com", role: "admin" };
const nil: SessionUser = { email: "nil@example.com", role: "approver" };
const call = async (user: SessionUser, name: string, args: Record<string, unknown> = {}) => {
  const r = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, user)) as {
    result: { isError: boolean; structuredContent: Record<string, unknown> };
  };
  return r.result;
};

describe("MCP protocol", () => {
  it("initializes, lists tools, ignores notifications", async () => {
    const init = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, nil)) as { result: { protocolVersion: string; capabilities: object } };
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities).toHaveProperty("tools");
    const list = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, nil)) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toContain("lead_action");
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, nil)).toBeNull();
    const res = await handleMcpPost(new Request("http://x/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }), nil);
    expect(res.status).toBe(202);
    const unknown = (await handleRpc({ jsonrpc: "2.0", id: 3, method: "nope" }, nil)) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32601);
  });
});

const PORT = 5900 + Math.floor(Math.random() * 90);
let child: ChildProcess;

describe("MCP tools against the mock n8n", () => {
  beforeAll(async () => {
    child = spawn(process.execPath, ["--no-warnings", join(__dirname, "../../../dev/mock-n8n.mjs")], {
      env: { ...process.env, MOCK_N8N_PORT: String(PORT), DASH_KEY: "test-key" }, stdio: "ignore",
    });
    for (let i = 0; i < 50; i++) {
      try { await fetch(`http://127.0.0.1:${PORT}/__mock/state`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    Object.assign(process.env, { N8N_INTERNAL_URL: `http://127.0.0.1:${PORT}`, DASH_KEY: "test-key", SHEET_ENV: "staging" });
    resetEnvCache();
  });
  afterAll(() => { child?.kill(); });
  beforeEach(async () => {
    await fetch(`http://127.0.0.1:${PORT}/__mock/state`, { method: "POST", body: JSON.stringify({ reset: true, wf3Running: false }) });
    resetSnapshotCache();
    resetRateLimit();
  });

  it("overview and list_leads read the sheet", async () => {
    const o = await call(nil, "overview");
    expect(o.isError).toBe(false);
    expect(o.structuredContent.you).toEqual({ email: "nil@example.com", role: "approver" });
    const l = await call(nil, "list_leads", { view: "first_emails_waiting" });
    const ids = (l.structuredContent.leads as { leadId: string }[]).map((x) => x.leadId);
    expect(ids).toContain("L001");
    expect(ids).not.toContain("L005"); // already approved
  });

  it("get_lead shows the draft, the real recipient and the live check", async () => {
    const r = await call(nil, "get_lead", { leadId: "L001" });
    expect(r.isError).toBe(false);
    expect((r.structuredContent.liveCheck as { firstEmail: { status: string } }).firstEmail.status).toBe("OK");
    expect((r.structuredContent.sendsTo as { testMode: boolean }).testMode).toBe(true);
  });

  it("lead_action approves with the same checks as the page", async () => {
    const ok = await call(nil, "lead_action", { leadId: "L001", action: "approve_first" });
    expect(ok.isError).toBe(false);
    expect((ok.structuredContent.row as { Approved: string }).Approved).toBe("Yes");
    const bad = await call(nil, "lead_action", { leadId: "L003", action: "approve_first" }); // Needs fix
    expect(bad.isError).toBe(true);
    const forbidden = await call(nil, "lead_action", { leadId: "L008", action: "reset_test_sent" });
    expect(forbidden.isError).toBe(true);
  });

  it("approve_all approves only drafts that pass every check", async () => {
    const r = await call(admin, "approve_all", { kind: "first_emails" });
    expect(r.isError).toBe(false);
    const approved = r.structuredContent.approved as string[];
    expect(approved).toContain("L001");
    expect(approved).not.toContain("L003");
    expect(approved).not.toContain("L007"); // marked Edit
  });

  it("update_settings keeps admin fields for admins and never goes live without confirmation", async () => {
    const no = await call(nil, "update_settings", { changes: { "Seed Every": "10" } });
    expect(no.isError).toBe(true);
    const goLive = await call(admin, "update_settings", { changes: { "Test Email": "" } });
    expect(goLive.isError).toBe(true);
    const yes = await call(admin, "update_settings", { changes: { "Sender Title": "CEO" } });
    expect(yes.isError).toBe(false);
  });
});
