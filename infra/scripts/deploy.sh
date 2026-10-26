#!/usr/bin/env bash
# Deploy reproduzível (F0.02): infra/scripts/deploy.sh <staging|production> [versão]
# Precisa de DEPLOY_HOST=deploy@ip-da-vps e acesso SSH por chave.
set -euo pipefail

ENV="${1:?ambiente: staging ou production}"
REF="${2:-$(git rev-parse HEAD)}"
: "${DEPLOY_HOST:?defina DEPLOY_HOST=deploy@ip-da-vps}"

if [ "$ENV" = production ] && ! git describe --exact-match --tags "$REF" >/dev/null 2>&1; then
  echo "produção só sai por tag (ex.: v0.1.0); $REF não é uma tag" >&2
  exit 2
fi

ssh -o StrictHostKeyChecking=accept-new "$DEPLOY_HOST" bash -s -- "$ENV" "$REF" \
  < "$(dirname "$0")/remote-deploy.sh"
