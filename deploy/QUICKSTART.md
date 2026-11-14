# Deploy the dashboard app (n8n already running)

The app is one Docker container added to the same Docker Compose project as n8n, served by Caddy at `https://dash.mowassirnoor.tech`. It assumes your n8n compose folder has `n8n` and `caddy` services. Below, that folder is `~/n8n`; change the path if yours differs.

## 1. DNS

Add an `A` record: `dash` → your server's IP. Caddy fetches the certificate itself.

## 2. Google sign-in client (5 minutes)

Google Cloud Console → project `n8n-project-513923` → APIs & Services → Credentials → Create credentials → OAuth client ID:

- Type: Web application
- Authorised redirect URI: `https://dash.mowassirnoor.tech/api/auth/callback/google`

Copy the client ID and secret.

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
AUTH_GOOGLE_ID=<client ID>
AUTH_GOOGLE_SECRET=<client secret>
AUTH_URL=https://dash.mowassirnoor.tech
ADMIN_EMAILS=<your Google address>
APPROVER_EMAILS=<Nil's Google address, or leave empty for now>
SHEET_ENV=live
DASH_KEY=<second value>
```

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

Open `https://dash.mowassirnoor.tech` and sign in with your Google account.

## The app needs these from n8n to show data

Without them the app loads but shows "cannot reach n8n":

1. In n8n, create a credential of type **Header Auth**: name `Dashboard key`, header name `X-Dash-Key`, value = the `DASH_KEY` from step 4. Select it on the webhook node(s) of the five `DB - …` workflows (folder **Dashboard**).
2. For `DB - Status` and `DB - Lead action`: create an **n8n API** key (Settings → n8n API) and an `n8n API` credential with base URL `http://localhost:5678/api/v1`, and select it on their n8n nodes.
3. Type `Hot Handled` in cell AI1 of the Leads tab (AH already holds the old `HubSpot Task ID` column; leave it).
4. Switch on the five `DB - …` workflows.

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
- Google says `redirect_uri_mismatch`: the redirect URI in step 2 doesn't match exactly.
- Banner says n8n is unreachable or the key is wrong: check the four n8n items above, and that `DASH_KEY` matches the credential value.
