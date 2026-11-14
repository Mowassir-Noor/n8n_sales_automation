# Running the dashboard locally

The app never talks to Google Sheets directly; it calls the n8n `DB - …` webhooks. For local work,
`dev/mock-n8n.mjs` stands in for n8n: a zero-dependency Node server with the same webhook API
(CONTRACT.md), backed by invented fixture data in `dev/fixtures.json`.

## 1. Start the mock n8n

```bash
cd dashboard
npm run mock:n8n            # http://localhost:5679, expects X-Dash-Key: dev-key
```

Options (environment variables): `MOCK_N8N_PORT` (default 5679), `DASH_KEY` (default `dev-key`),
`MOCK_WF3_RUNNING=1` / `MOCK_WF5_RUNNING=1` (pretend a send run is in progress), `MOCK_DELAY_MS`
(slow every webhook down), `MOCK_FIXTURES` (another fixtures file).

The mock enforces the real rules: the lead-action table (using `shared/email` directly), the
`expect` check (409 with the current row), `requestId` dedupe for 10 minutes, the key check
(403 "Authorization data is wrong!", like n8n), role checks (403), the go-live rule and a `Log`
row for every write. State lives in memory; restart or reset to get the fixtures back.

Control endpoints (no key):

```bash
curl localhost:5679/__mock/state                                   # flags and counts
curl -XPOST localhost:5679/__mock/state -d '{"wf3Running":true}'    # WF3 "sending now"
curl -XPOST localhost:5679/__mock/state -d '{"failSnapshot":true}'  # n8n failing -> stale snapshot
curl -XPOST localhost:5679/__mock/state -d '{"delayMs":16000}'      # trigger the 15 s timeout
curl -XPOST localhost:5679/__mock/state -d '{"reset":true}'         # reload fixtures
# Edit a row "by hand in the sheet" to provoke a 409 on the next action:
curl -XPOST localhost:5679/__mock/touch -d '{"leadId":"L001","fields":{"Subject":"changed in the sheet"}}'
```

## 2. `.env.local`

```bash
AUTH_SECRET=<output of: openssl rand -base64 32>
N8N_INTERNAL_URL=http://localhost:5679
SHEET_ENV=staging
DASH_KEY=dev-key
DEV_LOGIN_EMAIL=approver@example.com
APPROVER_EMAILS=approver@example.com
ADMIN_EMAILS=admin@example.com
# Optional: real Google sign-in in dev (redirect URI http://localhost:3000/api/auth/callback/google)
# AUTH_GOOGLE_ID=...
# AUTH_GOOGLE_SECRET=...
# WEEKLY_FIRST_EMAIL_CAP=100
# DAILY_WARMUP_CAP=20
# HUBSPOT_PORTAL_ID=
```

Leave `AUTH_URL` unset locally: the Origin check then accepts `http://localhost:<port>` only.
To try the admin role, set `DEV_LOGIN_EMAIL=admin@example.com` and restart `npm run dev`.

## 3. Start the app

```bash
npm run dev                 # http://localhost:3000 -> /signin -> "Dev sign-in"
```

The dev sign-in is the Auth.js Credentials provider with id **`dev`** (listed by `/api/auth/providers`).
It exists only when `DEV_LOGIN_EMAIL` is set and `NODE_ENV !== "production"`, and it is still
subject to the allowlists. From a client component: `signIn("dev", { redirectTo: "/" })` from
`next-auth/react`; from a server action: `signIn("dev", { redirectTo: "/" })` from `@/auth`.

From the command line (for API testing):

```bash
J=$(mktemp)
CSRF=$(curl -s -c $J localhost:3000/api/auth/csrf | node -pe 'JSON.parse(require("fs").readFileSync(0)).csrfToken')
curl -s -b $J -c $J -XPOST localhost:3000/api/auth/callback/dev -d "csrfToken=$CSRF" -o /dev/null
curl -s -b $J localhost:3000/api/me
curl -s -b $J -XPOST localhost:3000/api/lead-action -H 'Origin: http://localhost:3000' \
  -H 'Content-Type: application/json' -d '{ ... LeadActionRequest ... }'
```

## Fixture map (`dev/fixtures.json`)

Settings has `Test Email = test-inbox@example.com` (test mode on). All companies and people are invented.

| Lead | Stage | What it exercises |
| --- | --- | --- |
| L001 | Drafted, Pending, OK (tr) | normal approve |
| L002 | Drafted, empty Approved, OK (en) | waiting tab, English draft |
| L003 | Drafted, Pending, Needs fix | opt-out sentence missing + "kapasite"; approve refused |
| L004 | Drafted, Pending, Blocked | domain on Suppression, email/website mismatch |
| L005 | Drafted, Yes | approved tab, un-approve (try with `wf3Running`) |
| L006 | Drafted, No | rejected tab with Nil Notes |
| L007 | Drafted, Edit | waiting tab, with a note |
| L017 | Drafted, Pending, OK | address written "Sk. No: 12" on one line; an edit adds the line break |
| L008 | Sent, follow-up 1 waiting | test-sent; follow-up approve |
| L009 | Follow-up 1, follow-up 2 waiting | |
| L010 | Follow-up 2, follow-up 3 approved | |
| L016 | Sent, no follow-up draft yet | test-sent, not in the follow-up queue |
| L018 / L019 | Follow-up 3 / Closed - No reply | |
| L011 | Replied - Hot, not handled | Hot pin; reply text in the Log (WF4 "Reply triage") |
| L012 | Replied - Hot, handled | |
| L013 | Replied - Warm with a stale follow-up draft | must not show in the follow-up queue |
| L014 | Replied - Cold | |
| L015 | Opted out (+ Suppression row) | |
| L020–L023 | New, Researched, Research failed, Blocked - Compliance | pipeline counts |

## Content-Security-Policy and dynamic rendering

`src/proxy.ts` sets a nonce-based CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`). Next.js adds the
nonce to its own scripts only when a page is rendered per request, so every page must be dynamic
(the root layout reads `headers()` or calls `await connection()`). A statically prerendered page would
have its scripts blocked in production. The email preview (`<iframe sandbox srcdoc>`) needs nothing extra:
`about:srcdoc` is not subject to `frame-src`, and its inline `style` attributes are covered by
`style-src 'unsafe-inline'`.
