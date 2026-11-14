# Deploy the dashboard app (n8n already running)

The app is one Docker container added to the same Docker Compose project as n8n, served by Caddy at `https://dash.mowassirnoor.tech`. It assumes your n8n compose folder has `n8n` and `caddy` services. Below, that folder is `~/n8n`; change the path if yours differs.

## 1. DNS

Add an `A` record: `dash` → your server's IP. Caddy fetches the certificate itself.

## 2. Sign-in

Sign-in is email + password by default: each person's password is stored only as a hash in `DASH_USERS` (step 4b). Google sign-in is optional: to add it, create a Web OAuth client in Google Cloud (redirect URI `https://dash.mowassirnoor.tech/api/auth/callback/google`) and set `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.

## 3. Get the code on the server

The code is on the `dev` branch.

```bash
cd ~
git clone -b dev https://github.com/Mowassir-Noor/n8n_sales_automation.git
```

## 4. Write `dashboard.env`

```bash
cd ~/n8n
openssl rand -base64 32   # -> AUTH_SECRET
openssl rand -hex 32      # -> DASH_KEY
nano dashboard.env
chmod 600 dashboard.env
```

```bash
AUTH_SECRET=<first value>
DASH_USERS=<the line(s) from step 4b, comma-separated>
AUTH_URL=https://dash.mowassirnoor.tech
ADMIN_EMAILS=<your email>
APPROVER_EMAILS=<Nil's email, or leave empty for now>
SHEET_ENV=live
DASH_KEY=<second value>
```

### 4b. Make a password entry

After the container is running (step 5), for each person:

```bash
cd ~/n8n
docker compose exec dashboard node scripts/hash-password.mjs you@example.com
```

Type the password twice (at least 10 characters). Paste the printed `email:…:…` line into `DASH_USERS` (several people: separate with commas), make sure the same email is in `ADMIN_EMAILS` or `APPROVER_EMAILS`, then `docker compose up -d dashboard`.

## 5. Add the container

```bash
cd ~/n8n
cp ~/n8n_sales_automation/deploy/docker-compose.dashboard.yml docker-compose.override.yml
docker compose build dashboard
docker compose up -d dashboard
docker compose ps dashboard        # wait until it says "healthy"
```

If you already have a `docker-compose.override.yml`, paste the `dashboard:` service from that file into it instead of copying over it.

## 6. Caddy

Add this block to `~/n8n/Caddyfile`:

```
dash.mowassirnoor.tech {
	encode zstd gzip
	reverse_proxy dashboard:3000
}
```

Also add these two lines at the top of your existing `n8n.mowassirnoor.tech { … }` block, so the dashboard's webhooks can't be reached from the internet:

```
	@dashWebhooks path /webhook/dash/* /webhook-test/dash/* /webhook/dash-staging/* /webhook-test/dash-staging/*
	respond @dashWebhooks 404
```

Then reload:

```bash
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Open `https://dash.mowassirnoor.tech` and sign in with your email and password.

## The app needs these from n8n to show data

Without them the app loads but shows "cannot reach n8n":

1. In n8n, create a credential of type **Header Auth**: name `Dashboard key`, header name `X-Dash-Key`, value = the `DASH_KEY` from step 4. Select it on the webhook node(s) of the five `DB - …` workflows (folder **Dashboard**).
2. For `DB - Status` and `DB - Lead action`: create an **n8n API** key (Settings → n8n API) and an `n8n API` credential with base URL `http://localhost:5678/api/v1`, and select it on their n8n nodes.
3. Type `Hot Handled` in cell AI1 of the Leads tab (AH already holds the old `HubSpot Task ID` column; leave it).
4. Switch on the five `DB - …` workflows.

## Optional: use the dashboard from Claude

```bash
cd ~/n8n && docker compose exec dashboard node scripts/mcp-key.mjs nil@example.com
```

Put the printed `MCP_KEYS` entry in `dashboard.env` (the email must also be in `ADMIN_EMAILS` for full access), run `docker compose up -d dashboard`, and paste the printed URL into Claude: Settings → Connectors → Add custom connector. The URL contains the key, so share it only with that person. Details in `docs/dashboard.md`, section 4.

## Updating later

```bash
cd ~/n8n_sales_automation && git pull
cd ~/n8n && docker compose build dashboard && docker compose up -d dashboard
```

## If something is wrong

```bash
docker compose logs -f dashboard
```

- "not authorised" at sign-in: your address is not in `ADMIN_EMAILS` / `APPROVER_EMAILS` (fix it, then `docker compose up -d dashboard`).
- "Wrong email or password": check the `DASH_USERS` entry was made for that exact email; 8 wrong tries lock that email for 15 minutes (restart the container to clear it).
- Banner says n8n is unreachable or the key is wrong: check the four n8n items above, and that `DASH_KEY` matches the credential value.
