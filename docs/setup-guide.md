# Texprove Automation Setup Guide

Last updated 2026-11-14. Live copy: the "Texprove Automation Setup Guide" Claude Doc.

## Overview

Everything is set up in eight steps, in this order. Steps 1 to 6 happen once. Every credential lives only in n8n; never put a key, token or password in the sheet or in a node's text.

1. Create the Google Sheet and fill the `Settings` row, with `Test Email` set.
2. Create the Anthropic, Google Sheets and HubSpot credentials in n8n.
3. Set up email: SMTP + IMAP for texprove.com (current setup), or Gmail.
4. (WhatsApp was removed on 2026-11-13; nothing to set up.)
5. Set up the Telegram bot (optional, but the most reliable alert channel).
6. Import WF0–WF6 and attach the credentials node by node.
7. Test every workflow by hand in test mode.
8. Work through the go-live checklist, clear `Test Email`, activate one workflow at a time.

In n8n, credentials are created at **Overview → Create → Credential** (or from any node: open it, click the credential dropdown, **Create new credential**). The names below are the ones the workflow exports expect; using them saves re-selecting credentials after import. To run n8n on your own server instead of n8n Cloud, start with section 9.

## 1. Google Sheet

The sheet `Texprove Leads` is the only shared state; it needs five tabs with exact headers. The full column lists are in `docs/google-sheet.md` in the repo.

1. Create a Google Sheet named `Texprove Leads` with tabs `Leads`, `Settings`, `Social`, `Log`, `Suppression`. Format every cell as **Plain text** (Format → Number → Plain text) so IDs and phone numbers aren't converted.
2. Paste the headers from `docs/google-sheet.md` into row 1 of each tab. Shortcut: after the Google Sheets credential exists (step 2), run the n8n workflow **Texprove Setup - Check and fix sheet structure**; it creates missing tabs and headers and fills empty Settings cells with test-safe defaults.
3. On `Leads`, make `Approved` a dropdown (Data → Data validation) with `Pending`, `Yes`, `No`, `Edit`. Do the same on `Social`.
4. Fill `Settings` row 2:

| Column | Header | What to put in it |
| --- | --- | --- |
| A | Sender Name | Full name emails come from (`Nil Sızır`) |
| B | Sender Title | Their job title (`Founder & CEO`) |
| C | Company Legal Name | Registered company name |
| D | Company Address | Postal address printed in every email (the Ankara office) |
| E | Opt-out TR | Turkish opt-out sentence |
| F | Opt-out EN | English opt-out sentence |
| G | Nil Email | Manager's email for approvals, alerts, reports |
| H | Sheet URL | Link to this sheet (used in notifications only when Dashboard URL is empty) |
| I | HubSpot Monthly Limit | 3000 |
| J | HubSpot Pause Percent | 80 |
| K | Test Email | **Test mode switch.** Your own address while testing; empty = real sending |
| L | Nil WhatsApp | Not used any more (WhatsApp removed) |
| M | WhatsApp Phone Number ID | Not used any more |
| N | Nil Telegram Chat ID | From Telegram, step 5 |
| O | Company Website | https://www.texprove.com |
| P | HubSpot Owner ID | Not used; leave as is |
| Q | Mail Provider | `SMTP` (current) or `Gmail` (step 3) |
| R | SMTP From | `Texprove <marketing@texprove.com>` |
| S | Seed Email | Inbox you check; WF3 sends it a copy of every 12th first email to show Inbox vs Spam. Empty = off |
| T | Seed Every | 12 |
| U | Target Countries | Turkey |
| V | Dashboard URL | `https://dash.mowassirnoor.tech` (notifications link here; empty = link to Sheet URL) |

Keep `Test Email` filled until the go-live checklist is done. While it holds an address, every first email, follow-up and HubSpot contact uses that address instead of the lead's.

## 2. Anthropic, Google Sheets and HubSpot credentials

These three are required; nothing runs without them.

| Credential in n8n | Name to use | Where the secret comes from | Used by |
| --- | --- | --- | --- |
| Anthropic | `Anthropic account` | console.anthropic.com → **API Keys** → **Create Key** | every Claude node |
| Anthropic | `Anthropic account 2` | optional second key (second account) | nodes ending in "(account 2)"; may reuse the first key |
| Google Sheets OAuth2 API | `Google Sheets account` | **Sign in with Google** inside the credential, using the account that owns the sheet | every sheet node |
| HubSpot App Token | `HubSpot Service Key account` | HubSpot private app / service key token (below) | WF3, WF4, WF5 |

**Anthropic**

1. Log in to console.anthropic.com, add credit under **Billing**, then **API Keys → Create Key**. Copy the key once; it is not shown again.
2. In n8n create an **Anthropic** credential named `Anthropic account` and paste the key.
3. Every Claude node must use `Anthropic account` (fallback nodes: `Anthropic account 2`), not n8n "Gateway credits" (step 6).

**Google Sheets**

1. In n8n create a **Google Sheets OAuth2 API** credential named `Google Sheets account`.
2. Click **Sign in with Google** and approve with the Google account that owns `Texprove Leads`.

**HubSpot**

1. In HubSpot open **Settings (gear) → Integrations → Private Apps → Create a private app** (newer portals: **Development → Keys → Service keys**).
2. Give it read and write access to contacts (`crm.objects.contacts.read`, `crm.objects.contacts.write`) plus the email/engagement logging scope HubSpot offers. Create it and copy the access token.
3. In n8n create a **HubSpot App Token** credential named `HubSpot Service Key account` and paste the token.

## 3. Email: Gmail or SMTP + IMAP

Pick one provider with `Settings → Mail Provider`. texprove.com is hosted on its own server (`mail.texprove.com`), not Google, so the company mailbox uses **Option B**, which is what the exports and the live server use since 2026-11-13 (marketing@texprove.com; send, reply and Hot-alert tested end to end).

### Option A: Gmail or Google Workspace

1. In n8n create a **Gmail OAuth2 API** credential named `Gmail account`, click **Sign in with Google**, and log in with the sending address.
2. If a Workspace account is blocked with "app not allowed", an admin allows n8n in **admin.google.com → Security → API controls → App access control**.
3. Set `Mail Provider` = `Gmail` (or leave it empty).
4. Select `Gmail account` on these 12 nodes and enable them; disable every `(SMTP)` node and the `IMAP Trigger`:

| Workflow | Gmail nodes |
| --- | --- |
| WF2 | Notify Nil |
| WF3 | Send Email, Warn Nil Quota |
| WF4 | Gmail Trigger, Mark Reply Read, Alert Nil |
| WF5 | Get Thread, Get Original Message-ID, Send Follow-up, Email Nil (follow-ups) |
| WF6 | Email Weekly Report, Email Social Drafts Ready |

### Option B: SMTP + IMAP (texprove.com)

1. Ask whoever runs `mail.texprove.com` for the mailbox address (e.g. `sales@texprove.com`), its password, and the ports. Usual values: SMTP port 465 with SSL/TLS (or 587 with STARTTLS), IMAP port 993 with SSL/TLS.
2. In n8n create an **SMTP** credential named `SMTP account`: host `mail.texprove.com`, port, user = full address, password, SSL/TLS on for 465.
3. Create an **IMAP** credential named `IMAP account`: host `mail.texprove.com`, port 993, same user and password, SSL/TLS on.
4. In the sheet set `Mail Provider` = `SMTP` and `SMTP From` = `Texprove Sales <sales@texprove.com>`.
5. In each workflow, enable the SMTP/IMAP nodes (right-click → **Activate**), select the new credential on each, and disable the Gmail nodes they replace (right-click → **Deactivate**):

| Workflow | Enable + set credential | Disable |
| --- | --- | --- |
| WF2 | Notify Nil (SMTP) | Notify Nil |
| WF3 | Send Email (SMTP), Warn Nil Quota (SMTP) | Send Email, Warn Nil Quota |
| WF4 | IMAP Trigger (IMAP), Alert Nil (SMTP) | Gmail Trigger, Mark Reply Read, Alert Nil |
| WF5 | Send Follow-up (SMTP), Email Nil (follow-ups, SMTP) | Get Thread, Get Original Message-ID, Send Follow-up, Email Nil (follow-ups) |
| WF6 | Email Weekly Report (SMTP), Email Social Drafts Ready (SMTP) | Email Weekly Report, Email Social Drafts Ready |

If `Mail Provider` and the enabled nodes don't match, WF3 and WF5 stop with an error (`Stop: SMTP not sent` / `Stop: Gmail not sent`) before marking anything as sent.

### Either option, before real sending

- The domain admin checks that **SPF and DKIM** cover the sending server. texprove.com already enforces DMARC (quarantine/reject), so unauthenticated mail is junked or bounced.
- Warm up slowly: 10–15 emails a day for the first two weeks (WF3 caps a run at 15).
- Nobody should read new replies in the inbox before WF4 does, including on a phone; WF4 only picks up unread mail.
- Watch the inbox-placement copies (`Seed Email`, every 12 first emails). SPF, DKIM and DMARC already pass for marketing@texprove.com; a copy in Spam means reputation or content, so slow down.

## 4. WhatsApp (removed)

The WhatsApp notification nodes were deleted from WF2, WF4, WF5 and WF6 on 2026-11-13. Manager alerts go by email and Telegram. Settings columns L and M are no longer read.

## 5. Telegram bot (optional)

Telegram is the most reliable alert channel: no 24-hour window and no business verification. The `Telegram account` credential already exists on the current instance; only the chat ID changes for the manager.

1. In Telegram, open **@BotFather**, send `/newbot`, pick a name and a username ending in `bot`. Copy the token it returns.
2. In n8n create a **Telegram API** credential named `Telegram account` and paste the token.
3. The manager opens the bot in Telegram and presses **Start** once. The bot can't message anyone who hasn't done this.
4. The manager sends any message to **@userinfobot**; it replies with their numeric ID. Put that number in `Settings` column N.
5. Select `Telegram account` on these nodes (all send HTML text, so no extra setup):

| Workflow | Node |
| --- | --- |
| WF2 | Telegram Nil |
| WF4 | Telegram Nil (hot) |
| WF5 | Telegram Nil (follow-ups) |
| WF6 | Telegram Nil (report), Telegram Nil (social) |

## 6. Import the workflows and attach credentials

On the current server (n8n.mowassirnoor.tech) WF0–WF6 are imported and every credential is attached (2026-11-13). On a fresh instance, start at step 1. n8n may not attach credentials by name on import, so check every node.

1. Download `WF0-company-discovery.json` … `WF6-weekly-report.json` from the GitHub repo.
2. In n8n: **Workflows → ⋯ → Import from File**, one file at a time.
3. Open every node with a red credential warning and pick the matching credential (table below).
4. Open every Google Sheets node and select the `Texprove Leads` sheet and the right tab.
5. In each workflow's **Settings**, check **Timezone** is `Europe/Istanbul`.
6. Save and leave the workflow **inactive**.

Which credentials each workflow needs:

| Workflow | Anthropic (+ account 2 on fallbacks) | Google Sheets | Email (SMTP/IMAP or Gmail) | HubSpot | Telegram |
| --- | --- | --- | --- | --- | --- |
| WF0 Company discovery | yes | yes | – | – | – |
| WF1 Lead research | yes | yes | – | – | – |
| WF2 Compliance + draft | yes | yes | yes | – | yes |
| WF3 Send approved | – | yes | yes | yes | – |
| WF4 Reply triage | yes | yes | yes | yes | yes |
| WF5 Follow-ups | yes | yes | yes | yes | yes |
| WF6 Weekly report | yes | yes | yes | – | yes |

n8n refuses to activate a workflow while any **enabled** node has no credential. The exports ship with the Gmail nodes disabled; if you switch to Gmail, disable the SMTP/IMAP nodes instead (section 3).

## 7. Test in test mode

Run each workflow from its **Manual Test** trigger with `Test Email` set, and check the sheet after each run.

1. **WF1**: add 2–3 test rows with `Stage = New`; they reach `Researched` with a hook.
2. **WF2**: drafts appear with Compliance Status `OK` or `Needs fix`; one notification arrives on each channel you set up.
3. **WF3**: set `Approved = Yes` on a row; the email reaches the test address, HubSpot shows the contact, the row is `Sent`.
4. **WF4**: activate it, then reply to the test email from another address. Within one poll the row gets a Reply Category; a Hot reply alerts the manager.
5. **WF5**: set a `Sent` row's `Next Follow-up Date` to yesterday and run it; a Follow-up Draft appears with `Approved = Pending`. Set `Yes` and run again; the follow-up is sent.
6. **WF6**: the weekly report arrives and three rows appear in `Social`.
7. **WF0** last: new companies have a Source URL, Confidence of 60 or more, and no duplicates.

## 8. Go-live checklist

- [ ] `Company Legal Name` checked (currently just "Texprove") and `Company Address` set (Ankara office, done 2026-11-13); opt-out and data-source sentences reviewed by the manager or a lawyer (KVKK / İYS).
- [ ] `Nil Email` and `Nil Telegram Chat ID` changed from the test values to the manager's.
- [ ] Company mailbox connected (section 3), SPF/DKIM pass, warm-up plan agreed.
- [ ] `Seed Email` points at an inbox someone checks.
- [ ] Test rows removed or set to `Opted out`; duplicate test rows in `Social` deleted.
- [ ] `Test Email` cleared in Settings.
- [ ] Workflows activated one at a time: WF4, then WF2, WF3, WF5, WF6, WF1; WF0 last.
- [ ] First week: watch bounces and spam complaints, and compare WF3's HubSpot usage estimate with HubSpot's usage page.

## 9. Self-hosting n8n

The workflows use only built-in nodes, so the repo's JSON files import into a self-hosted n8n unchanged. What changes is the server, the Anthropic key and the Google sign-in. Do the move before go-live, while `Test Email` is still set.

**What differs from n8n Cloud**

| Item | n8n Cloud | Self-hosted |
| --- | --- | --- |
| Claude nodes | can use n8n "Gateway credits" | own Anthropic API key required (section 2) |
| Google sign-in (Sheets, Gmail) | n8n's Google app, one click | your own Google OAuth client (below) |
| HTTPS, backups, updates | handled by n8n | yours |
| Credentials | stored on Cloud | re-created on the new server; they never transfer |
| Editing by Claude (MCP) | Cloud MCP URL | enable MCP on the new server and point the n8n connector at it |

**1. Server**

1. Rent a small Linux VPS (2 vCPU, 4 GB RAM is plenty; Texprove already uses Hetzner) and install Docker with the Compose plugin.
2. Point a DNS name at it, e.g. an `A` record `n8n.texprove.com` → the server's IP.
3. Generate an encryption key once: `openssl rand -hex 32`. Store it in a password manager. Losing it makes every saved credential unreadable.
4. Create a folder with these two files, replacing the domain and the two secrets.

`docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: n8n
      POSTGRES_PASSWORD: CHANGE_ME_DB_PASSWORD
      POSTGRES_DB: n8n
    volumes:
      - pg_data:/var/lib/postgresql/data

  n8n:
    image: docker.n8n.io/n8nio/n8n:latest
    restart: unless-stopped
    depends_on:
      - postgres
    environment:
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: postgres
      DB_POSTGRESDB_DATABASE: n8n
      DB_POSTGRESDB_USER: n8n
      DB_POSTGRESDB_PASSWORD: CHANGE_ME_DB_PASSWORD
      N8N_ENCRYPTION_KEY: CHANGE_ME_ENCRYPTION_KEY
      N8N_HOST: n8n.texprove.com
      N8N_PROTOCOL: https
      WEBHOOK_URL: https://n8n.texprove.com/
      GENERIC_TIMEZONE: Europe/Istanbul
      TZ: Europe/Istanbul
      EXECUTIONS_DATA_PRUNE: "true"
      EXECUTIONS_DATA_MAX_AGE: "720"
    volumes:
      - n8n_data:/home/node/.n8n

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data

volumes:
  pg_data:
  n8n_data:
  caddy_data:
```

`Caddyfile` (Caddy gets the HTTPS certificate automatically):

```
n8n.texprove.com {
    reverse_proxy n8n:5678
}
```

5. Run `docker compose up -d`, open `https://n8n.texprove.com`, and create the owner account.
6. Pin a version instead of `latest` once it works, and update deliberately (`docker compose pull && docker compose up -d`). Back up the Postgres volume daily (e.g. `pg_dump` by cron, or the provider's snapshots).

**2. Google OAuth client** (needed for Google Sheets, and for Gmail if you keep Gmail)

1. console.cloud.google.com → create a project, e.g. `Texprove n8n`.
2. **APIs & Services → Library**: enable **Google Sheets API**, **Google Drive API** (lets n8n list your sheets) and, if used, **Gmail API**.
3. **OAuth consent screen**: user type **External** (or **Internal** on Google Workspace), app name, support email. If External, **publish** the app; in "Testing" mode Google expires the sign-in after 7 days and the workflows stop.
4. **Credentials → Create credentials → OAuth client ID**, type **Web application**, authorized redirect URI `https://n8n.texprove.com/rest/oauth2-credential/callback`.
5. Copy the client ID and secret into the n8n **Google Sheets OAuth2 API** credential (and **Gmail OAuth2 API**), then click **Sign in with Google**.

**3. Move the workflows**

1. On the new server, create every credential with the names from sections 2–5. Anthropic must be your own key.
2. Import `WF0`…`WF6` from the repo and attach credentials and the sheet, as in section 6. The Google Sheet itself stays where it is.
3. Optional: also import the sheet-check workflow from the Cloud instance (open it on Cloud → ⋯ → **Download**).
4. **Deactivate WF4 (and any other active workflow) on n8n Cloud before activating anything on the new server.** Two instances running at once would process the same replies and send the same emails twice.
5. Run the tests in section 7 on the new server, then go live with section 8.
6. Cancel the Cloud plan only after a week of normal running.

**4. Keep Claude able to edit the workflows** (optional)

1. In the new n8n, open **Settings → n8n MCP** (instance-level MCP), turn it on, and copy the MCP URL and token.
2. In each workflow's settings, allow it to be used by MCP.
3. In Claude, update the n8n connector to the new URL, then start a fresh thread so the connector reloads.
