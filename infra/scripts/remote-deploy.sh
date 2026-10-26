#!/usr/bin/env bash
# Roda NA VPS (chamado por deploy.sh): atualiza o clone do ambiente para a versão
# pedida, reconstrói as imagens e só termina quando os healthchecks passam.
set -euo pipefail

ENV="${1:?ambiente: staging ou production}"
REF="${2:?versão: commit, branch ou tag}"
BASE=/opt/livro
DIR="$BASE/$ENV"
case "$ENV" in staging|production) ;; *) echo "ambiente inválido: $ENV" >&2; exit 2 ;; esac

cd "$DIR/repo"
git fetch --force --tags origin
git checkout --force --detach "$REF"
git log -1 --format='versão: %h %s'

# Caddy compartilhado (idempotente)
PROXY_ENV_FILE="$BASE/proxy.env" docker compose -p livro-proxy -f infra/proxy/compose.yaml \
  --env-file "$BASE/proxy.env" up -d

docker compose -p "livro-$ENV" -f infra/app/compose.yaml --env-file "$DIR/app.env" \
  up -d --build --remove-orphans --wait --wait-timeout 180

docker image prune -f >/dev/null
echo "deploy de $ENV concluído"
