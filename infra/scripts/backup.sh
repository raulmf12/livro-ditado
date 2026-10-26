#!/usr/bin/env bash
# Backup diário de um ambiente (F0.08), rodado na VPS pelo cron do usuário deploy:
#   15 3 * * * /opt/livro/production/repo/infra/scripts/backup.sh production >> /opt/livro/backups/backup.log 2>&1
# Precisa de /opt/livro/<ambiente>/backup.env com DB_URL, SUPABASE_URL e SUPABASE_SECRET_KEY.
set -euo pipefail

ENV="${1:?ambiente: staging ou production}"
BASE=/opt/livro
DIR="$BASE/$ENV"
OUT="$BASE/backups/$ENV"
install -d -m 700 "$OUT"

docker build -q --target ops -t "livro-ops:$ENV" "$DIR/repo" >/dev/null
docker run --rm --network host --env-file "$DIR/backup.env" -e BACKUP_DIR=/backups \
  -v "$OUT:/backups" --user "$(id -u):$(id -g)" "livro-ops:$ENV" backup
