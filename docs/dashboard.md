# Approval dashboard: setup and handover guide

> Sign-in update (2026-11-14): email + password is now the default (`DASH_USERS`, entries made with `node scripts/hash-password.mjs <email>`); Google sign-in is optional and only shown when `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are set. The short deployment steps are in [`deploy/QUICKSTART.md`](../deploy/QUICKSTART.md).

A small private website where the sales manager (Nil) approves, edits or rejects every outgoing email, sees follow-ups and Hot replies, and changes the safe settings, without opening the Google Sheet. It lives at **https://dash.mowassirnoor.tech**.

What stays the same: the Google Sheet `Texprove Leads` is still the only shared state, and WF0 to WF6 are unchanged. They still send on their own schedules (first emails weekdays 10:00 and 14:00, follow-ups weekdays 11:00, Istanbul time). The dashboard never sends email itself. It only writes the same cells Nil would write in the sheet (`Approved`, `Subject`, `Draft Body`, `Nil Notes` and so on), and it logs every change in the `Log` tab with who made it.

The sheet keeps working. Nil can go back to approving in the sheet at any time, and edits made in the sheet show up in the dashboard within about 30 seconds.

Steps marked **[You]** can only be done by the person who owns the server, the Google Cloud project and the n8n login. Steps marked **[Claude]** can also be done by Claude through the n8n connector or in the repo.

Contents:

1. [How it fits together](#1-how-it-fits-together)
2. [One-time setup](#2-one-time-setup)
3. [Smoke test](#3-smoke-test)
4. [Adding and removing users](#4-adding-and-removing-users)
5. [Updating and rolling back](#5-updating-and-rolling-back)
6. [Rotating the keys](#6-rotating-the-keys)
7. [Staging (optional)](#7-staging-optional)
8. [Troubleshooting](#8-troubleshooting)
9. [Running it on your computer](#9-running-it-on-your-computer)
10. [How Nil uses it](#10-how-nil-uses-it)

## 1. How it fits together

```
browser ──HTTPS──> Caddy ──> dashboard (Next.js, port 3000)
                               │  Docker network only, header X-Dash-Key
                               v
                             n8n: five "DB - …" webhook workflows ──> Google Sheet "Texprove Leads"
                             n8n: WF0 … WF6 (unchanged) ──> sheet, mailbox, HubSpot, Telegram
```

- **Caddy** (already on the server) serves `dash.mowassirnoor.tech` and passes it to the dashboard container. It also refuses the dashboard's webhook paths on the public n8n address, so they can only be reached from inside the server.
- **The dashboard** holds no Google, mail or HubSpot credential. Sign-in is with Google; only addresses listed in `APPROVER_EMAILS` or `ADMIN_EMAILS` get in.
- **Five n8n workflows** form the dashboard's API. They read and write the sheet with the existing `Google Sheets account` credential, check the same rules as WF2, WF3 and WF5 before writing, and append a `Log` row for every change:

| Workflow | Webhook paths (`/webhook/dash/…`) | Does |
| --- | --- | --- |
| DB - Read | `snapshot`, `log` | Reads Leads, Settings, Suppression and Social in one go; reads the Log tab page by page |
| DB - Lead action | `lead` | Every change to a Leads row (approve, edit, reject, follow-up decisions, opt-out, reply category, Hot handled, test-sent cleanup) |
| DB - Settings | `settings` | Writes allowed Settings fields |
| DB - Lists | `suppression`, `social` | Adds or removes Suppression rows; updates Social (LinkedIn) rows |
| DB - Status | `status` | Recent runs of WF0 to WF6 and whether WF3 or WF5 is running right now (uses the n8n API key, which stays in n8n) |

Two roles:

| | Approver (Nil) | Admin (Mowassir) |
| --- | --- | --- |
| Queue, leads, replies, activity | yes | yes |
| Approve, edit, reject first emails and follow-ups | yes | yes, marked "(admin)" in the Log |
| Opt-out, add to Suppression | yes | yes |
| Remove a Suppression row | no | yes |
| Sender, address, opt-out sentences, Nil Email, Telegram chat ID | yes | yes |
| Test Email / go-live, HubSpot limits, Seed Email and Seed Every | no | yes |
| Target countries (where WF0 searches for companies) | no | yes |
| Mail Provider, SMTP From | read only | read only |

## 2. One-time setup

Do these in order. Total time is about an hour. Keep `Test Email` filled in the sheet while you do this.

### Step 1. DNS **[You]**

At the DNS provider for `mowassirnoor.tech`, add an `A` record:

| Name | Type | Value |
| --- | --- | --- |
| `dash` | A | the server's IP address (the same one `n8n` points at) |

Check it after a few minutes with `dig +short dash.mowassirnoor.tech`. It must print the server's IP before Caddy can get a certificate.

### Step 2. Google sign-in client **[You]**

The dashboard gets its own OAuth client, separate from the one n8n uses for Sheets.

1. Open https://console.cloud.google.com and select the project **n8n-project-513923**.
2. **APIs & Services → OAuth consent screen**: nothing to change. It is already published, and the dashboard only asks for `openid`, `email` and `profile`, which need no Google review.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**
   - Name: `Texprove dashboard`
   - Authorized JavaScript origins: `https://dash.mowassirnoor.tech`
   - Authorized redirect URIs: `https://dash.mowassirnoor.tech/api/auth/callback/google`
4. Click **Create** and copy the **Client ID** and **Client secret**. You need them in step 6.

Nil signs in with a Google account. texprove.com mail is not on Google, so she uses either a personal Gmail or a Google account created for her company address (https://accounts.google.com/signup → "Use your existing email"). Whichever address she uses goes in `APPROVER_EMAILS`.

### Step 3. n8n credentials **[You]**

In n8n at https://n8n.mowassirnoor.tech:

1. Make the shared key. On the server (or any computer) run:

   ```bash
   openssl rand -hex 32
   ```

   It prints 64 characters. This is the `DASH_KEY`. Save it in the password manager.

2. **Overview → Create → Credential → Header Auth**:
   - Credential name: `Dashboard key`
   - Name: `X-Dash-Key`
   - Value: the 64 characters from above

3. Create an n8n API key: **Settings → n8n API → Create an API key**. Label it `Dashboard status`, no expiry (or a long one; note the date). Copy it.

4. **Overview → Create → Credential → n8n API**:
   - Credential name: `n8n API`
   - API Key: the key from step 3
   - Base URL: `http://localhost:5678/api/v1` (n8n calling itself inside its container; `https://n8n.mowassirnoor.tech/api/v1` also works)

### Step 4. The five DB workflows **[You or Claude]**

The five workflows already exist on n8n.mowassirnoor.tech in the folder **Dashboard** (inactive): DB - Read `b3SogIDzguU5WnmR`, DB - Status `eklqnG8SJQQAcdcl`, DB - Settings `dEUqnS08f5NowmGD`, DB - Lists `zcMol8T7wdDlQtFT`, DB - Lead action `AdVONuJtZh6taVjk` (open `https://n8n.mowassirnoor.tech/workflow/<id>`). Every Google Sheets node already has `Google Sheets account` attached. On another server, import them: **Workflows → ⋯ → Import from File**, one file at a time, from the `DB-*.json` files at the root of the repo. Put them in their own folder, for example `Dashboard`.

Then open each one and attach credentials:

| Workflow | Webhook nodes | Google Sheets nodes | n8n nodes |
| --- | --- | --- | --- |
| DB - Read | `Dashboard key` | `Google Sheets account`, sheet `Texprove Leads` | – |
| DB - Lead action | `Dashboard key` | `Google Sheets account` | `n8n API` (Check WF3 Running, Last WF3 Runs) |
| DB - Settings | `Dashboard key` | `Google Sheets account` | – |
| DB - Lists | `Dashboard key` | `Google Sheets account` | – |
| DB - Status | `Dashboard key` | – | `n8n API` |

Every Webhook node must have **Authentication = Header Auth** with `Dashboard key` selected. In each workflow's **Settings**, check **Timezone** is `Europe/Istanbul`.

The webhook nodes are built from the sources in `dashboard/n8n/`; Claude regenerates them with `npm run sync:n8n` (see `dashboard/README.md`) and can update them on the server through the n8n connector. Credentials still have to be picked by hand in n8n.

### Step 5. The sheet column and publishing **[You]**

1. In the `Texprove Leads` sheet, `Leads` tab, type `Hot Handled` in the first empty header cell after `Follow-up Draft` (on the live sheet that is **AI1**, because AH already holds an old `HubSpot Task ID` column; the dashboard finds the column by its name). Format the column as Plain text like the rest. WF0 to WF6 ignore it; the dashboard writes "<time> by <email>" there when a Hot reply has been dealt with.
2. In n8n, **publish (activate)** the five DB workflows with the toggle at the top right of each. They only answer webhooks while active. Activating them does not send anything; they only run when the dashboard calls them.

### Step 6. Server: `dashboard.env` **[You]**

SSH into the server and go to the compose folder (the one with `docker-compose.yml` and `Caddyfile`; below it is `~/n8n`).

Make the session secret:

```bash
openssl rand -base64 32
```

Create the file and lock it down:

```bash
cd ~/n8n
nano dashboard.env
chmod 600 dashboard.env
```

Contents (the full list with explanations is `dashboard/.env.example`):

```bash
AUTH_SECRET=<output of openssl rand -base64 32>
AUTH_GOOGLE_ID=<client ID from step 2>
AUTH_GOOGLE_SECRET=<client secret from step 2>
AUTH_URL=https://dash.mowassirnoor.tech
APPROVER_EMAILS=<Nil's Google sign-in address>
ADMIN_EMAILS=<your Google sign-in address>
SHEET_ENV=live
DASH_KEY=<the 64 characters from step 3>
WEEKLY_FIRST_EMAIL_CAP=100
DAILY_WARMUP_CAP=20
HUBSPOT_PORTAL_ID=
```

`N8N_INTERNAL_URL` is set by the compose file, so it does not need to be here. Leave `DEV_LOGIN_EMAIL` out on the server. Save a copy of the file in the password manager.

### Step 7. Server: compose and Caddy **[You]**

1. Add the dashboard container. Two ways, explained in [`deploy/build-on-server.md`](../deploy/build-on-server.md): **A** builds the image on the server from a git checkout (no GitHub setup needed), **B** pulls an image that GitHub Actions built. For A, in short:

   ```bash
   cd ~ && git clone https://github.com/Mowassir-Noor/n8n_sales_automation.git
   cd ~/n8n
   cp ~/n8n_sales_automation/deploy/docker-compose.dashboard.yml docker-compose.override.yml
   docker compose build dashboard
   ```

2. Edit `~/n8n/Caddyfile` as shown in [`deploy/Caddyfile.snippet`](../deploy/Caddyfile.snippet): add the `dash.mowassirnoor.tech` block, and add these two lines at the top of the existing `n8n.mowassirnoor.tech` block:

   ```
   @dashWebhooks path /webhook/dash/* /webhook-test/dash/* /webhook/dash-staging/* /webhook-test/dash-staging/*
   respond @dashWebhooks 404
   ```

3. Start the dashboard and reload Caddy:

   ```bash
   docker compose up -d dashboard
   docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
   docker compose ps dashboard     # wait for "healthy"
   ```

## 3. Smoke test

**[You]**, with `Test Email` still set in the sheet:

1. From your computer, check that the webhooks are blocked from outside. This must print `404`:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://n8n.mowassirnoor.tech/webhook/dash/snapshot
   ```

2. Check that the dashboard reaches n8n from inside the server. This must print `200`:

   ```bash
   cd ~/n8n
   docker compose exec dashboard node -e "fetch('http://n8n:5678/webhook/dash/status',{method:'POST',headers:{'X-Dash-Key':process.env.DASH_KEY,'Content-Type':'application/json'},body:'{}'}).then(r=>console.log(r.status))"
   ```

3. Open https://dash.mowassirnoor.tech and sign in with the admin account. The red TEST MODE banner must be visible on every page.
4. Open the first-email queue and a draft. The preview should look like the email WF3 sends (compare with an inbox-placement copy).
5. On a test row: edit the text, save, then approve. In the sheet, the row now has `Approved = Yes`, and the `Log` tab has two rows with `Workflow = Dashboard` and `Reason = by <your email> (admin)`.
6. Un-approve it again (or reject it) so it does not go out at the next run.
7. Sign out. Ask Nil to sign in once, so you know her Google account is the one in `APPROVER_EMAILS`. Someone not on the lists must see "not authorised".

## 4. Adding and removing users

**[You]** Access is only the two lists in `dashboard.env`. The sheet cannot grant access.

1. Edit `~/n8n/dashboard.env`: add or remove the address in `APPROVER_EMAILS` or `ADMIN_EMAILS` (comma-separated, no spaces needed, case does not matter).
2. Restart: `cd ~/n8n && docker compose up -d --force-recreate dashboard`.

A removed person cannot sign in again. To also end a session they still have open, rotate `AUTH_SECRET` (section 6), which signs everybody out.

### Using the dashboard from Claude (connector)

**[You]** The dashboard has an MCP endpoint, so a person can approve, edit and check leads by chatting with Claude. Claude gets exactly the role of that person's email: an admin can do everything the admin can do on the website (including Settings, go-live and the test-sent cleanup), an approver only what an approver can. Every change goes through the same checks as the buttons and is written to the Log tab as `mcp_tool`.

1. Make a key for the person: `cd ~/n8n && docker compose exec dashboard node scripts/mcp-key.mjs nil@example.com`. It prints three things: the key, an `MCP_KEYS` entry and the connector URL.
2. Add the entry to `MCP_KEYS=` in `~/n8n/dashboard.env` (comma-separated for several people). For full access the same email must be in `ADMIN_EMAILS`.
3. Restart: `docker compose up -d --force-recreate dashboard`.
4. Send the person the connector URL privately (it contains the key; treat it like a password). They add it in Claude: **Settings → Connectors → Add custom connector**, name it "Texprove dashboard", paste the URL, save. In a chat they turn the connector on and ask things like "what is waiting for approval?" or "show me L041's email and approve it".
5. To revoke: delete that entry from `MCP_KEYS` and restart. Each person has their own key, so revoking one does not affect others.

Claude is told to show the email before approving and never to switch off Test Email unless the person clearly asks; switching off Test Email also needs an explicit go-live confirmation in the tool call, like the go-live dialog on the website.

## 5. Updating and rolling back

**[You]** See [`deploy/build-on-server.md`](../deploy/build-on-server.md) for both ways. In short:

- Building on the server: `cd ~/n8n_sales_automation && git pull`, then `cd ~/n8n && docker compose build dashboard && docker compose up -d dashboard`. Roll back with `git checkout <previous dashboard-v… tag>` in the checkout and the same build command.
- Pulling from GitHub: push a tag `dashboard-v1.2.3`, wait for the Actions run, set `DASHBOARD_IMAGE=ghcr.io/mowassir-noor/texprove-dashboard:1.2.3` in `~/n8n/.env`, then `docker compose pull dashboard && docker compose up -d dashboard`. Roll back by putting the old version back.

The dashboard keeps no data of its own, so updating or rolling back loses nothing. Users may have to sign in again.

When a release also changes the DB workflows, update them in n8n first (they accept the old and the new dashboard as long as the contract did not change), then the dashboard. After any change to WF2, WF3 or WF5 in n8n, export them to the repo as usual: CI's drift check then tells you whether the dashboard's preview and checks still match.

Avoid updating during the 10:00, 11:00 and 14:00 runs.

## 6. Rotating the keys

**`DASH_KEY`** (if it may have leaked, or once a year) **[You]**:

1. `openssl rand -hex 32`.
2. In n8n, open the `Dashboard key` credential and paste the new value. From now on the dashboard gets errors.
3. Put the same value in `DASH_KEY` in `~/n8n/dashboard.env` and run `docker compose up -d --force-recreate dashboard`.
4. Reload the dashboard page; it should load normally. Update the password manager.

**`AUTH_SECRET`** (signs everybody out) **[You]**: `openssl rand -base64 32`, put it in `dashboard.env`, `docker compose up -d --force-recreate dashboard`.

**Google client secret** **[You]**: in Google Cloud, open the OAuth client, **Add secret**, put it in `AUTH_GOOGLE_SECRET`, recreate the container, test a sign-in, then delete the old secret in Google Cloud.

**n8n API key**: create a new one in n8n (**Settings → n8n API**), paste it into the `n8n API` credential, delete the old key.

## 7. Staging (optional)

Staging lets you try dashboard changes without touching the live sheet. It is a copy of the sheet plus a copy of the five DB workflows answering under `/webhook/dash-staging/…`.

1. **[You]** In Google Sheets, **File → Make a copy** of `Texprove Leads`, name it `Texprove Leads (staging)`. Put your own address in its `Test Email`.
2. **[You or Claude]** In n8n, duplicate each DB workflow (**⋯ → Duplicate**), name the copies `DB - … (staging)`, and in each copy:
   - change every Webhook node's path from `dash/…` to `dash-staging/…` (n8n refuses two active workflows with the same path);
   - point every Google Sheets node at `Texprove Leads (staging)`;
   - keep the same `Dashboard key` credential (or make a second one and use a different `DASH_KEY` for staging).
   Publish the copies. WF0 to WF6 keep using the live sheet only.
3. **[You]** Run a second dashboard on the server with `SHEET_ENV=staging`. (A dashboard on your own computer cannot reach these webhooks, because Caddy blocks them on the public address and n8n's port is not published on the host. For work on your computer, use the mock in section 9.) On the server: uncomment the `dashboard-staging` service in the compose file and the `dash-staging.mowassirnoor.tech` block in the Caddyfile, add a DNS record `dash-staging`, create `dashboard-staging.env` (copy of `dashboard.env` with `SHEET_ENV=staging` and `AUTH_URL=https://dash-staging.mowassirnoor.tech`), add `https://dash-staging.mowassirnoor.tech/api/auth/callback/google` as a second redirect URI on the OAuth client, then `docker compose up -d dashboard-staging`.

The DB - Status workflow reports the real WF0 to WF6 runs in both cases; that is expected.

## 8. Troubleshooting

Start with the logs: `cd ~/n8n && docker compose logs --tail 100 dashboard`. In n8n, open **Executions** and filter by the DB workflow.

| What you see | Likely cause | Fix |
| --- | --- | --- |
| "n8n rejected the key" or 401/403 from n8n in the logs | `DASH_KEY` in `dashboard.env` differs from the `Dashboard key` credential, or a Webhook node has no Header Auth / the wrong credential | Make the two values equal (section 6) and check every Webhook node; recreate the container |
| 404 from n8n in the logs | The DB workflow is not published (active), or its webhook path is wrong, or `SHEET_ENV` points at staging workflows that do not exist | Activate the workflow; check the paths are `dash/snapshot`, `dash/log`, `dash/lead`, `dash/settings`, `dash/suppression`, `dash/social`, `dash/status` |
| Yellow "data may be out of date" banner, buttons disabled | n8n is down, restarting or very slow; the dashboard shows its last copy read-only | `docker compose ps n8n`, `docker compose logs n8n`; it recovers on its own once n8n answers |
| "Sheet headers changed" banner, writes refused | A column in the sheet was renamed, moved or deleted (or the `Hot Handled` header is missing) | Put the headers back exactly as in `docs/google-sheet.md`; the banner goes away on the next refresh |
| "Not authorised" after Google sign-in | The Google address is not in `APPROVER_EMAILS` / `ADMIN_EMAILS`, or a typo | Fix the list and recreate the container (section 4) |
| Google says `redirect_uri_mismatch` | Redirect URI in Google Cloud differs from `https://dash.mowassirnoor.tech/api/auth/callback/google`, or `AUTH_URL` is wrong | Make them match exactly, no trailing slash |
| Browser shows a certificate error for dash | DNS was not ready when Caddy first tried | Check `dig`, then `docker compose restart caddy` |
| Saving says "this changed since you opened it" | Someone (or WF5 at 11:00) changed the row in the meantime | Read the new version shown and try again; nothing was overwritten |
| Approve is greyed out | The draft fails the compliance re-check, the lead is opted out or suppressed, or WF3 is sending right now | Read the notes under the draft; fix the text and save |
| Container keeps restarting | A required variable is missing (the log names it) | Fill it in `dashboard.env` |
| `docker compose ps` shows "unhealthy" | The app is up but `/api/health` fails | Check the logs; usually the same missing-variable problem |

## 9. Running it on your computer

**[You or Claude]** No server, Google client or real sheet needed. A mock n8n with invented data stands in for the DB workflows. Details are in `dashboard/dev/README.md`.

```bash
cd dashboard
npm ci
cp .env.example .env.local     # then edit it as below
npm run mock:n8n               # terminal 1: fake n8n with sample leads
npm run dev                    # terminal 2: http://localhost:3000
```

In `.env.local` use the values from `dashboard/dev/README.md`: `N8N_INTERNAL_URL=http://localhost:5679`, `DASH_KEY=dev-key`, `SHEET_ENV=staging`, any `AUTH_SECRET`, leave `AUTH_URL` empty, and set `DEV_LOGIN_EMAIL=approver@example.com` with the same address in `APPROVER_EMAILS` (or an admin address in `ADMIN_EMAILS`). The "Dev sign-in" button then signs you in without Google. It never appears in a production build.

## 10. How Nil uses it

This part is for Nil. Nothing here needs n8n or the Google Sheet.

**Signing in.** Open https://dash.mowassirnoor.tech on a laptop or phone and choose **Sign in with Google**, using the Google account Mowassir registered for you. You stay signed in for up to a week.

**The red TEST MODE bar.** While it is showing, every email goes to the test address, not to the companies. It disappears only when Mowassir switches the system live.

**Every weekday morning (after the drafts notification, about 09:30): first emails.**

1. Open **Approvals** (first emails). Each card is one company, with the email shown exactly as the prospect will see it, the address it goes to, and its compliance status.
2. For each draft choose one:
   - **Approve**: it goes out at the next send time shown on the card (10:00 or 14:00 on weekdays). You can un-approve it until then.
   - **Edit**: change the subject or text and save. The text is checked again straight away; if a problem is found (missing opt-out sentence, a link, a word that is not allowed, too long) it is listed and Approve stays off until it is fixed. After saving, approve it.
   - **Reject**: write a short reason. The company is not emailed.
3. A draft marked **Needs fix** or **Blocked** cannot be approved as it is. Edit it, or reject it.

**About 11:00: follow-ups.** Open **Follow-ups**. Each card shows the follow-up text and the earlier email.

- **Approve**: sent on the next weekday run, in the same email conversation.
- **Edit**: change the text and save, then approve.
- **Ask for a rewrite**: write what you want changed; a new version is written on the next run and comes back to you.
- **Decline**: this company gets no more follow-ups. Usually "ask for a rewrite" is the better choice.

**Hot replies.** When a company answers with interest, it appears at the top of **Replies** and on the home page, with what they wrote and a link to the email. Answer them from the mailbox yourself (the system never answers prospects). Then press **Mark handled** so it leaves the list. If the system put a reply in the wrong group (Hot, Warm, Cold, Not interested), you can change it there.

**Someone asks not to be contacted.** Open the company and press **Opt out**. They are never emailed again. To block a whole address or domain, add it on the **Suppression** page.

**If something looks wrong.** A yellow "out of date" bar means the system behind the dashboard is not answering; wait a few minutes, nothing is lost. "This changed since you opened it" means someone else changed the same company; read the new version and try again. Every change you make is recorded with your name in the activity log.
