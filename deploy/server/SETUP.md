# Restricted deploy user

Deploys (the *Deploy Dev* workflow and `deploy.sh`) log in as `deploy`, not
`root`. The user's SSH keys are bound to a forced command,
[`agenda-deploy`](agenda-deploy), which accepts exactly two things:

- an rsync upload, confined by `rrsync -wo` to the app directory
  (no downloads, no paths outside it)
- `restart`, which runs [`agenda-restart`](agenda-restart) as `dockeruser`
  through a single sudoers rule

A leaked deploy key can therefore replace the app's files and restart
OpenCloud — but not open a shell, read data or touch anything else.

All commands below run as root on the server.

## 1. Check for rrsync

```sh
command -v rrsync
```

It ships with the `rsync` package from 3.2.3 on (Debian 12, Ubuntu 22.04 and
later). On older systems:

```sh
zcat /usr/share/doc/rsync/scripts/rrsync.gz > /usr/local/bin/rrsync
chmod 755 /usr/local/bin/rrsync
```

## 2. Create the user

```sh
useradd --system --create-home --shell /bin/sh deploy
usermod -p '*' deploy   # no password, but not "locked" — sshd refuses locked accounts without PAM
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
```

## 3. Install the scripts and the sudoers rule

Copy the three files from this directory to the server — from your machine,
in the repository root, with the root access you still have:

```sh
scp -i ~/.ssh-jail/opencloud/hetzner_opencloud \
  deploy/server/agenda-deploy deploy/server/agenda-restart deploy/server/agenda-deploy.sudoers \
  root@cloud.linux-nerds.org:/root/
```

Then on the server, in `/root`:

```sh
cd /root
install -m 755 -o root -g root agenda-deploy  /usr/local/bin/agenda-deploy
install -m 755 -o root -g root agenda-restart /usr/local/sbin/agenda-restart
install -m 440 -o root -g root agenda-deploy.sudoers /etc/sudoers.d/agenda-deploy
visudo -cf /etc/sudoers.d/agenda-deploy
rm agenda-deploy agenda-restart agenda-deploy.sudoers
```

The scripts must stay owned by root and not be writable by `deploy`.

## 4. Hand the app directory to the deploy user

```sh
APP_DIR=/mnt/HC_Volume_103940066/opencloud_keycloak_data/data/web/assets/apps/opencloud-agenda
mkdir -p "$APP_DIR"
chown -R deploy:deploy "$APP_DIR"
```

The files stay world-readable (rsync keeps the 644/755 modes from the build),
so the OpenCloud container reads them as before.

## 5. Keys

Use a **separate key for CI** so it can be revoked on its own. Generate it on
your machine:

```sh
ssh-keygen -t ed25519 -N '' -C forgejo-ci-agenda -f agenda-ci
```

- Private key (`agenda-ci`) → Forgejo: *Repository → Settings → Actions →
  Secrets*, replace `DEPLOY_SSH_KEY`. Then delete the local file.
- Public key → `/home/deploy/.ssh/authorized_keys` on the server, as below.

For `deploy.sh`, add the public half of your local key
(`hetzner_opencloud.pub`) the same way. Every line gets the forced command and
`restrict`:

```text
command="/usr/local/bin/agenda-deploy",restrict ssh-ed25519 AAAA… forgejo-ci-agenda
command="/usr/local/bin/agenda-deploy",restrict ssh-ed25519 AAAA… frank
```

```sh
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
```

## 6. Test

From your machine:

```sh
ssh -i ~/.ssh-jail/opencloud/hetzner_opencloud deploy@cloud.linux-nerds.org id
# → agenda-deploy: command not allowed: id

ssh -i ~/.ssh-jail/opencloud/hetzner_opencloud deploy@cloud.linux-nerds.org restart
# → restarts opencloud and traefik
```

Then run `bash deploy.sh` once, and the *Deploy Dev* workflow once.

## 7. Remove the old root access

Only after both deploys worked: remove the **old CI key** from
`/root/.ssh/authorized_keys`. If the old `DEPLOY_SSH_KEY` was the same key you
use for root administration, leave root's file alone — replacing the Forgejo
secret in step 5 already took that key out of CI.
