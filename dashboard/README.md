# Texprove approval dashboard

Next.js 16 app where the sales manager approves, edits and rejects outgoing emails, follow-ups and Hot replies. It reads and writes the `Texprove Leads` Google Sheet only through five `DB - …` n8n webhook workflows; it holds no Google, mail or HubSpot credential.

- Setup, deployment and handover: [`../docs/dashboard.md`](../docs/dashboard.md)
- Interfaces between the parts (env vars, n8n webhook API, lead actions, app API, shared email module): [`CONTRACT.md`](CONTRACT.md). Read it before changing anything that crosses a boundary.
- Server files: [`../deploy/`](../deploy/) (compose service, Caddy snippet, build-on-server notes)

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:3000 |
| `npm run mock:n8n` | Mock n8n with invented fixtures, so the app runs without a server (see `dev/README.md`) |
| `npm run build` / `npx next build` | Production build (`output: "standalone"`, used by the Dockerfile) |
| `npm test` / `npx vitest run` | Unit and snapshot tests |
| `npm run test:drift` | Compares `shared/email/*` with the Code nodes in `../WF2-*.json`, `../WF3-*.json`, `../WF5-*.json` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run sync:n8n` | Rebuilds `n8n/build/*.workflow.js` from `n8n/` sources plus the shared email code |
| `npm run sync:n8n -- --check` | Fails if `n8n/build/` is out of date (CI runs this) |

CI (`../.github/workflows/dashboard.yml`) runs `npm ci`, the drift check, Vitest, typecheck, `sync:n8n --check` and `next build` on every push or PR that touches `dashboard/**`, `WF*.json` or `DB-*.json`. A tag `dashboard-v1.2.3` also builds and pushes `ghcr.io/<owner>/texprove-dashboard:1.2.3`.

## Folders

| Path | What |
| --- | --- |
| `src/app/` | Pages and layouts; `src/app/api/` holds the server routes the browser calls |
| `src/components/` | UI components |
| `src/lib/` | Server and shared logic: env, roles, n8n client, snapshot cache, queue derivation; `types.ts` holds the sheet and API types |
| `src/auth.ts`, `src/proxy.ts` | Auth.js (Google, allowlists) and the request guard |
| `shared/email/` | Pure ESM email code shared with n8n: `buildHtml`, `checkDraft`, `checkFollowup`, recipient and subject rules, hashes |
| `shared/tests/` | Tests for the shared code, including snapshot tests against recorded WF3 output |
| `scripts/` | `drift.mjs` (drift check), `sync-n8n.mjs` (assembles the n8n workflows) |
| `n8n/` | Workflow SDK sources of the five `DB - …` workflows; `n8n/build/` is generated |
| `dev/` | Mock n8n server and fixtures for local work |

## Keeping the email code identical to n8n

The preview must be exactly what WF3 sends, and the dashboard's checks must match WF2 and WF5. Code nodes in n8n cannot import files, so the same code exists in three places and is checked instead of trusted:

1. **`shared/email/` is the source** for the dashboard (browser and server) and for the DB workflows. Each file has plain `function` declarations and one `export { … }` line at the end, and no imports from outside the folder or Node/browser globals.
2. **The DB workflows get a pasted copy.** `npm run sync:n8n` strips the export lines and pastes the code between `// <shared:NAME>` and `// </shared:NAME>` markers in `n8n/` sources, writing `n8n/build/*.workflow.js`. CI fails if you change `shared/email/` without re-running it.
3. **WF2, WF3 and WF5 are the reference.** `npm run test:drift` pulls the function bodies out of the exported `WF*.json` files at the repo root and compares them with `shared/email/` after whitespace normalisation. A failure names the node.

When someone changes `Build HTML` (WF3), `Check Draft` (WF2) or `Check Follow-up` (WF5) in n8n: export the workflow to the repo root as usual, run `npm run test:drift`, copy the change into `shared/email/`, update snapshots if the output changed on purpose, run `npm run sync:n8n`, and update the DB workflows on the server.

## Rebuilding the n8n workflows

1. Edit the sources in `n8n/` (or `shared/email/`).
2. `npm run sync:n8n`, then commit `n8n/build/` too.
3. Create or update the workflows on the server from `n8n/build/*.workflow.js` (Claude does this with the n8n connector's Workflow SDK tools). Credentials (`Dashboard key`, `Google Sheets account`, `n8n API`) are picked by hand in n8n.
4. Export the five workflows to `../DB-*.json` so the repo matches the server.

Live workflows answer under `/webhook/dash/…`; staging copies under `/webhook/dash-staging/…` (chosen by `SHEET_ENV`).

## Local setup

```bash
npm ci
cp .env.example .env.local   # values for the mock: see dev/README.md
npm run mock:n8n             # terminal 1
npm run dev                  # terminal 2
```

Use only `example.com` / `example.org` addresses and invented companies in code, fixtures and tests. Never hard-code a real address; allowlists come from env vars.

## Docker

```bash
docker build -t texprove-dashboard:local .
docker run --rm -p 3000:3000 --env-file .env.local -e NODE_ENV=production texprove-dashboard:local
```

The image runs `node server.js` from the standalone output as a non-root user, listens on port 3000 and has a health check on `/api/health`.
