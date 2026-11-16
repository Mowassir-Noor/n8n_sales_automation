# Getting the dashboard image onto the server

The dashboard runs as one more container next to n8n, Postgres and Caddy. There are two ways to get its image. Pick one; you can switch later.

| | A. Build on the server | B. Pull from GitHub Container Registry |
| --- | --- | --- |
| Needs | a git checkout of this repo on the server | a `dashboard-v*` tag pushed to GitHub, so CI builds the image |
| Update | `git pull` + `docker compose build dashboard` | change the tag + `docker compose pull dashboard` |
| Build time on the server | 2 to 4 minutes, about 1 GB of temporary RAM and disk | none |
| Rollback | `git checkout <older tag>` and rebuild | put the old tag back |

Both use `deploy/docker-compose.dashboard.yml`. The commands below assume the server's compose folder is `~/n8n` (the one holding `docker-compose.yml` and `Caddyfile`) and that you saved the dashboard file there as `docker-compose.override.yml`, so plain `docker compose` picks it up. If you keep it as a separate file, add `-f docker-compose.yml -f docker-compose.dashboard.yml` to every command.

## A. Build on the server from a git checkout

One time:

```bash
cd ~
git clone https://github.com/Mowassir-Noor/n8n_sales_automation.git
# Private repository? Use a deploy key or a fine-grained token with read access to contents.

cd ~/n8n
cp ~/n8n_sales_automation/deploy/docker-compose.dashboard.yml docker-compose.override.yml
```

The file's build context defaults to `../n8n_sales_automation/dashboard`, which matches the layout above (`~/n8n` and `~/n8n_sales_automation` side by side). If the checkout lives elsewhere, set it in `~/n8n/.env`:

```bash
echo 'DASHBOARD_BUILD_CONTEXT=/opt/n8n_sales_automation/dashboard' >> ~/n8n/.env
```

Build and start:

```bash
cd ~/n8n
docker compose build dashboard
docker compose up -d dashboard
docker compose ps dashboard        # STATUS should become "healthy" within a minute
```

The image is tagged `texprove-dashboard:local`.

Update:

```bash
cd ~/n8n_sales_automation && git pull
cd ~/n8n && docker compose build dashboard && docker compose up -d dashboard
```

To deploy a specific release instead of the latest commit, `git checkout dashboard-v1.2.0` in the checkout before building. Rollback is the same with the older tag.

If the server runs short of memory during the build (n8n stays up while it builds), build at a quiet time, outside the 10:00, 11:00 and 14:00 runs.

## B. Pull an image built by GitHub Actions

The workflow `.github/workflows/dashboard.yml` builds and pushes `ghcr.io/mowassir-noor/texprove-dashboard` whenever a tag named `dashboard-v*` is pushed. The image tags are the version without the prefix (`dashboard-v1.0.0` gives `1.0.0` and `1.0`).

Release (on your computer):

```bash
git tag dashboard-v1.0.0
git push origin dashboard-v1.0.0
```

Wait for the "dashboard" workflow run to go green in the repository's **Actions** tab.

One time on the server:

1. The package is private by default. Either make it public (GitHub → your profile → **Packages** → `texprove-dashboard` → **Package settings** → **Change visibility**), or log the server in with a classic personal access token that has only `read:packages`:

   ```bash
   echo '<token>' | docker login ghcr.io -u <github-username> --password-stdin
   ```

2. Copy the compose file and delete its `build:` block (the two lines `build:` and `context: ...`):

   ```bash
   cd ~/n8n
   curl -fsSL -o docker-compose.override.yml \
     https://raw.githubusercontent.com/Mowassir-Noor/n8n_sales_automation/main/deploy/docker-compose.dashboard.yml
   # then edit it and remove the build: block
   ```

   The raw URL only works while the repository is public; otherwise copy the file from your computer with `scp deploy/docker-compose.dashboard.yml <server>:~/n8n/docker-compose.override.yml`.

3. Choose the version in `~/n8n/.env`:

   ```bash
   echo 'DASHBOARD_IMAGE=ghcr.io/mowassir-noor/texprove-dashboard:1.0.0' >> ~/n8n/.env
   ```

Start or update:

```bash
cd ~/n8n
docker compose pull dashboard
docker compose up -d dashboard
```

Rollback: put the previous version back in `DASHBOARD_IMAGE` and run the same two commands.

## Either way

- `dashboard.env` must exist next to the compose file before the first start (see `docs/dashboard.md`, step 6), with `chmod 600`.
- Logs: `docker compose logs -f dashboard`.
- Health: `docker compose exec dashboard node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"`.
- Old images pile up after many updates; `docker image prune` removes the unused ones.
