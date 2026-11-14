#!/usr/bin/env node
// Mock of the n8n "DB - …" webhook API (dashboard/CONTRACT.md) over in-memory fixture data.
// Zero dependencies. Enforces the same rules as the real workflows (shared email module imported directly),
// the `expect` / 409 check, requestId dedupe (10 min), the X-Dash-Key header and Log appends.
//
//   npm run mock:n8n                      # port 5679, key "dev-key"
//   MOCK_N8N_PORT=5680 DASH_KEY=xyz MOCK_WF3_RUNNING=1 node dev/mock-n8n.mjs
//
// Control endpoints (no key needed, local dev only):
//   GET  /__mock/state                    -> { wf3Running, wf5Running, failSnapshot, delayMs, leads, ... }
//   POST /__mock/state  { wf3Running?, wf5Running?, failSnapshot?, delayMs?, reset? }
//   POST /__mock/touch  { leadId, fields }  -> edit a row "by hand in the sheet" (for conflict tests)
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  checkDraft, checkFollowup, fixAddressLineBreak, isSuppressed, hashFirst, hashFollowup, hashText,
} from "../shared/email/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MOCK_N8N_PORT || process.env.PORT || 5679);
const KEY = process.env.DASH_KEY || "dev-key";
const FIXTURES = process.env.MOCK_FIXTURES || join(here, "fixtures.json");

const LEAD_HEADERS = [
  "Lead ID", "Company", "Website", "Country", "Segment", "Contact Name", "Contact Title", "Email", "LinkedIn",
  "Research Notes", "Personalisation Hook", "Language", "Compliance Status", "Compliance Notes", "Subject", "Draft Body",
  "Draft Body EN", "Approved", "Nil Notes", "Stage", "Sent At", "Gmail Thread ID", "Follow-up Count", "Next Follow-up Date",
  "Reply Category", "Reply Summary", "HubSpot Contact ID", "Opt-out", "Last Updated", "Source URL", "Source Date",
  "Confidence", "Follow-up Draft", "Hot Handled",
];
const ADMIN_ONLY_SETTINGS = ["Test Email", "HubSpot Monthly Limit", "HubSpot Pause Percent", "Seed Email", "Seed Every", "Target Countries"];
const READ_ONLY_SETTINGS = ["Mail Provider", "SMTP From", "Sheet URL", "Nil WhatsApp", "WhatsApp Phone Number ID", "HubSpot Owner ID"];
const FIRST_ACTIONS = ["approve_first", "reject_first", "edit_first", "unapprove_first"];
const FOLLOWUP_ACTIONS = ["approve_followup", "edit_followup", "rewrite_followup", "decline_followup"];
const FU_STAGES = ["Sent", "Follow-up 1", "Follow-up 2"];

// ---- State ----------------------------------------------------------------

let db;
const flags = {
  wf3Running: /^(1|true|yes)$/i.test(process.env.MOCK_WF3_RUNNING || ""),
  wf5Running: /^(1|true|yes)$/i.test(process.env.MOCK_WF5_RUNNING || ""),
  failSnapshot: false,
  delayMs: Number(process.env.MOCK_DELAY_MS || 0),
};
const dedupe = new Map(); // requestId -> { at, status, body }
const DEDUPE_MS = 10 * 60 * 1000;

function load() {
  const f = JSON.parse(readFileSync(FIXTURES, "utf8"));
  db = {
    settings: { ...f.settings },
    leads: f.leads.map((r) => Object.fromEntries(LEAD_HEADERS.map((h) => [h, String(r[h] ?? "")]))),
    suppression: f.suppression.map((r) => ({ ...r })),
    social: f.social.map((r) => ({ ...r })),
    log: f.log.map((r) => ({ ...r })),
  };
  dedupe.clear();
}
load();

const withRows = (arr) => arr.map((r, i) => ({ ...r, row_number: i + 2 }));

// ---- Helpers --------------------------------------------------------------

/** Like Luxon's $now.toISO() in Europe/Istanbul: 2026-11-14T10:00:00.000+03:00 */
function nowIso(d = new Date()) {
  const t = new Date(d.getTime() + 3 * 3600 * 1000);
  return t.toISOString().replace("Z", "+03:00");
}
const today = () => nowIso().slice(0, 10);
const v = (x) => String(x ?? "").trim();
const cut = (s) => (s.length > 3000 ? s.slice(0, 3000) : s);

function appendLog({ leadId = "", company = "", step, input = {}, output = {}, actor, actorRole, approval = false }) {
  db.log.push({
    Timestamp: nowIso(), Workflow: "Dashboard", "Lead ID": leadId, Company: company, Step: step,
    Input: cut(typeof input === "string" ? input : JSON.stringify(input)),
    Output: cut(typeof output === "string" ? output : JSON.stringify(output)),
    Reason: `by ${actor}` + (actorRole === "admin" && approval ? " (admin)" : ""),
  });
}

function testSentList() {
  if (!v(db.settings["Test Email"])) return [];
  return db.leads.filter((l) => v(l["Sent At"]) && !["Opted out", "Closed - No reply"].includes(v(l.Stage)));
}

// ---- Lead action ----------------------------------------------------------

function leadAction(req) {
  const { action, leadId, expect = {}, data = {}, actor, actorRole } = req;
  if (!action || !leadId || !actor || !actorRole) return [422, { errors: ["action, leadId, actor and actorRole are required"] }];
  const idx = db.leads.findIndex((l) => l["Lead ID"] === leadId);
  if (idx < 0) return [409, { conflict: true, row: null, message: `Lead ${leadId} not found` }];
  const lead = db.leads[idx];
  const rowOut = () => ({ ...db.leads[idx], row_number: idx + 2 });

  if (["reset_test_sent", "close_test_sent"].includes(action) && actorRole !== "admin") {
    return [403, { error: "Only the admin can clean up test-sent leads." }];
  }

  // expect check
  const diffs = [];
  if (v(expect.lastUpdated) !== v(lead["Last Updated"])) diffs.push("Last Updated");
  if (v(expect.stage) !== v(lead.Stage)) diffs.push("Stage");
  if (v(expect.approved) !== v(lead.Approved)) diffs.push("Approved");
  if (FIRST_ACTIONS.includes(action) && expect.draftHash !== hashFirst(lead.Subject, lead["Draft Body"])) diffs.push("draft text");
  if (FOLLOWUP_ACTIONS.includes(action) && expect.draftHash !== hashFollowup(lead["Follow-up Draft"])) diffs.push("follow-up text");
  if (diffs.length) {
    return [409, { conflict: true, row: rowOut(), message: `This lead changed since you opened it (${diffs.join(", ")}). Nothing was saved.` }];
  }

  const stage = v(lead.Stage);
  const errors = [];
  const need = (c, m) => { if (!c) errors.push(m); };
  const drafted = () => need(stage === "Drafted", `Stage is "${stage}", not Drafted`);
  const fuStage = () => { need(FU_STAGES.includes(stage), `Stage is "${stage}", no follow-up pending`); need(v(lead["Follow-up Draft"]) !== "", "Follow-up Draft is empty"); };
  const sendable = () => {
    need(v(lead["Opt-out"]) !== "Yes", "Lead opted out");
    need(!(lead.Email && isSuppressed(lead.Email, db.suppression)), "On suppression list");
  };
  const set = {};
  switch (action) {
    case "approve_first": {
      drafted();
      need(v(lead["Compliance Status"]) === "OK", `Compliance Status is "${v(lead["Compliance Status"])}", not OK`);
      const c = checkDraft({ subject: lead.Subject, body: lead["Draft Body"], lead, settings: db.settings, suppression: db.suppression });
      if (c.status !== "OK") errors.push(...c.notes);
      sendable();
      set.Approved = "Yes";
      break;
    }
    case "reject_first":
      drafted(); need(v(data.note) !== "", "A reason is required");
      Object.assign(set, { Approved: "No", "Nil Notes": String(data.note ?? "") });
      break;
    case "edit_first": {
      drafted(); need(v(lead.Approved) !== "Yes", "Draft is approved; un-approve first");
      need(v(data.subject) !== "" && v(data.body) !== "", "Subject and body are required");
      if (errors.length) break;
      const body = fixAddressLineBreak(String(data.body));
      const c = checkDraft({ subject: String(data.subject), body, lead, settings: db.settings, suppression: db.suppression });
      Object.assign(set, {
        Subject: String(data.subject), "Draft Body": c.body, "Compliance Status": c.status, "Compliance Notes": c.notes.join("; "),
        "Draft Body EN": "", Approved: "Pending",
      });
      break;
    }
    case "unapprove_first":
      drafted(); need(v(lead.Approved) === "Yes", "Draft is not approved");
      need(!flags.wf3Running, "WF3 is running; this email may already be sending");
      set.Approved = "Pending";
      break;
    case "approve_followup": {
      fuStage();
      const c = checkFollowup({ body: lead["Follow-up Draft"], lead, settings: db.settings, suppression: db.suppression });
      if (!c.ok) errors.push(...c.notes);
      sendable();
      set.Approved = "Yes";
      break;
    }
    case "edit_followup":
      fuStage(); need(v(data.body) !== "", "Body is required");
      Object.assign(set, { "Follow-up Draft": String(data.body ?? ""), Approved: "Pending" });
      break;
    case "rewrite_followup":
      fuStage(); need(v(data.note) !== "", "Instructions are required");
      Object.assign(set, { Approved: "Edit", "Nil Notes": String(data.note ?? "") });
      break;
    case "decline_followup":
      fuStage();
      set.Approved = "No";
      break;
    case "opt_out":
      Object.assign(set, { "Opt-out": "Yes", Stage: "Opted out", "Next Follow-up Date": "" });
      break;
    case "set_reply_category": {
      need(v(lead["Reply Category"]) !== "", "Lead has no reply");
      const cat = v(data.category);
      need(["Hot", "Warm", "Cold", "Not interested"].includes(cat), "Unknown category");
      Object.assign(set, { "Reply Category": cat, Stage: cat === "Not interested" ? "Opted out" : `Replied - ${cat}` });
      break;
    }
    case "mark_hot_handled":
      need(v(lead["Reply Category"]) === "Hot", "Reply Category is not Hot");
      set["Hot Handled"] = `${nowIso()} by ${actor}`;
      break;
    case "reset_test_sent":
      need(v(db.settings["Test Email"]) !== "", "Test Email is not set");
      need(v(lead["Sent At"]) !== "", "Sent At is empty");
      Object.assign(set, {
        Stage: "Drafted", "Sent At": "", "Gmail Thread ID": "", "Follow-up Count": "", "Next Follow-up Date": "",
        "Follow-up Draft": "", Approved: "Pending",
      });
      break;
    case "close_test_sent":
      need(v(lead["Sent At"]) !== "", "Sent At is empty");
      Object.assign(set, { Stage: "Closed - No reply", "Next Follow-up Date": "", "Follow-up Draft": "" });
      break;
    default:
      return [422, { errors: [`Unknown action ${action}`] }];
  }
  if (errors.length) return [422, { errors }];

  set["Last Updated"] = nowIso();
  const before = {};
  for (const k of Object.keys(set)) before[k] = lead[k];
  Object.assign(lead, set);
  if (action === "opt_out" && v(lead.Email)) {
    db.suppression.push({ Email: v(lead.Email).toLowerCase(), Domain: "", Reason: `Opt-out via dashboard: ${v(data.note)}`, Date: today() });
  }
  appendLog({
    leadId, company: lead.Company, step: action, input: before, output: set, actor, actorRole,
    approval: action === "approve_first" || action === "approve_followup",
  });
  return [200, { ok: true, row: rowOut() }];
}

// ---- Settings / lists -----------------------------------------------------

function settingsWrite(req) {
  const { expect = {}, data = {}, actor, actorRole } = req;
  const fields = Object.keys(data);
  if (!fields.length) return [422, { errors: ["No fields to change"] }];
  const ro = fields.filter((f) => READ_ONLY_SETTINGS.includes(f) || !(f in db.settings));
  if (ro.length) return [403, { error: `Not writable: ${ro.join(", ")}` }];
  const adm = fields.filter((f) => ADMIN_ONLY_SETTINGS.includes(f));
  if (adm.length && actorRole !== "admin") return [403, { error: `Admin only: ${adm.join(", ")}` }];
  const changed = fields.filter((f) => v(expect[f]) !== v(db.settings[f]));
  if (changed.length) return [409, { conflict: true, row: db.settings, message: `Settings changed since you opened them (${changed.join(", ")}). Nothing was saved.` }];
  if ("Test Email" in data && v(data["Test Email"]) === "") {
    const n = testSentList().length;
    if (n) return [422, { errors: [`${n} test-sent lead(s) must be reset or closed before going live`] }];
  }
  const before = {};
  for (const f of fields) { before[f] = db.settings[f]; db.settings[f] = String(data[f] ?? ""); }
  appendLog({ step: "settings", input: before, output: data, actor, actorRole });
  return [200, { ok: true, settings: db.settings }];
}

function suppressionWrite(req) {
  const { action, actor, actorRole } = req;
  if (action === "add") {
    const Email = v(req.data?.Email).toLowerCase();
    const Domain = v(req.data?.Domain).toLowerCase().replace(/^@/, "");
    if (!Email === !Domain) return [422, { errors: ["Give either an email or a domain"] }];
    if (db.suppression.some((r) => (Email && v(r.Email).toLowerCase() === Email) || (Domain && v(r.Domain).toLowerCase() === Domain))) {
      return [422, { errors: [`${Email || Domain} is already on the Suppression list`] }];
    }
    const row = { Email, Domain, Reason: v(req.data?.Reason), Date: today() };
    db.suppression.push(row);
    appendLog({ step: "suppression_add", output: row, actor, actorRole });
    return [200, { ok: true, suppression: withRows(db.suppression) }];
  }
  if (action === "remove") {
    if (actorRole !== "admin") return [403, { error: "Only the admin can remove a Suppression row." }];
    const i = Number(req.rowNumber) - 2;
    const row = db.suppression[i];
    if (!row || v(row.Email) !== v(req.expect?.Email) || v(row.Domain) !== v(req.expect?.Domain)) {
      return [409, { conflict: true, row: row ? { ...row, row_number: i + 2 } : null, message: "The Suppression list changed since you opened it. Nothing was removed." }];
    }
    db.suppression.splice(i, 1);
    appendLog({ step: "suppression_remove", input: row, output: { reason: v(req.reason) }, actor, actorRole });
    return [200, { ok: true, suppression: withRows(db.suppression) }];
  }
  return [422, { errors: ["Unknown action"] }];
}

function socialWrite(req) {
  const { rowNumber, expect = {}, data = {}, actor, actorRole } = req;
  const i = Number(rowNumber) - 2;
  const row = db.social[i];
  if (!row || v(row.Week) !== v(expect.Week) || v(row.Topic) !== v(expect.Topic) || hashText(row.Draft) !== expect.draftHash) {
    return [409, { conflict: true, row: row ? { ...row, row_number: i + 2 } : null, message: "This LinkedIn draft changed since you opened it. Nothing was saved." }];
  }
  const allowed = { Approved: ["Pending", "Yes", "No", "Edit"], Posted: ["Yes", "No"] };
  const set = {};
  for (const [k, val] of Object.entries(data)) {
    if (k === "Nil Notes") set[k] = String(val ?? "");
    else if (allowed[k]?.includes(val)) set[k] = val;
    else return [422, { errors: [`Invalid value for ${k}`] }];
  }
  const before = Object.fromEntries(Object.keys(set).map((k) => [k, row[k]]));
  Object.assign(row, set);
  appendLog({ step: "social", company: row.Topic, input: before, output: set, actor, actorRole, approval: set.Approved === "Yes" });
  return [200, { ok: true, row: { ...row, row_number: i + 2 } }];
}

function logQuery(q) {
  let rows = withRows(db.log);
  if (q.leadId) rows = rows.filter((r) => r["Lead ID"] === q.leadId);
  if (q.workflow) rows = rows.filter((r) => r.Workflow === q.workflow);
  if (q.from) rows = rows.filter((r) => r.Timestamp.slice(0, 10) >= q.from.slice(0, 10));
  if (q.to) rows = rows.filter((r) => r.Timestamp.slice(0, 10) <= q.to.slice(0, 10));
  rows.sort((a, b) => b.Timestamp.localeCompare(a.Timestamp));
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 50, 1), 200);
  const page = Math.max(Number(q.page) || 1, 1);
  return [200, { ok: true, rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize }];
}

function status() {
  const now = Date.now();
  const ago = (min) => new Date(now - min * 60000).toISOString();
  const ex = (id, name, st, startMin, durSec, error = null) => ({
    workflowId: id, workflowName: name, status: st, startedAt: ago(startMin),
    stoppedAt: st === "running" ? null : new Date(now - startMin * 60000 + durSec * 1000).toISOString(), error,
  });
  const executions = [
    ...(flags.wf3Running ? [ex("wf3", "Texprove WF3 - Send approved emails", "running", 3, 0)] : []),
    ...(flags.wf5Running ? [ex("wf5", "Texprove WF5 - Follow-ups", "running", 2, 0)] : []),
    ex("wf4", "Texprove WF4 - Reply triage", "success", 9, 14),
    ex("wf4", "Texprove WF4 - Reply triage", "error", 24, 6, "IMAP: connection timed out"),
    ex("wf3", "Texprove WF3 - Send approved emails", "success", 260, 410),
    ex("wf5", "Texprove WF5 - Follow-ups", "success", 200, 95),
    ex("wf2", "Texprove WF2 - Compliance check and draft", "success", 320, 240),
    ex("wf1", "Texprove WF1 - Lead research", "success", 380, 610),
    ex("wf0", "Texprove WF0 - Company discovery", "success", 60 * 24 * 4, 900),
    ex("wf6", "Texprove WF6 - Weekly report and LinkedIn drafts", "success", 60 * 24 * 4 - 90, 120),
  ];
  return [200, { ok: true, executions, running: { wf3: flags.wf3Running, wf5: flags.wf5Running } }];
}

function snapshot() {
  if (flags.failSnapshot) return [500, { error: "Mock: snapshot failure switched on" }];
  return [200, {
    ok: true, fetchedAt: nowIso(), headersOk: true, headerProblems: [],
    leads: withRows(db.leads), settings: db.settings, suppression: withRows(db.suppression), social: withRows(db.social),
  }];
}

// ---- HTTP -----------------------------------------------------------------

const routes = {
  snapshot: () => snapshot(),
  log: (b) => logQuery(b),
  lead: (b) => leadAction(b),
  settings: (b) => settingsWrite(b),
  suppression: (b) => suppressionWrite(b),
  social: (b) => socialWrite(b),
  status: () => status(),
};
const WRITES = new Set(["lead", "settings", "suppression", "social"]);

function send(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(s) });
  res.end(s);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 2e6) req.destroy(); });
    req.on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const t0 = Date.now();
  let code = 500;
  try {
    if (url.pathname === "/__mock/state") {
      if (req.method === "POST") {
        const b = await readBody(req);
        if (b.reset) load();
        for (const k of ["wf3Running", "wf5Running", "failSnapshot"]) if (k in b) flags[k] = Boolean(b[k]);
        if ("delayMs" in b) flags.delayMs = Number(b.delayMs) || 0;
      }
      code = 200;
      return send(res, 200, { ok: true, ...flags, leads: db.leads.length, log: db.log.length, suppression: db.suppression.length });
    }
    if (url.pathname === "/__mock/touch" && req.method === "POST") {
      const b = await readBody(req);
      const lead = db.leads.find((l) => l["Lead ID"] === b.leadId);
      if (!lead) { code = 404; return send(res, 404, { error: "no such lead" }); }
      Object.assign(lead, b.fields || {});
      if (!b.keepLastUpdated) lead["Last Updated"] = nowIso();
      code = 200;
      return send(res, 200, { ok: true, row: lead });
    }
    const m = url.pathname.match(/^\/webhook\/(dash|dash-staging)\/([a-z-]+)$/);
    if (!m || !routes[m[2]]) { code = 404; return send(res, 404, { code: 404, message: "The requested webhook is not registered." }); }
    if (req.method !== "POST") { code = 404; return send(res, 404, { code: 404, message: "This webhook only accepts POST." }); }
    if (req.headers["x-dash-key"] !== KEY) { code = 403; return send(res, 403, { code: 403, message: "Authorization data is wrong!" }); }
    const body = await readBody(req);
    if (flags.delayMs) await new Promise((r) => setTimeout(r, flags.delayMs));
    const path = m[2];
    if (WRITES.has(path) && body.requestId) {
      const now = Date.now();
      for (const [k, e] of dedupe) if (now - e.at > DEDUPE_MS) dedupe.delete(k);
      const hit = dedupe.get(body.requestId);
      if (hit) { code = hit.status; return send(res, hit.status, hit.body); }
      const [st, out] = routes[path](body);
      dedupe.set(body.requestId, { at: now, status: st, body: out });
      code = st;
      return send(res, st, out);
    }
    const [st, out] = routes[path](body);
    code = st;
    return send(res, st, out);
  } catch (e) {
    code = 500;
    return send(res, 500, { error: String(e?.message || e) });
  } finally {
    console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} -> ${code} (${Date.now() - t0} ms)`);
  }
});

server.listen(PORT, () => {
  console.log(`mock n8n listening on http://localhost:${PORT}/webhook/{dash,dash-staging}/… (X-Dash-Key: ${KEY === "dev-key" ? "dev-key" : "<from DASH_KEY>"})`);
  console.log(`state: wf3Running=${flags.wf3Running} wf5Running=${flags.wf5Running}; POST /__mock/state to change, {"reset":true} to reload fixtures`);
});
