# n8n workflows for the dashboard (`DB - …`)

Five n8n workflows form the dashboard's API. The app calls them on the Docker network with
`POST ${N8N_INTERNAL_URL}/webhook/dash/<path>` and the header `X-Dash-Key`. Request and response
shapes are fixed in `../CONTRACT.md` and `../src/lib/types.ts`. WF0 to WF6 are not touched.

| Workflow | Webhook paths | Does |
| --- | --- | --- |
| DB - Read | `dash/snapshot`, `dash/log` | Snapshot of Leads, Settings, Suppression and Social with the Leads header check; Log rows filtered, newest first, paged |
| DB - Lead action | `dash/lead` | Every write on a Leads row (13 actions), with the expect check, requestId dedupe, the shared email rules and a Log row |
| DB - Settings | `dash/settings` | Changes fields of Settings row 2, per role, with validation and the expect check; go-live rule |
| DB - Lists | `dash/suppression`, `dash/social` | Suppression add / admin remove; Social row update |
| DB - Status | `dash/status` | Last 20 executions of each of WF0..WF6, recent error messages, whether WF3 / WF5 are running |

## Layout

```
n8n/
  templates/<slug>.workflow.js   Workflow SDK source; Code nodes say jsCode: '__CODE__(<dir>/<name>)'
  code/<dir>/<name>.js           JavaScript of each Code node, as n8n runs it (top-level `return`)
  code/_lib/common.js            helpers pasted into Code nodes (headers, row shaping, Log row, dedupe, validation)
  code/_lib/executions.js        execution helpers (workflow ids, running check)
  build/<slug>.workflow.js       GENERATED: templates with the code inserted. This is what goes to n8n
  tests/*.test.js                Vitest tests of the Code nodes, run with mocked $, $input, $now, $getWorkflowStaticData
```

Inside a code file, the region between `// <shared:NAME>` and `// </shared:NAME>` is filled with
`../shared/email/NAME.js` (the same `checkDraft`, `checkFollowup`, `isSuppressed`, hash code the
dashboard uses), and `// <lib:NAME>` … `// </lib:NAME>` with `code/_lib/NAME.js`, each without its
`export { … }` line. Keep those regions empty in the source files.

## Build

```
npm run sync:n8n     # writes n8n/build/*.workflow.js
npm run check:n8n    # exit 1 when build/ is out of date (CI); same as `node scripts/sync-n8n.mjs --check`
```

Run the build after any change to a template, a code file, `code/_lib/*` or `shared/email/*`, and commit
`build/`. The build fails with a clear message when a shared file is missing or has an `import`.
Do not edit Code nodes in the n8n editor: change the files here, build, and update the workflow from
`build/` (the integrator does this with the n8n MCP tools, then exports `DB-*.json` to the repo root).

Tests: `npx vitest run n8n/tests` (the include list in `vitest.config.mjs` must contain `n8n/tests/**/*.test.js`).

## Credentials to create in n8n (once)

| Credential | Type | Used by | Setup |
| --- | --- | --- | --- |
| `Dashboard key` | Header Auth | every `DB - …` webhook | Name: `X-Dash-Key`, Value: the same random 32-byte key as `DASH_KEY` in the app's env |
| `n8n API` | n8n API | DB - Status, DB - Lead action (WF3 check) | Create an API key in n8n (Settings > n8n API), Base URL `http://localhost:5678/api/v1` (or the internal URL) |
| `Google Sheets account` | Google Sheets OAuth2 | every Sheets node | Already exists (id `sFrPcvpn5K1JgYYK`); the build attaches it explicitly |

## Node by node

All Sheets nodes read whole tabs (Code nodes filter), use `FORMATTED_VALUE` so every cell arrives as the
text shown in the sheet, and write with `cellFormat: RAW`. Each workflow has one `Config` node holding the
spreadsheet id; every Sheets node reads it with `$('Config').first().json.documentId`. Reads after the
first one use `executeOnce`, and reads use `alwaysOutputData` because a tab can be empty (the Code nodes
drop the resulting `{}` item). Every node that can fail sends its error output to `Respond Error`
(HTTP 500, `{ error }`), so a request never hangs. Log and Suppression appends after a successful lead
write are not fatal: the answer is still 200, with `warnings`.

Each write workflow ends `… -> Finish -> Respond`. `Finish` stores every non-5xx answer under the
request's `requestId` in workflow static data (`$getWorkflowStaticData('global').dashRequests`, 10
minutes, at most 300 entries); `Validate Request` answers a repeated id from there. Static data is
only saved by production (active, webhook-triggered) executions.

### DB - Read
`Webhook Snapshot` / `Webhook Log` -> `Config` (document id, route from the webhook URL, body) -> `Route`
- snapshot: `Read Leads` -> `Read Settings` -> `Read Suppression` -> `Read Social` -> `Build Snapshot` -> `Respond`.
  The header check compares the first 33 Leads headers with A..AG in order (`headersOk`, `headerProblems`).
  `Hot Handled` is "" on every lead when column AH does not exist.
- log: `Read Log` -> `Filter Log` -> `Respond`. `leadId` exact, `workflow` case-insensitive substring,
  `from`/`to` (yyyy-MM-dd, inclusive) against the first 10 characters of Timestamp, newest = last sheet row first,
  `pageSize` default 50, max 500.

### DB - Lead action
`Webhook Lead` -> `Config` -> `Validate Request` (shape, role, dedupe) -> `Respond Now?`
- yes -> `Finish` -> `Respond`
- no -> `Check WF3 Running` -> `Last WF3 Runs` (n8n API, failures tolerated) -> `Read Leads` -> `Read Settings`
  -> `Read Suppression` -> `Plan Write` (header check, row by Lead ID, expect check, rules, shared checks)
  -> `Write Needed?`
  - no (422 / 409 / 500 answer) -> `Finish`
  - yes -> `Lead Update Item` -> `Update Lead Row` (auto-map, match `Lead ID`, RAW, unknown columns are an error)
    -> `Append Log Row` -> `Suppression Row Needed?` (opt_out only) -> [`Append Suppression Row`] -> `Write Result` -> `Finish` -> `Respond`

WF3 check for `unapprove_first`: running if the API lists a running WF3 execution, or (fallback, since
some n8n versions hide running executions from the public API) if it is a weekday within 40 minutes after
10:00 or 14:00 Istanbul and no WF3 execution started after that slot has finished. If both API calls fail,
`unapprove_first` answers 500.

### DB - Settings
`Webhook Settings` -> `Config` (also the `X-Go-Live` header) -> `Validate Request` -> `Respond Now?`
- no -> `Read Settings` -> `Read Leads` -> `Plan Settings` (409 on any `expect` difference; go-live list
  must be empty to clear Test Email) -> `Write Needed?` -> `Settings Update Item` -> `Update Settings Row`
  (auto-map, matched on `row_number` = 2, RAW) -> `Append Log Row` -> `Settings Result` -> `Finish` -> `Respond`

Approvers may change everything except the admin fields (`Test Email`, `HubSpot Monthly Limit`,
`HubSpot Pause Percent`, `Seed Email`, `Seed Every`: 403) and the never-writable ones (`Mail Provider`,
`SMTP From`, `Sheet URL`, `Nil WhatsApp`, `WhatsApp Phone Number ID`, `HubSpot Owner ID`: 422). Clearing
`Test Email` needs an admin and the go-live confirmation: header `X-Go-Live: confirm` on the n8n call
or `goLive: true` in the body. Log rows use Step `settings_update` / `settings_go_live`.

### DB - Lists
`Webhook Suppression` / `Webhook Social` -> `Config` -> `Validate Request` -> `Respond Now?` -> `Route List`
- suppression: `Read Suppression` -> `Plan Suppression` -> `Suppression Step`
  - respond (422 / 409) -> `Finish`
  - append -> `Append Suppression Row` -> `Log Suppression Change` -> `Re-read Suppression` -> `Suppression Result` -> `Finish`
  - delete (admin, row still has the expected Email and Domain) -> `Delete Suppression Row` -> `Log Suppression Change` -> …
- social: `Read Social` -> `Plan Social` (expect Week, Topic, `hashText(Draft)`) -> `Social Write Needed?`
  -> `Social Update Item` -> `Update Social Row` (match `row_number`, RAW) -> `Log Social Change` -> `Social Result` -> `Finish` -> `Respond`

Suppression add: Email (lower-cased) and/or Domain (lower-cased, leading `@` dropped), Reason required,
Date = today in Istanbul (yyyy-MM-dd); an Email or Domain already on the list is a 422.

### DB - Status
`Webhook Status` -> `Workflow List` (7 items) -> `Get Executions` (20 per workflow) -> `Workflow List Again`
-> `Get Recent Errors` (3 failed runs per workflow, with data for the error message) -> `Get Running Executions`
-> `Shape Status` -> `Respond`. All three n8n API nodes continue on error; if every `Get Executions` call
failed the answer is 500. `executions` is newest first, up to 20 per workflow (the app may cut it).

## Staging copy

The plan keeps a copy of the sheet ("Texprove Leads (staging)") and a second set of webhooks under
`/webhook/dash-staging/…` (the app uses them when `SHEET_ENV=staging`). It is not built here; to make it:

1. Duplicate each `DB - …` workflow in n8n and name it `DB - … (staging)`.
2. In each copy, change the webhook path prefix from `dash/` to `dash-staging/` (for example
   `dash-staging/lead`). The route detection in `Config` only looks at the last path segment, so nothing else changes.
3. In each copy's `Config` node, set `documentId` to the staging spreadsheet id. That is the only place the
   sheet id appears. `DB - Status` has no sheet and needs only the path change.
4. Use the same `Dashboard key` credential (or a separate one if staging has its own `DASH_KEY`).

Dedupe state is per workflow, so the staging copies do not share it with live.

## Things to check on the server (cannot be verified offline)

- Sheets update matched on `row_number` (Settings and Social) with auto-map.
- `Update Lead Row` with auto-map writes only the keys present in the item and leaves other columns alone.
- n8n API `status=running` filter (sent as an expression because the node's list lacks it); if the server rejects it,
  the schedule-window fallback still applies.
- The Delete rows operation's `startIndex` is the sheet row number (first data row = 2).
