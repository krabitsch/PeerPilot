# Domain & VPS setup — Hetzner CPX22

Step-by-step guide for putting Peerofessor on a Hetzner Cloud **CPX22** with its
own domain and a real Let's Encrypt certificate. Work through it top to bottom;
each step says how to check it worked before you move on.

Companion docs: `docs/RUNBOOK.md` (day-to-day operation and safe deploys),
`docs/BACKUPS.md` (backup/restore detail), `GOING-LIVE.md` (what's left before
launch). Last updated 2026-10-19.

Expect **2–3 hours**, most of it waiting for the first image build and for DNS.

---

## Placeholders used below

Replace these everywhere you see them. Write the real values into the
inventory table at the end (§14) as you go.

| Placeholder | Meaning | Example |
| ----------- | ------- | ------- |
| `<DOMAIN>` | the one hostname students will type | `peerofessor.example.at` |
| `<SERVER_IPV4>` | the server's public IPv4 | `203.0.113.10` |
| `<SERVER_IPV6>` | the server's public IPv6 (`/64`, use `::1`) | `2001:db8:1234::1` |
| `<CERT_EMAIL>` | where Let's Encrypt sends expiry warnings | `you@wu.ac.at` |
| `deploy` | the non-root Linux user that runs everything | — |
| `/srv/peerpilot` | where the repo lives on the server | — |

Commands prefixed with `laptop$` run on your own machine (Linux, macOS or WSL);
`root#` runs on the server as root; `deploy$` runs on the server as `deploy`.

---

## 0. Before you start

- [ ] **The code you want to run is pushed and merged.** The server clones from
      GitHub, so anything not pushed won't be there. Deploy from `main` (merge
      `peter` → `main` via a PR first).
- [ ] **Access you'll need:** the Hetzner account, the domain registrar account,
      and **admin rights on the GitHub repo** `krabitsch/PeerPilot` (to add a
      deploy key in §5 — if you're not admin, ask the repo owner).
- [ ] **A password manager entry** ready for: `src/.env` (whole file), the admin
      login, Hetzner and registrar logins.
- [ ] **Decide the hostname.** Use exactly one name (e.g. `peerofessor.example.at`
      or `app.example.at`). `make cert` issues a certificate for a single name,
      so don't plan on serving both `example.at` and `www.example.at`.

**What a CPX22 is:** 2 AMD vCPUs, 4 GB RAM, 80 GB NVMe disk, ~20 TB traffic per
month in EU locations. That is plenty for the running app at our scale (a
cohort of tens to a few hundred students). The tight spots are:

- **RAM during image builds** — the Angular build is memory-hungry, so the
  server gets **4 GB of swap** (§3.7).
- **Disk** — evaluation recordings run up to ~200 MB each (tens of GB per
  term), and a local backup mirror doubles that. Watch `df -h` (§12) and move
  backups off the box (§10).

---

## 1. Domain

### 1.1 Get the domain
Register the domain at any registrar (for `.at`, any nic.at-accredited
registrar; `.com`/`.eu` work the same way). If you'd rather use a subdomain of
a domain you already have — for example one run by WU IT — you don't register
anything; you ask whoever manages that zone to create the records in §1.2.

You only need **DNS management** from the registrar. No hosting, email or
website package.

### 1.2 DNS records — do this right after creating the server (§2.4)
You need the server's IP first. Once you have it, create:

| Type | Name | Value | TTL |
| ---- | ---- | ----- | --- |
| `A` | `<DOMAIN>` (or `@` for the bare domain) | `<SERVER_IPV4>` | `300` |
| `CAA` *(optional)* | `<DOMAIN>` | `0 issue "letsencrypt.org"` | `3600` |

- **Start with the `A` record only.** Let's Encrypt prefers IPv6 when an `AAAA`
  record exists, so a broken IPv6 path makes certificate issuance fail. Add the
  `AAAA` → `<SERVER_IPV6>` record later, once `curl -6 -I http://<DOMAIN>`
  works from a machine with IPv6 (optional — IPv4 alone is fine).
- **TTL 300** (5 min) while setting up, so mistakes are quick to correct. Raise
  it to `3600` once everything works.
- The `CAA` record means only Let's Encrypt may issue certificates for the
  name. Harmless to skip.

### 1.3 Check it resolves
```bash
laptop$ dig +short A <DOMAIN>          # must print <SERVER_IPV4>
```
(`nslookup <DOMAIN>` works too; on Ubuntu `dig` is in the `dnsutils` package.)
New records usually appear within minutes; some registrars take up to an hour.
Don't start §8 until this prints the right IP.

---

## 2. Hetzner Cloud

### 2.1 Account and project
1. Log in at <https://console.hetzner.com>.
2. Create a project, e.g. **Peerofessor**.
3. **Data protection:** the server will hold student names, emails and
   recordings. Hetzner offers a data processing agreement (DPA / AVV) you can
   conclude online in the account area — check with WU whether you need it, and
   if so sign it before real student data goes on the box.

### 2.2 SSH key (on your laptop)
If you don't already have one:
```bash
laptop$ ssh-keygen -t ed25519 -C "<your-name>@peerofessor"
laptop$ cat ~/.ssh/id_ed25519.pub        # copy this line
```
In the project: **Security → SSH keys → Add SSH key**, paste the line, name it
after yourself. Everyone who should be able to log in adds their own key.

### 2.3 Firewall
**Firewalls → Create Firewall**, name `peerofessor-web`. Inbound rules:

| Protocol | Port | Source | Why |
| -------- | ---- | ------ | --- |
| TCP | 22 | `0.0.0.0/0, ::/0` (or only your own IPs) | SSH |
| TCP | 80 | `0.0.0.0/0, ::/0` | HTTP → redirect + Let's Encrypt challenge |
| TCP | 443 | `0.0.0.0/0, ::/0` | HTTPS |
| ICMP | — | `0.0.0.0/0, ::/0` | ping, path-MTU |

Leave outbound empty (= everything allowed).

> **This firewall is the important one.** Docker publishes container ports by
> writing its own iptables rules, which **bypass `ufw`** on the server. Only
> nginx (80/443) is published in production, but if someone ever started the dev
> overlay by mistake (`make dev`, or plain `make`), Postgres/MinIO/API ports
> would be published too. The Hetzner firewall sits in front of the server and
> blocks those regardless.

### 2.4 Create the server
**Servers → Add Server:**

| Setting | Choose |
| ------- | ------ |
| Location | an EU location close to Vienna — **Nuremberg** or **Falkenstein** (Germany) |
| Image | **Ubuntu 24.04** |
| Type | Shared vCPU → **CPX22** (2 vCPU AMD, 4 GB, 80 GB) |
| Networking | **Public IPv4** ✔ and **Public IPv6** ✔ (IPv4 is billed separately but you need it) |
| SSH keys | tick your key(s) from §2.2 |
| Volumes | none |
| Firewalls | `peerofessor-web` from §2.3 |
| Backups | **enable** (daily whole-server snapshots, 7 kept; costs +20% of the server price) |
| Name | `peerofessor-prod` |

Create it, then note **`<SERVER_IPV4>`** and **`<SERVER_IPV6>`** from the server
page. **Now go back and create the DNS record (§1.2).**

> The Hetzner backups are a safety net for the whole disk ("roll the server back
> to last night"). They don't replace `make backup` (§10): they live in the same
> Hetzner account, and restoring one rolls back *everything*.

### 2.5 Reverse DNS (optional)
On the server page → **Networking → Reverse DNS**: set the IPv4 (and IPv6)
entry to `<DOMAIN>`. Cosmetic for us (it matters for sending mail, which
Peerofessor doesn't do), but it makes logs and `traceroute` output readable.

---

## 3. First login and hardening

### 3.1 Log in and update
```bash
laptop$ ssh root@<SERVER_IPV4>
root# apt update && apt full-upgrade -y
root# [ -f /var/run/reboot-required ] && reboot     # reconnect after ~30 s if it reboots
```

### 3.2 Time zone and hostname
```bash
root# timedatectl set-timezone Europe/Vienna        # cron times below are Vienna time
root# hostnamectl set-hostname peerofessor-prod
```

### 3.3 Create the `deploy` user
```bash
root# adduser --gecos "" deploy                     # pick a strong password (needed for sudo)
root# usermod -aG sudo deploy
root# rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # same SSH keys as root
```
**Test it in a second terminal before going on** (keep the root session open):
```bash
laptop$ ssh deploy@<SERVER_IPV4>
deploy$ sudo whoami                                 # prints: root
```

### 3.4 Lock down SSH
Only once the `deploy` login above works:
```bash
root# cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
root# sshd -t && systemctl reload ssh
```
Open a **new** terminal and confirm `ssh deploy@<SERVER_IPV4>` still works
before closing the root session. From here on, everything runs as `deploy`.

### 3.5 Automatic security updates
```bash
deploy$ sudo apt install -y unattended-upgrades
deploy$ sudo dpkg-reconfigure -plow unattended-upgrades     # answer "Yes"
```

### 3.6 Host firewall (second layer)
```bash
deploy$ sudo ufw allow OpenSSH
deploy$ sudo ufw allow 80/tcp
deploy$ sudo ufw allow 443/tcp
deploy$ sudo ufw enable
deploy$ sudo ufw status
```
(See the note in §2.3: `ufw` does **not** filter Docker-published ports — the
Hetzner firewall does.)

### 3.7 Swap (needed for image builds)
```bash
deploy$ sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
deploy$ sudo mkswap /swapfile && sudo swapon /swapfile
deploy$ echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
deploy$ echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf && sudo sysctl --system
deploy$ free -h                                    # Swap: 4.0Gi
```

### 3.8 fail2ban (recommended)
Bans IPs that hammer SSH. The default config protects `sshd` out of the box:
```bash
deploy$ sudo apt install -y fail2ban
deploy$ sudo systemctl enable --now fail2ban
deploy$ sudo fail2ban-client status sshd
```

---

## 4. Install the software

### 4.1 Docker Engine + Compose plugin (official repository)
```bash
deploy$ sudo apt install -y ca-certificates curl
deploy$ sudo install -m 0755 -d /etc/apt/keyrings
deploy$ sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
deploy$ sudo chmod a+r /etc/apt/keyrings/docker.asc
deploy$ echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
          | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
deploy$ sudo apt update
deploy$ sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 4.2 Cap Docker's log files
By default container logs grow forever and can fill the disk. Set this
**before** the first start (it applies to containers created afterwards):
```bash
deploy$ sudo tee /etc/docker/daemon.json > /dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
EOF
deploy$ sudo systemctl restart docker
```

### 4.3 Let `deploy` run Docker
```bash
deploy$ sudo usermod -aG docker deploy
deploy$ exit                                       # log out and back in for the group to apply
laptop$ ssh deploy@<SERVER_IPV4>
deploy$ docker run --rm hello-world                # prints "Hello from Docker!"
```
(Docker group membership is root-equivalent. That's acceptable on a box that
does nothing else, but only give `deploy` access to people who should have root.)

### 4.4 git, make, Node.js 22
**Why Node on the host:** the API image doesn't generate the Prisma database
client itself — `make build` generates it on the host (`make genPrismaClient`)
and copies it in. `scripts/gen-env.sh` does the same. So the server needs Node
and npm, not just Docker.
```bash
deploy$ sudo apt install -y git make openssl
deploy$ curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
deploy$ sudo -E bash /tmp/nodesource_setup.sh
deploy$ sudo apt install -y nodejs
deploy$ node --version && npm --version && docker compose version
```

---

## 5. Get the code

### 5.1 Deploy key (read-only access to the private repo)
```bash
deploy$ ssh-keygen -t ed25519 -C "peerofessor-prod deploy key" -f ~/.ssh/id_ed25519 -N ""
deploy$ cat ~/.ssh/id_ed25519.pub
```
On GitHub: **krabitsch/PeerPilot → Settings → Deploy keys → Add deploy key**.
Title `peerofessor-prod`, paste the line, **leave "Allow write access" unticked**.
(Needs repo admin.) Then:
```bash
deploy$ ssh -T git@github.com                      # "Hi krabitsch/PeerPilot! You've successfully authenticated..."
```

### 5.2 Clone
```bash
deploy$ sudo mkdir -p /srv/peerpilot && sudo chown deploy:deploy /srv/peerpilot
deploy$ git clone git@github.com:krabitsch/PeerPilot.git /srv/peerpilot
deploy$ cd /srv/peerpilot
deploy$ git checkout main
deploy$ git log --oneline -1                       # the commit you expect to deploy?
```

---

## 6. Configure `src/.env`

### 6.1 Generate it (random secrets)
```bash
deploy$ cd /srv/peerpilot
deploy$ bash scripts/gen-env.sh --defaults
```
This writes `src/.env` with **random** database, JWT and MinIO secrets, links
it for Prisma, and generates the Prisma client.

### 6.2 Set the production values
```bash
deploy$ nano src/.env
```
Change exactly these lines:

| Variable | Set to | Why |
| -------- | ------ | --- |
| `NODE_ENV` | `production` | **Required.** Secure cookies, production rate limits; the app refuses to start with default MinIO credentials. |
| `BASE_URL` | `https://<DOMAIN>/` | Public origin; file and recording links are built from it. |
| `FRONTEND_URL` | `https://<DOMAIN>` (no trailing slash) | Used as the CORS origin. |
| `ADMIN_EMAIL` | the first admin's real address, **lowercase** | First admin login, created on first start. |
| `ADMIN_USERNAME` | e.g. `admin` | |
| `ADMIN_PASSWORD` | a long random password (from your password manager) | **Never keep the default `Test1234!`.** |

Leave everything else as generated. `DB_LOCAL_PORT` and `MINIO_PUBLIC_*` only
matter for development; `GOOGLE_*`, `GITHUB_*` and `EMAIL_*` are unused (no
OAuth, no email).

The admin account is created **only if it doesn't exist yet**. Changing
`ADMIN_PASSWORD` later does **not** change the password of an existing admin.

### 6.3 Protect it
```bash
deploy$ chmod 600 src/.env
deploy$ cat src/.env                               # copy the whole file into the password manager
```
> **Never regenerate or delete `src/.env` on this server once the stack has
> started.** The database volume is initialised with the password in this file;
> a new file means the API can no longer connect, and the data is effectively
> locked away until the original file is restored.

---

## 7. Build and start

> **Never type plain `make` on the server** — the default target is the *dev*
> stack, which publishes the database and MinIO ports. Always use the targets
> below.

```bash
deploy$ cd /srv/peerpilot
deploy$ make run          # build images, start, apply migrations, create the admin
```
The first build takes roughly **10–20 minutes** on a CPX22 (later builds are
faster thanks to Docker's layer cache). If it dies with an out-of-memory error,
check `free -h` shows the swap from §3.7 and run `make run` again.

Check it:
```bash
deploy$ make status                                # every container "Up", database/minio "(healthy)"
deploy$ curl -skI https://localhost | head -1      # HTTP/1.1 200 OK (or 304)
deploy$ curl -sI  http://<DOMAIN>  | head -3       # 301 → https://<DOMAIN>/
```
The site is now reachable at `https://<DOMAIN>`, but with a **self-signed
certificate** (browser warning) until §8.

---

## 8. TLS certificate (Let's Encrypt)

### 8.1 Pre-flight
Both must pass, otherwise Let's Encrypt can't reach the challenge files:
```bash
laptop$ dig +short A <DOMAIN>                                        # <SERVER_IPV4>
laptop$ curl -sI http://<DOMAIN>/.well-known/acme-challenge/ping | head -1
# expect: HTTP/1.1 404 Not Found   (served by nginx's challenge location — good)
# wrong:  301 Moved Permanently    (the challenge path isn't routed)
# wrong:  timeout                  (DNS or port 80 / firewall problem)
```

### 8.2 Dry run (doesn't count against Let's Encrypt rate limits)
```bash
deploy$ cd /srv/peerpilot
deploy$ docker compose -f src/docker-compose.yml run --rm certbot certonly \
          --webroot -w /var/www/certbot -d <DOMAIN> \
          --email <CERT_EMAIL> --agree-tos --no-eff-email --non-interactive --dry-run
```
Expect `The dry run was successful.` If not, fix that first — real attempts
are rate-limited (a handful of failures per hour per hostname).

### 8.3 Issue and install the real certificate
```bash
deploy$ make cert DOMAIN=<DOMAIN> CERTBOT_EMAIL=<CERT_EMAIL>
```
This requests the certificate, copies it into the volume nginx serves from, and
reloads nginx. The certificate survives restarts and redeploys.

### 8.4 Verify
```bash
laptop$ curl -sI https://<DOMAIN> | head -1                          # 200, no certificate error
laptop$ echo | openssl s_client -connect <DOMAIN>:443 -servername <DOMAIN> 2>/dev/null \
          | openssl x509 -noout -issuer -enddate                     # issuer: Let's Encrypt; ~90 days out
```
And open `https://<DOMAIN>` in a browser — padlock, no warning.

---

## 9. First use of the app

1. Open `https://<DOMAIN>` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. **Admin → Organisations:** create the organisation (e.g. WU Economics).
3. In the organisation: **whitelist the teaching staff's emails**. Each of them
   registers at `https://<DOMAIN>/register`; then promote them to **Bocal**
   from the same page.
4. As Bocal: **create the course** — *Foundations of Macroeconomics*, term
   *Fall 2026*, official course numbers **`1268, 1269, 1421`** (required).
5. **Students tab → pick the course → Add several…**: paste one
   `email, course number` per line. Students who haven't registered yet get a
   pending account (badge **Not registered**) and can already be grouped and
   paired. Each student activates their account by registering at
   `https://<DOMAIN>/register` with that email.
6. Tell students the URL. Forgotten passwords: an admin resets them from the
   organisation page (there is no email reset).

---

## 10. Backups — three layers

| Layer | What | Protects against | Set up in |
| ----- | ---- | ---------------- | --------- |
| Hetzner Backups | daily snapshot of the whole server, 7 kept | broken upgrade, "undo yesterday" | §2.4 (checkbox) |
| `make backup` | nightly DB dump + copy of every MinIO bucket | single bad deploy/migration, deleted data | §10.1 + §11 |
| Off-host copy | the `make backup` output on another machine | losing the server or the Hetzner account | §10.2 |

### 10.1 Local backups with `make backup`
```bash
deploy$ sudo mkdir -p /srv/peerpilot-backups && sudo chown deploy:deploy /srv/peerpilot-backups
deploy$ cd /srv/peerpilot && BACKUP_DIR=/srv/peerpilot-backups make backup
deploy$ ls -R /srv/peerpilot-backups | head        # db/… .sql.gz and files/<bucket>/
```
DB dumps older than 14 days are pruned (`BACKUP_KEEP_DAYS`). The file mirror is
a full second copy of every bucket, so it **doubles** the disk used by
recordings — if the 80 GB disk gets tight, attach a Hetzner **Volume** (block
storage), mount it, and point `BACKUP_DIR` there.

### 10.2 Off-host copy
Moving backups off the server is a deliberate step (see `docs/BACKUPS.md`).
Either copy `/srv/peerpilot-backups` to another machine by hand on a fixed
schedule, or automate it with a **Hetzner Storage Box** (cheap SSH/rsync storage):

1. Order a Storage Box (smallest size is plenty) in the Hetzner console, enable
   **SSH support** in its settings, note its user `uXXXXXX`.
2. Give the server a dedicated key and install it on the box (Hetzner's Storage
   Box docs describe the `ssh-copy-id -s` method; the box listens on port 23):
   ```bash
   deploy$ ssh-keygen -t ed25519 -f ~/.ssh/storagebox -N "" -C "peerofessor-prod backups"
   deploy$ ssh-copy-id -p 23 -s -i ~/.ssh/storagebox.pub uXXXXXX@uXXXXXX.your-storagebox.de
   ```
3. Test one sync:
   ```bash
   deploy$ rsync -az -e "ssh -p 23 -i ~/.ssh/storagebox" \
             /srv/peerpilot-backups/ uXXXXXX@uXXXXXX.your-storagebox.de:peerpilot/
   ```
   This never deletes on the box, so old DB dumps accumulate there; clean them
   up now and then (or add `--delete` if the box should mirror the 14-day window).
4. Schedule it (next section).

### 10.3 Test a restore once
Before students depend on it, restore the latest dump into a **scratch** stack
(e.g. on a laptop) with `make restore-db FILE=…` and check the data is there.
**Never run `restore-db` on the production server unless you mean to replace
the live database.** An untested backup is a guess.

---

## 11. Scheduled jobs (cron)

```bash
deploy$ mkdir -p ~/logs
deploy$ crontab -e
```
Add (times are Vienna time, §3.2):
```cron
# m  h  dom mon dow  command
0    2  *   *   *    cd /srv/peerpilot && BACKUP_DIR=/srv/peerpilot-backups make backup >> ~/logs/backup.log 2>&1
45   2  *   *   *    rsync -az -e "ssh -p 23 -i ~/.ssh/storagebox" /srv/peerpilot-backups/ uXXXXXX@uXXXXXX.your-storagebox.de:peerpilot/ >> ~/logs/offsite.log 2>&1
30   3  *   *   *    cd /srv/peerpilot && make cert-renew >> ~/logs/cert.log 2>&1
```
(Drop the `rsync` line if you copy backups off by hand.) `make cert-renew` only
renews within 30 days of expiry, so running it daily is harmless.

Check the next morning:
```bash
deploy$ tail -n 20 ~/logs/backup.log ~/logs/cert.log
deploy$ ls -lt /srv/peerpilot-backups/db | head -3
```

---

## 12. Go-live checklist

- [ ] `https://<DOMAIN>` shows a valid Let's Encrypt certificate; `http://` redirects.
- [ ] `src/.env` has `NODE_ENV=production`, the right `BASE_URL`/`FRONTEND_URL`,
      a non-default admin password — and a copy is in the password manager.
- [ ] Admin can sign in; organisation, staff and course (with `1268, 1269, 1421`) exist.
- [ ] A test student can register, upload a submission, and a file link opens.
- [ ] An evaluation recording uploads and plays back (exercises the private
      bucket + presigned links through `BASE_URL`).
- [ ] `make status` all healthy; `docker logs api --since 10m` has no errors.
- [ ] Hetzner Backups enabled; `make backup` ran; off-host copy exists; one
      restore tested.
- [ ] Cron jobs installed and their logs show success.
- [ ] Hetzner firewall attached; only 22/80/443 reachable from outside:
      `laptop$ nc -zv <SERVER_IPV4> 5432` must fail.
- [ ] Disk headroom: `df -h /` under ~60% used; `docker system df` looks sane.
- [ ] *(Optional)* an external uptime monitor pings `https://<DOMAIN>`.

---

## 13. After go-live

- **Deploying a new version:** follow `docs/RUNBOOK.md` §3 — the short version:
  ```bash
  deploy$ cd /srv/peerpilot
  deploy$ BACKUP_DIR=/srv/peerpilot-backups make backup   # always first
  deploy$ git pull
  deploy$ make run          # builds while the old version keeps serving, then swaps + migrates
  deploy$ make status
  ```
  Read any new files under `src/packages/database/prisma/migrations/` before
  deploying them. Afterwards `docker image prune -f` frees space from old
  images (it never touches data volumes).
- **Never run on the server:** `make clean`, `make fclean`, `make resetDB`,
  `make populateDB`, `make dev` / plain `make`, `make e2e`, anything with
  `down -v`, `docker volume rm …`, or `docker system prune --volumes`. The full
  list and why is in `docs/RUNBOOK.md` §6.
- **Watch the disk** every week or two: `df -h /` and
  `du -sh /srv/peerpilot-backups`.
- **OS updates** install automatically (§3.5). If `/var/run/reboot-required`
  exists, reboot at a quiet time (`sudo reboot`); the containers come back by
  themselves (`restart: unless-stopped`).

### Troubleshooting

| Symptom | Look at |
| ------- | ------- |
| Site unreachable | `dig +short A <DOMAIN>`; Hetzner firewall attached?; `make status`; `docker logs nginx --tail 50` |
| Browser certificate warning | §8.1 pre-flight, then `make cert …` again; `docker logs nginx` says which certificate it loaded |
| 502 Bad Gateway | the API container: `docker logs api --tail 100`; `make restart` |
| "MinIO default credentials" on start | `NODE_ENV=production` but MinIO keys are defaults — fix `src/.env`, `make restart` |
| API can't reach the database after `.env` edits | the DB password no longer matches the volume — restore the original `src/.env` (do **not** `make fclean`) |
| Build killed / out of memory | `free -h` — is the swap active? (§3.7) |
| Disk full | `du -sh /srv/peerpilot-backups /var/lib/docker`; prune old images; move backups to a Volume / off-host |

---

## 14. Inventory (fill in and store with the passwords)

| Item | Value |
| ---- | ----- |
| Domain / registrar | |
| `<DOMAIN>` | |
| Hetzner project / server name | Peerofessor / `peerofessor-prod` |
| Location | |
| `<SERVER_IPV4>` / `<SERVER_IPV6>` | |
| SSH users with access | |
| GitHub deploy key title | `peerofessor-prod` |
| Deployed branch / commit | |
| Admin email | |
| `src/.env` stored in | (password manager entry) |
| Storage Box user | |
| Certificate email | |

**Running costs** (check current prices on Hetzner's pricing page and your
registrar): the CPX22, its public IPv4, Hetzner Backups (+20% of the server),
an optional Storage Box and Volume, and the domain itself.
