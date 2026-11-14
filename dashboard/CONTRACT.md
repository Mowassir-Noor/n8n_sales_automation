# Dashboard build contract

The single agreement between the parts of the approval dashboard. The full product plan is
`/mnt/project-files/dashboard/approval-dashboard-plan.md` (read it). This file fixes the
interfaces so the parts can be built in parallel. Types live in `src/lib/types.ts`.

## Layout and ownership

| Path (under repo root) | What | Owner |
| --- | --- | --- |
| `dashboard/shared/email/*.js` | Pure ESM JS, no deps: `buildHtml.js`, `checkDraft.js`, `checkFollowup.js`, `recipient.js`, `hash.js`, `index.js`, plus `index.d.ts` | shared-email |
| `dashboard/shared/tests/*.test.js`, `dashboard/scripts/drift.mjs` | Unit, snapshot and drift tests | shared-email |
| `dashboard/n8n/**`, `dashboard/scripts/sync-n8n.mjs` | n8n Workflow SDK templates and Code-node sources of the five `DB - …` workflows; `sync-n8n.mjs` assembles them (pasting the shared email code) into `dashboard/n8n/build/*.workflow.js` | n8n |
| `DB-*.json` at repo root | Exports of those workflows after they are created on the server (integrator does this) | integrator |
| `dashboard/src/lib/**` (except `types.ts`), `dashboard/src/app/api/**`, `dashboard/src/auth.ts`, `dashboard/src/proxy.ts` (or `middleware.ts`), `dashboard/dev/**` | Server side: n8n client, auth, roles, snapshot cache, queue derivation, API routes, mock n8n server with fixtures | backend |
| `dashboard/src/app/**` pages and layouts (not `api/`), `dashboard/src/components/**`, `dashboard/src/app/globals.css` | All UI | frontend |
| `dashboard/Dockerfile`, `dashboard/.dockerignore`, `dashboard/.env.example`, `deploy/**`, `.github/workflows/dashboard.yml`, `docs/dashboard.md`, `dashboard/README.md` | Deployment, CI and docs | deploy |
| `dashboard/package.json`, `tsconfig.json`, `next.config.ts`, `src/lib/types.ts`, this file | Integrator. Agents may add npm scripts/deps but must say so in their report; do not run `npm install` of new packages without listing them |

Do not edit files outside your area. If you need something from another area, write it down in your final report.

## Fixed facts

- Next.js 16 (App Router, `src/`), React 19, TypeScript, Tailwind 4, Auth.js v5 (`next-auth@5 beta`), TanStack Query 5, Zod 4, Vitest 3. Read `node_modules/next/dist/docs/` before writing Next.js code: this version differs from older ones (for example `middleware.ts` may be called `proxy.ts`).
- `output: "standalone"` in `next.config.ts`; container listens on port 3000.
- Sheet: "Texprove Leads", id `10jERabFE3D8G1W_53Y11V2ad7vc8Af1kgXCjya5jIjM`, tabs `Leads` (A..AG + new AH `Hot Handled`), `Settings` (row 2), `Suppression`, `Social`, `Log`. Headers in `src/lib/types.ts` and `docs/google-sheet.md`.
- Time zone Europe/Istanbul. `Last Updated` is written as `$now.toISO()` in n8n (ISO with +03:00). Compared as a string.
- Never put real personal data in code, fixtures or tests: use `example.com` / `example.org` addresses and invented companies. Never hard-code anyone's email address; allowlists come from env vars.

## Environment variables (app)

| Var | Meaning |
| --- | --- |
| `AUTH_SECRET` | Auth.js secret (32+ random bytes) |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google OAuth client (scopes `openid email profile`) |
| `AUTH_URL` | Public URL, e.g. `https://dash.mowassirnoor.tech` |
| `APPROVER_EMAILS`, `ADMIN_EMAILS` | Comma-separated allowlists, case-insensitive. Anyone else is refused at sign-in |
| `N8N_INTERNAL_URL` | e.g. `http://n8n:5678` (Docker network). Webhook base = `${N8N_INTERNAL_URL}/webhook/${prefix}/` |
| `SHEET_ENV` | `live` → prefix `dash`; `staging` → prefix `dash-staging` |
| `DASH_KEY` | Sent as header `X-Dash-Key` on every n8n call |
| `DEV_LOGIN_EMAIL` | Dev only: when set AND `NODE_ENV !== "production"`, a "Dev sign-in" button signs in as this email (role from the allowlists). Ignored in production builds |
| `WEEKLY_FIRST_EMAIL_CAP` (100), `DAILY_WARMUP_CAP` (20) | Soft warnings only |
| `HUBSPOT_PORTAL_ID` | Optional; enables "open in HubSpot" links |
| `MCP_KEYS` | Optional; comma-separated `email:sha256(key)` entries for the Claude connector (`scripts/mcp-key.mjs`). Empty = `/api/mcp` refuses everything |

## n8n webhook API (app → n8n)

All calls: `POST ${N8N_INTERNAL_URL}/webhook/${prefix}/<path>`, header `X-Dash-Key: <DASH_KEY>`,
`Content-Type: application/json`. Webhook auth = n8n "Header Auth" credential (name `X-Dash-Key`).
Each workflow ends in "Respond to Webhook" with the HTTP code below. Bodies are JSON.

| Path | Workflow | Request | 200 response |
| --- | --- | --- | --- |
| `snapshot` | DB - Read | `{}` | `Snapshot` (see types) |
| `log` | DB - Read (second webhook) | `LogQuery` | `LogPage`, newest first |
| `lead` | DB - Lead action | `N8nLeadActionRequest` | `{ ok: true, row: LeadRow }` |
| `settings` | DB - Settings | `SettingsWriteRequest & { actor, actorRole }` | `{ ok: true, settings: Settings }` |
| `suppression` | DB - Lists | `SuppressionWriteRequest & { actor, actorRole }` | `{ ok: true, suppression: SuppressionRow[] }` |
| `social` | DB - Lists (second webhook) | `SocialWriteRequest & { actor, actorRole }` | `{ ok: true, row: SocialRow }` |
| `status` | DB - Status | `{}` | `StatusResponse` |

Errors: `409 { conflict: true, row, message }`, `422 { errors: string[] }`, `403 { error }` (role not allowed for this action),
`500 { error }`. A wrong/missing key is rejected by n8n itself with 403/401.

### Lead actions (server-side rules, enforced again in n8n)

| action | Allowed when | Writes (always also `Last Updated = $now.toISO()` and one Log row) |
| --- | --- | --- |
| `approve_first` | Stage `Drafted`; Compliance Status `OK`; `checkDraft` OK on current text; Opt-out ≠ Yes; not suppressed | Approved `Yes` |
| `reject_first` | Stage `Drafted`; note non-empty | Approved `No`, Nil Notes = note |
| `edit_first` | Stage `Drafted`; Approved ≠ `Yes` | Subject, Draft Body (after `fixAddressLineBreak`), Compliance Status/Notes from `checkDraft`, Draft Body EN = "" , Approved `Pending` |
| `unapprove_first` | Stage `Drafted`; Approved `Yes`; WF3 not running | Approved `Pending` |
| `approve_followup` | Stage in Sent/Follow-up 1/Follow-up 2; Follow-up Draft ≠ ""; `checkFollowup` OK; Opt-out ≠ Yes; not suppressed | Approved `Yes` |
| `edit_followup` | same stages; Follow-up Draft ≠ "" | Follow-up Draft = body, Approved `Pending` |
| `rewrite_followup` | same; note non-empty | Approved `Edit`, Nil Notes = note |
| `decline_followup` | same | Approved `No` |
| `opt_out` | any | Opt-out `Yes`, Stage `Opted out`, Next Follow-up Date "", plus Suppression row `{Email, Domain:"", Reason: "Opt-out via dashboard: <note>", Date: yyyy-MM-dd}` |
| `set_reply_category` | Reply Category ≠ "" | Reply Category; Stage `Replied - Hot/Warm/Cold`, or `Opted out` for Not interested |
| `mark_hot_handled` | Reply Category `Hot` | Hot Handled = `<ISO> by <actor>` |
| `reset_test_sent` | admin only; Test Email set in Settings; Sent At ≠ "" | Stage `Drafted`, Sent At "", Gmail Thread ID "", Follow-up Count "", Next Follow-up Date "", Follow-up Draft "", Approved `Pending` |
| `close_test_sent` | admin only; Sent At ≠ "" | Stage `Closed - No reply`, Next Follow-up Date "", Follow-up Draft "" |

`expect` check: n8n re-reads the row by Lead ID and compares `Last Updated`, `Stage`, `Approved` and the draft hash
(first-email actions hash Subject+Draft Body, follow-up actions hash Follow-up Draft, other actions skip the hash).
Any difference → 409 with the current row, nothing written. `requestId` dedupe: n8n keeps the last results in
workflow static data for 10 minutes and returns the stored response for a repeated id.

Log row on every write: `Timestamp = $now.toISO()`, `Workflow = Dashboard`, `Lead ID`, `Company`, `Step = <action>`,
`Input` = JSON of changed fields' old values, `Output` = JSON of new values (both cut at 3000 chars),
`Reason = by <actor>` (+ ` (admin)` when actorRole is admin and the action is an approval).

All sheet writes use RAW value input (Sheets node option `cellFormat: RAW`).

## Shared email module (`dashboard/shared/email`)

ESM, no imports outside the folder, no Node/browser globals, so it runs in the browser, in Node and (pasted) in n8n Code nodes.
Each file holds plain `function` declarations; exports are `export { a, b }` at the end of the file so `sync-n8n.mjs`
can strip the export line and paste the rest between `// <shared:NAME>` and `// </shared:NAME>` markers in the n8n SDK sources.

```js
buildHtml(body: string, settings: Settings): string            // verbatim copy of WF3 'Build HTML'
checkDraft({ subject, body, lead, settings, suppression }) : { status: 'OK'|'Needs fix'|'Blocked', notes: string[], body: string /* after fixAddressLineBreak */ }
fixAddressLineBreak(body: string): string                       // the WF2 'Sk./Cad. No:' line-break rule
checkFollowup({ body, lead, settings, suppression }): { ok: boolean, notes: string[] }   // WF5 'Check Follow-up'
recipientFor(lead, settings): { to: string, realTo: string, testMode: boolean }        // Test Email || Email
firstEmailSubject(lead): string;  followupSubject(lead): string  // 'Re: ' added when missing
isSuppressed(email, suppression): boolean                       // same rule as WF3 'Safe to send?'
hashText(s): string; hashFirst(subject, body): string; hashFollowup(text): string        // cyrb53, 14 hex chars
```

## App HTTP API (browser → Next.js), all require a session

| Route | Method | Body / query | Returns |
| --- | --- | --- | --- |
| `/api/me` | GET | | `SessionUser` |
| `/api/snapshot` | GET | `?fresh=1` skips the 20 s cache | `Snapshot & { stale?: boolean, ageSeconds?: number }` (on n8n failure: last cached snapshot with `stale: true`, or 503) |
| `/api/lead-action` | POST | `LeadActionRequest` | `WriteResult` body with the same HTTP status |
| `/api/settings` | POST | `SettingsWriteRequest` | `{ ok, settings }` / errors |
| `/api/suppression` | POST | `SuppressionWriteRequest` | `{ ok, suppression }` / errors |
| `/api/social` | POST | `SocialWriteRequest` | `{ ok, row }` / errors |
| `/api/log` | GET | `LogQuery` as query string | `LogPage` |
| `/api/status` | GET | | `StatusResponse` (503 when n8n unreachable) |

Every POST: role check, Zod validation, `Origin` must equal `AUTH_URL` origin, rate limit 60/min/user, cache dropped after a write.
Role rules (server side): approvers and admins may do all lead actions except `reset_test_sent`/`close_test_sent` (admin only);
Settings fields `Test Email`, `HubSpot Monthly Limit`, `HubSpot Pause Percent`, `Seed Email`, `Seed Every`, `Target Countries` are admin only, and clearing
`Test Email` is only allowed through the go-live flow (request carries `data["Test Email"] = ""` plus header `X-Go-Live: confirm`,
admin only, and the server refuses while the go-live list below is not empty);
`Mail Provider`, `SMTP From`, `Sheet URL`, `Nil WhatsApp`, `WhatsApp Phone Number ID`, `HubSpot Owner ID` are never writable. Suppression remove is admin only.

MCP endpoint (Claude connector): `POST /api/mcp` with `Authorization: Bearer <key>`, or `POST /api/mcp/<key>` (custom connectors cannot send headers).
Stateless Streamable HTTP, JSON responses only (no SSE); GET/DELETE return 405. The key maps to an email via `MCP_KEYS`, the role comes from the allowlists
as for sign-in. Tools (src/lib/mcp/tools.ts) call the same write functions as the routes (src/lib/writes.ts), so role rules, validation, rate limit
and the go-live check are identical; `update_settings` needs `confirmGoLive: true` to clear Test Email. Each call is logged as `mcp_tool`.

Queue derivation (put in `src/lib/queues.ts`, pure, used by pages and tests):
- First-email queue: `Stage === "Drafted"`; tab Waiting = Approved in `"", "Pending", "Edit"`, Approved = `Yes`, Rejected = `No`.
- Follow-up queue: Stage in `Sent`, `Follow-up 1`, `Follow-up 2` and `Follow-up Draft` non-empty. Follow-up number = Follow-up Count + 1.
- Hot: `Reply Category === "Hot"` and `Hot Handled` empty.
- Test-sent (go-live list): Test Email set and `Sent At` non-empty and Stage not in Opted out / Closed - No reply.
- Next send time: WF3 runs weekdays 10:00 and 14:00 Istanbul; WF5 weekdays 11:00.
