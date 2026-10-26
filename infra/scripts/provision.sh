#!/usr/bin/env bash
# Prepara uma VPS Ubuntu 24.04 nova para staging e produção (F0.02). Rode uma vez, como root:
#   curl -fsSL https://raw.githubusercontent.com/raulmf12/livro-ditado/main/infra/scripts/provision.sh | \
#     bash -s -- "ssh-ed25519 AAAA... chave-de-deploy"
set -euo pipefail

DEPLOY_KEY="${1:?informe a chave pública SSH usada pelo deploy}"
REPO_URL="${REPO_URL:-https://github.com/raulmf12/livro-ditado.git}"
BASE=/opt/livro

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends docker.io docker-compose-v2 git ufw unattended-upgrades ca-certificates
systemctl enable --now docker

# usuário de deploy, sem senha, só com chave
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --groups docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
grep -qxF "$DEPLOY_KEY" /home/deploy/.ssh/authorized_keys 2>/dev/null || echo "$DEPLOY_KEY" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys

# SSH só por chave
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd

# firewall: SSH, HTTP e HTTPS (HTTP/3 em UDP)
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw --force enable

# diretórios por ambiente, cada um com o seu clone e o seu app.env
install -d -o deploy -g deploy "$BASE" "$BASE/backups"
for env in staging production; do
  install -d -o deploy -g deploy "$BASE/$env"
  [ -d "$BASE/$env/repo/.git" ] || sudo -u deploy git clone "$REPO_URL" "$BASE/$env/repo"
  if [ ! -f "$BASE/$env/app.env" ]; then
    sed -e "s/^APP_ENV=.*/APP_ENV=$env/" -e "s#^ENV_FILE=.*#ENV_FILE=$BASE/$env/app.env#" \
      "$BASE/$env/repo/infra/env/app.env.example" > "$BASE/$env/app.env"
    [ "$env" = production ] && sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=/' "$BASE/$env/app.env"
    chown deploy:deploy "$BASE/$env/app.env" && chmod 600 "$BASE/$env/app.env"
  fi
done
if [ ! -f "$BASE/proxy.env" ]; then
  cp "$BASE/staging/repo/infra/env/proxy.env.example" "$BASE/proxy.env"
  chown deploy:deploy "$BASE/proxy.env" && chmod 600 "$BASE/proxy.env"
fi

# backup diário da produção às 03:15 (F0.08)
CRON_LINE="15 3 * * * $BASE/production/repo/infra/scripts/backup.sh production >> $BASE/backups/backup.log 2>&1"
( crontab -u deploy -l 2>/dev/null | grep -vF 'infra/scripts/backup.sh production'; echo "$CRON_LINE" ) | crontab -u deploy -
for env in staging production; do
  if [ ! -f "$BASE/$env/backup.env" ]; then
    cp "$BASE/$env/repo/infra/env/backup.env.example" "$BASE/$env/backup.env"
    chown deploy:deploy "$BASE/$env/backup.env" && chmod 600 "$BASE/$env/backup.env"
  fi
done

echo
echo "Pronto. Falta preencher $BASE/proxy.env e $BASE/{staging,production}/{app,backup}.env;"
echo "depois o primeiro deploy: infra/scripts/deploy.sh staging main (da sua máquina ou do CI)."
