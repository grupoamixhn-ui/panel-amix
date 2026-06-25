# Flussonic Admin Panel — Self-hosted install

Install the panel on your own Linux server in one command. Targets **Ubuntu
22.04/24.04, Debian 11/12 and AlmaLinux/RockyLinux 8/9/10**.

## What gets installed

| Component | Where |
| --- | --- |
| Backend (FastAPI + uvicorn) | `/opt/flussonic-admin/backend` running as `systemd` unit `flussonic-admin` on `127.0.0.1:8001` |
| Frontend (React production build) | `/opt/flussonic-admin/frontend/build` served by **nginx** |
| Database | **MongoDB 7** (database `flussonic_admin`) — installed if not present |
| Reverse proxy | **nginx** on port `80` (or `--port`) routing `/api → backend`, everything else → SPA |
| SSL (optional) | Let's Encrypt via certbot when you pass `--domain` |

Backend runs as the dedicated unprivileged system user `flussonic-admin`.

## Quick install

```bash
# 1. Get the code onto the server (copy/clone/upload to a tmp dir)
sudo bash install/install.sh
```

### Common variants

```bash
# Public domain with auto SSL
sudo bash install/install.sh --domain panel.example.com

# Different port (e.g. behind another reverse proxy)
sudo bash install/install.sh --port 8080

# You already run MongoDB on this host
sudo bash install/install.sh --no-mongo

# Custom admin email
sudo bash install/install.sh --admin-email me@yourdomain.com

# All options
sudo bash install/install.sh --domain panel.example.com --admin-email me@yourdomain.com
```

At the end of the install you will see:

```
══════════════════════════════════════════════════════
  Flussonic Admin Panel — install complete
══════════════════════════════════════════════════════

  URL:       https://panel.example.com
  Login:     admin@localhost
  Password:  Xk9aH3pQmWnT2eYr

  ⚠  Save this password now — it is only shown here.
```

> The admin password is also stored (root-only) in
> `/opt/flussonic-admin/backend/.env` as `ADMIN_PASSWORD=…` in case you forget.
> Change it from Settings inside the panel after first login.

## Connect to your Flussonic server

After logging in:

1. Open **Settings**.
2. Fill in your Flussonic Media Server URL (e.g. `http://media.yourdomain.com`),
   API user, password, public host name and RTMP/SRT ports.
3. Click **Save**. The dashboard, streams, sessions and monitor pages will
   start pulling live data.

## Day-2 operations

```bash
# Service status / logs / restart
systemctl status   flussonic-admin
systemctl restart  flussonic-admin
journalctl -u      flussonic-admin -f

# nginx site
sudo nginx -t && sudo systemctl reload nginx
# config: /etc/nginx/sites-available/flussonic-admin.conf   (Debian/Ubuntu)
#         /etc/nginx/conf.d/flussonic-admin.conf            (AlmaLinux/Rocky)

# Database location
mongosh --quiet --eval 'db.getSiblingDB("flussonic_admin").stats()'
```

## Update to a new version

1. Upload the new code somewhere on the server, e.g. `/tmp/flussonic-admin-new`.
2. Re-run the installer pointing at the new source:

```bash
sudo bash /tmp/flussonic-admin-new/install/install.sh \
  --source-dir /tmp/flussonic-admin-new
```

The installer is idempotent — it preserves the existing `backend/.env` (admin
password, JWT secret, Mongo URL) unless you remove it first. Database content
is **never** touched.

## Uninstall

```bash
sudo bash /opt/flussonic-admin/install/uninstall.sh             # keep Mongo + DB
sudo bash /opt/flussonic-admin/install/uninstall.sh --purge-db  # also drop the DB
```

This removes the systemd unit, the nginx site, the application directory and
the system user. MongoDB itself is left running; pass `--purge-db` to drop the
`flussonic_admin` database. The MongoDB package itself is never removed
automatically.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `502 Bad Gateway` from nginx | `systemctl status flussonic-admin`, then `journalctl -u flussonic-admin -n 80`. |
| `MongoServerSelectionError` in logs | `systemctl status mongod`. On SELinux systems: `setsebool -P httpd_can_network_connect 1`. |
| Forgot admin password | Edit `/opt/flussonic-admin/backend/.env`, set a new `ADMIN_PASSWORD=...`, then `sudo systemctl restart flussonic-admin`. The backend re-syncs the password from `.env` on every startup. |
| Need to allow a non-standard listen port through the firewall | `sudo ufw allow 8080/tcp` (Debian/Ubuntu) / `sudo firewall-cmd --permanent --add-port=8080/tcp && sudo firewall-cmd --reload` (RHEL family). |
| Behind another reverse proxy (Cloudflare, Caddy) | Install with `--port 8080`, then point your proxy at `http://<server>:8080`. Skip `--domain` (the outer proxy handles SSL). |

## Notes

- The installer is fully idempotent: re-running it upgrades the code in place
  without losing data.
- The frontend build is fully static — no Node process runs in production.
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` are **re-synced** to the admin
  user on every backend startup, so you can rotate them by editing the file
  and restarting the service.
SSWORD` from `.env` are **re-synced** to the admin
  user on every backend startup, so you can rotate them by editing the file
  and restarting the service.
