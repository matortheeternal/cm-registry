# Fly.io deployment

This deployment runs one Node 24 Machine with SQLite and artifacts on a persistent
volume. Fly Proxy terminates public HTTPS. No Caddy, D1, R2, or Cloudflare account
is required. Deployments and host failures can cause downtime.

## First deployment

Install the Fly CLI and sign in with `fly auth login`.

1. Edit `fly.toml`: choose a globally unique `app`, set the matching
   `REGISTRY_PUBLIC_ORIGIN` (HTTPS, no trailing slash), and choose a region.
   The examples below assume `cm-registry` and `sjc`; use your chosen values.
2. Create the app and one volume:

   ```sh
   fly apps create cm-registry
   fly volumes create registry_data --region sjc --size 1
   ```

3. Generate a random administrator token and store it in your password manager:

   ```sh
   openssl rand -hex 32
   ```

   Import it without placing the token in shell history:

   ```sh
   read -rsp 'Admin token: ' registry_admin_token
   printf '\n'
   printf 'REGISTRY_ADMIN_TOKEN=%s\n' "$registry_admin_token" | fly secrets import
   unset registry_admin_token
   ```

4. Deploy exactly one Machine and check it:

   ```sh
   fly deploy --ha=false
   fly status
   fly checks list
   curl -i https://cm-registry.fly.dev/v1/extensions
   ```

Do not scale out or add regions: Fly volumes are independent and this application
does not replicate its SQLite database or package files. `min_machines_running`
is not a maximum Machine count. Keep using `fly deploy --ha=false` for updates.

## Administration

Public port 8787 rejects `/admin` and `/v1/admin` routes. A separate listener on
8788 is reachable on Fly's private network and still requires the bearer token
for admin API operations. Keep access to the organization's private network
restricted. Do not publish this port or forward it through a public proxy.

```sh
fly proxy 8788:8788 --bind-addr 127.0.0.1
```

Open **http://127.0.0.1:8788/admin** and enter your token. Keep this exact local
port and address: the adapter uses it for origin validation. The Fly proxy
connection provides private transport. Ordinary local development via
`npm start` retains the existing loopback-only behavior.

Publisher clients sign for `REGISTRY_PUBLIC_ORIGIN`. The server never derives
that origin from untrusted Host or forwarding headers. When adding a custom
domain, provision its Fly certificate and update the configured origin and
clients together; alternate hostnames are not supported for signed requests.

The reference `npm run client -- ...` commands default to
`https://cm-registry.fly.dev`. For local development, pass
`--registry http://127.0.0.1:8787` explicitly.

## Data and maintenance

`/data/registry.sqlite` and `/data/artifacts` survive deploys. Startup initializes
the schema using the existing migration code; do not configure a Fly release
command for local SQLite, since release Machines do not mount this volume.

Run cleanup periodically against the running Machine:

```sh
fly ssh console -C 'node scripts/maintenance.js cleanup'
```

Back up SQLite with the existing backup command and copy artifacts while writes
are paused. Keep consistent backups off the Machine and test restoration. Volume
snapshots alone are not a complete backup plan. Cleanup scheduling and off-server
backup automation are not included in this initial setup.
