# Restricted deploy user

Deploys (the *Deploy Dev* workflow and `deploy.sh`) log in as `deploy`, not
`root`. The user's SSH keys are bound to a forced command,
[`agenda-deploy`](agenda-deploy), which accepts exactly two things:

- an rsync upload, confined by `rrsync -wo` to the app directory
  (no downloads, no paths outside it)
- `restart`, which runs [`agenda-restart`](agenda-restart) as `dockeruser`
  through a sudoers rule
- `proxy-install`, which pipes a tar stream of the ICS proxy's two files into
  [`agenda-proxy-install`](agenda-proxy-install), also as `dockeruser`; that
  script syntax-checks the upload, swaps it in and rolls back if the proxy
  does not come up

A leaked deploy key can therefore replace the app's files, replace the ICS
proxy's code and restart containers — but not open a shell, read data or
touch anything else.

## Where each step runs

Three machines are involved. Every step below says which one it means.

| Name used here | Machine | Role |
|---|---|---|
| **OpenCloud server** | `cloud.linux-nerds.org` | receives the deploy; the `deploy` user lives here. Commands run as root. |
| **Workstation** | your own computer with this repository | runs `deploy.sh`; holds the key `~/.ssh-jail/opencloud/hetzner_opencloud` |
| **Forgejo** | `forgejo.linux-nerds.org`, web UI only | stores the CI key as the secret `DEPLOY_SSH_KEY`; nothing to install there |

## 1. Check for rrsync — OpenCloud server

```sh
command -v rrsync
```

It ships with the `rsync` package from 3.2.3 on (Debian 12, Ubuntu 22.04 and
later). On older systems:

```sh
zcat /usr/share/doc/rsync/scripts/rrsync.gz > /usr/local/bin/rrsync
chmod 755 /usr/local/bin/rrsync
```

## 2. Create the user — OpenCloud server

```sh
useradd --system --create-home --shell /bin/sh deploy
usermod -p '*' deploy   # no password, but not "locked" — sshd refuses locked accounts without PAM
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
```

## 3. Install the scripts and the sudoers rule — OpenCloud server

Fetch the four files from this directory straight from Forgejo:

```sh
cd /root
for f in agenda-deploy agenda-restart agenda-proxy-install agenda-deploy.sudoers; do
  curl -fsSLO "https://forgejo.linux-nerds.org/frank/opencloud-agenda/raw/branch/main/deploy/server/$f"
done
```

Compare them with the copies on the **workstation** before installing:
`sha256sum deploy/server/agenda-deploy deploy/server/agenda-restart deploy/server/agenda-proxy-install deploy/server/agenda-deploy.sudoers`
there must print the same sums as `sha256sum agenda-deploy agenda-restart agenda-proxy-install agenda-deploy.sudoers`
on the server. (Alternatively copy them from the workstation with
`scp deploy/server/agenda-deploy deploy/server/agenda-restart deploy/server/agenda-proxy-install deploy/server/agenda-deploy.sudoers root@cloud.linux-nerds.org:/root/`.)

Then install:

```sh
install -m 755 -o root -g root agenda-deploy        /usr/local/bin/agenda-deploy
install -m 755 -o root -g root agenda-restart       /usr/local/sbin/agenda-restart
install -m 755 -o root -g root agenda-proxy-install /usr/local/sbin/agenda-proxy-install
install -m 440 -o root -g root agenda-deploy.sudoers /etc/sudoers.d/agenda-deploy
visudo -cf /etc/sudoers.d/agenda-deploy
rm agenda-deploy agenda-restart agenda-proxy-install agenda-deploy.sudoers
```

The scripts must stay owned by root and not be writable by `deploy`. If
`visudo -cf` reports an error, delete `/etc/sudoers.d/agenda-deploy` at once.

`agenda-proxy-install` expects the proxy's Compose project at
`/home/dockeruser/ics-proxy` (the `~/ics-proxy` from the README, as
`dockeruser`). If yours lives elsewhere, change `PROXY_DIR` at the top of the
script before installing — and keep the change when you update the script
later.

> **Already set up before `proxy-install` existed?** Only this step changes:
> re-run the four `curl` lines, the comparison and the `install` block.
> Everything else — user, keys, app directory — stays as it is. The next
> *Deploy Dev* run then updates the proxy as well.

## 4. Hand the app directory to the deploy user — OpenCloud server

```sh
APP_DIR=/mnt/HC_Volume_103940066/opencloud_keycloak_data/data/web/assets/apps/opencloud-agenda
mkdir -p "$APP_DIR"
chown -R deploy:deploy "$APP_DIR"
```

The files stay world-readable (rsync keeps the 644/755 modes from the build),
so the OpenCloud container reads them as before.

## 5. Keys

The OpenCloud server accepts a key for `deploy` only if its **public** half is
listed in `/home/deploy/.ssh/authorized_keys`, prefixed with the forced command.
There are up to two such keys:

| Key | Private half lives in | Needed for |
|---|---|---|
| `forgejo-ci-agenda` (new) | Forgejo secret `DEPLOY_SSH_KEY` | the *Deploy Dev* workflow |
| `hetzner_opencloud` (existing) | workstation | `deploy.sh` — skip it if you only deploy through Forgejo |

**Workstation** — create the CI key, a separate one so it can be revoked on its own:

```sh
ssh-keygen -t ed25519 -N '' -C forgejo-ci-agenda -f agenda-ci
```

**Forgejo** — *Repository → Settings → Actions → Secrets*: replace the value of
`DEPLOY_SSH_KEY` with the full content of `agenda-ci`, including the
`-----BEGIN/END OPENSSH PRIVATE KEY-----` lines. Then delete `agenda-ci` on the
workstation.

**Workstation** — print the finished `authorized_keys` lines:

```sh
echo "command=\"/usr/local/bin/agenda-deploy\",restrict $(cat agenda-ci.pub)"
# only if deploy.sh should keep working:
echo "command=\"/usr/local/bin/agenda-deploy\",restrict $(ssh-keygen -y -f ~/.ssh-jail/opencloud/hetzner_opencloud) frank"
```

Each prints one long line of the form
`command="/usr/local/bin/agenda-deploy",restrict ssh-ed25519 <key> <comment>`.

**OpenCloud server** — put those lines, unchanged, into the file:

```sh
nano /home/deploy/.ssh/authorized_keys   # paste the line(s), save
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
```

## 6. Test

**Forgejo** — run *Actions → Deploy Dev* once. It must upload and restart
without errors.

**Workstation** — only if you added the `hetzner_opencloud` line:

```sh
ssh -i ~/.ssh-jail/opencloud/hetzner_opencloud deploy@cloud.linux-nerds.org id
# → agenda-deploy: command not allowed: id

bash deploy.sh
# → builds, uploads, restarts, updates the proxy
#   (last line: "agenda-proxy-install: ics-proxy updated and answering")
```

If the proxy step fails with `restoring previous version`, the old proxy is
back in service; `docker compose logs ics-proxy` as `dockeruser` shows why the
new one did not start. A failure before that line — `docker: command not
found`, a missing `ics-proxy` directory — means `PROXY_DIR` in
`agenda-proxy-install` does not match your setup (see step 3).

Without that line, the `ssh` command fails with `Permission denied` — as
intended, since that key is not allowed to log in as `deploy`.

## 7. Remove the old root access — OpenCloud server

Only after the deploys worked: remove the **old CI key** from
`/root/.ssh/authorized_keys`. If the old `DEPLOY_SSH_KEY` was the same key you
use for root administration (`hetzner_opencloud`), leave root's file alone —
replacing the Forgejo secret in step 5 already took that key out of CI.
