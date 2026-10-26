# Runbook de operação

Como subir, publicar, recuperar e manter o sistema. Para desenvolvimento local, veja o [README](../README.md).

## Visão geral

```
navegador ──HTTPS──▶ Caddy (TLS automático, uma instância por VPS)
                       ├─ staging.<domínio>   ─▶ pilha livro-staging
                       └─ <domínio>           ─▶ pilha livro-production
pilha: web (Next.js :3000) · session (WebSocket :4001, rota /ws) · export (Pandoc :4030, interno)
       + simuladores (só staging, enquanto não houver provedor real de STT)
dados: Supabase (Postgres + Auth + Storage), um projeto por ambiente
```

Arquivos de configuração que só existem na VPS, todos com `chmod 600`:

| Arquivo | Conteúdo | Modelo |
| --- | --- | --- |
| `/opt/livro/proxy.env` | Domínios e e-mail do Let's Encrypt | `infra/env/proxy.env.example` |
| `/opt/livro/<ambiente>/app.env` | Supabase, URLs públicas, Sentry, provedor de STT | `infra/env/app.env.example` |
| `/opt/livro/<ambiente>/backup.env` | Conexão Postgres e chave secreta para o backup | `infra/env/backup.env.example` |

## Primeira instalação da VPS

1. Crie uma VPS Ubuntu 24.04 com pelo menos 2 vCPU e 4 GB de RAM, e aponte os domínios (registro A) para o IP dela.
2. Gere uma chave só para o deploy: `ssh-keygen -t ed25519 -f deploy_livro -C deploy-livro`.
3. Como root na VPS, rode `infra/scripts/provision.sh`. Ele instala Docker e firewall, cria o usuário `deploy` com acesso só por chave, os diretórios e o cron do backup:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/raulmf12/livro-ditado/main/infra/scripts/provision.sh | bash -s -- "$(cat deploy_livro.pub)"
   ```
4. Preencha os três `.env` da tabela acima.
5. No GitHub, em *Settings → Environments*, crie `staging` e `production` com:
   - segredos: `DEPLOY_HOST` (`deploy@<ip>`), `DEPLOY_SSH_KEY` (a chave privada `deploy_livro`), `ENV_SUPABASE_URL`, `ENV_SUPABASE_PUBLISHABLE_KEY`, `ENV_SUPABASE_SECRET_KEY` e `ENV_E2E_PASSWORD`;
   - variável: `STAGING_URL` ou `PRODUCTION_URL` (por exemplo, `https://staging.<domínio>`).
6. Faça o primeiro deploy: `DEPLOY_HOST=deploy@<ip> infra/scripts/deploy.sh staging main`.

## Deploy

- **Staging:** automático a cada merge na `main`, depois do CI verde (workflow *Deploy*). Em seguida o E2E roda contra o ambiente publicado.
- **Produção:** só por tag. Crie com `git tag v0.1.0 && git push origin v0.1.0`; depois do deploy roda só o smoke, sem usuários de teste.
- **Manual:** `DEPLOY_HOST=deploy@<ip> infra/scripts/deploy.sh <staging|production> <commit|tag>`. O comando só termina quando todos os healthchecks passam.
- **Voltar uma versão:** rode o mesmo comando com o commit ou a tag anterior.

## Migrações do banco

Toda migração tem a reversão correspondente em `supabase/rollbacks/`.

```bash
supabase link --project-ref <ref-do-ambiente>
supabase db push --linked                 # aplicar
pnpm db:rollback --yes                    # reverter a última (esvazia o bucket de áudio!)
```

Aplique primeiro em staging, rode o E2E e só depois aplique em produção.

## Backup e restauração (F0.08)

- **O que entra:** todos os dados de `public` e de `auth` (usuários e identidades; sessões e tokens ficam de fora), além de todos os áudios do bucket `audio`.
- **Como o áudio é guardado:** cada conteúdo vira um arquivo imutável em `storage/blobs/<sha256>`. Se um áudio for sobrescrito no Storage, a versão anterior continua no backup e qualquer snapshot antigo continua restaurável.
- **Quando:** todo dia às 03:15, pelo cron do usuário `deploy`, em `/opt/livro/backups/production`. Os dumps são mantidos por `RETENTION_DAYS` dias (padrão 30) e os áudios para sempre.
- **Fora da VPS:** copie `/opt/livro/backups` para outro lugar (por exemplo, `rclone sync` para um bucket S3 ou B2). Um backup que só existe na própria VPS não protege contra a perda dela.
- **Restaurar** num projeto Supabase novo:
  1. Aplique as migrações: `supabase db push --db-url "<url-do-destino>"`.
  2. Rode a restauração apontando para o destino. Ela recusa um destino que já tenha dados e confere tudo no final:
     ```bash
     docker run --rm --network host -v /opt/livro/backups/production:/backups \
       -e DB_URL="<url-do-destino>" -e SUPABASE_URL=<url> -e SUPABASE_SECRET_KEY=<chave> \
       livro-ops:production restore            # ou: restore --snapshot <nome>
     ```
- **Teste automático:** o job *Backup e restauração* do workflow *Infra* faz backup, zera o banco, restaura e confere login, obra e áudio a cada PR e toda segunda-feira.

## Provedor de transcrição (F1.03, F1.04)

O servidor de sessão fala com Deepgram, AssemblyAI ou ElevenLabs pela mesma interface. Para trocar de provedor, mude `STT_PROVIDER` e a chave correspondente no `app.env` e faça um novo deploy. Os parâmetros de cada um estão comentados em `infra/env/app.env.example`, e o sigilo de cada um em [sigilo.md](sigilo.md).

**Benchmark (portão da fase 1).** Ele escolhe o provedor com o áudio real do autor:

1. Grave uns 30 minutos do autor ditando como ele dita o livro. Divida em arquivos de 2 a 5 minutos e converta para WAV 16 kHz mono: `ffmpeg -i entrada.m4a -ac 1 -ar 16000 -sample_fmt s16 trecho-01.wav`.
2. Para cada `trecho-NN.wav`, escreva `trecho-NN.txt` com a transcrição revisada (o que o autor falou, com os números como devem sair no livro).
3. Opcionalmente, crie `termos.txt` com um termo jurídico por linha (usucapião, enfiteuse, REsp…).
4. Com as três chaves no `.env`, rode `pnpm benchmark <pasta> --out benchmark-stt.md`. O relatório traz, para cada provedor:
   - erro geral (WER);
   - acerto nos termos jurídicos;
   - latência;
   - reconexões;
   - custo estimado;
   - a recomendação final.
5. Em vez de rodar localmente, também dá para enviar a pasta ao bucket privado `benchmark`, no caminho `amostras/`, e rodar o workflow **Noturno** à mão com "benchmark" marcado.

O áudio do autor não vai para o repositório: fica só na sua máquina ou no bucket privado.

**Teste noturno (E2E-13).** Depois de escolhido o provedor:

1. Envie ao bucket `benchmark`, em `noturno/`, um áudio longo do autor (perto de 2 h) com a transcrição revisada (mesmo formato acima).
2. No GitHub, crie os segredos `NIGHTLY_STT_PROVIDER` (por exemplo, `deepgram`) e a chave do provedor (`DEEPGRAM_API_KEY` etc.).
3. Opcionalmente, crie a variável `NIGHTLY_MAX_WER` (padrão 0.08, o limite aceito no benchmark).

Toda noite o workflow transcreve o áudio no ritmo real e falha se houver queda, se a latência p95 passar de 1,5 s ou se o erro passar do limite. O mesmo workflow roda a sessão longa de 2 h contra o simulador, para pegar vazamento de memória (T.05).

## Rotação de chaves (T.01)

Nenhuma chave fica no código do navegador; o E2E `chaves.spec.ts` confere isso a cada PR. Para trocar uma chave:

| Chave | Onde gerar | Onde trocar |
| --- | --- | --- |
| Supabase secreta (`sb_secret_…`) | Painel → Project Settings → API Keys → criar nova, depois revogar a antiga | `app.env` não usa; `backup.env`, segredos do GitHub (`SUPABASE_SECRET_KEY`, `ENV_SUPABASE_SECRET_KEY`) e o `.env` local |
| Supabase publicável | Mesmo lugar | `app.env` (exige novo deploy: o valor entra no build) e segredos do GitHub |
| Senha do Postgres | Painel → Database → Reset password | `backup.env` |
| Chave SSH de deploy | `ssh-keygen` | `authorized_keys` do usuário `deploy` e segredo `DEPLOY_SSH_KEY` |
| Provedor de STT (`DEEPGRAM_API_KEY`, `ASSEMBLYAI_API_KEY`, `ELEVENLABS_API_KEY`) | Painel de cada provedor | `app.env`; e, para o teste noturno, o segredo de mesmo nome no GitHub |
| Claude (fase 2) | Console da Anthropic | `app.env` |

Depois de trocar, faça um deploy, confira o E2E e só então revogue a chave antiga.

## Observabilidade (F0.06)

- **Sentry:** defina `SENTRY_DSN` (servidor) e `NEXT_PUBLIC_SENTRY_DSN` (navegador) no `app.env`. Cada erro do servidor de sessão chega com as tags `sessionId`, `userId`, `bookId` e `provider`. O SDK está configurado para não coletar corpo de requisição, cabeçalhos, cookies nem variáveis: nenhum texto do livro vai para o Sentry.
- **Logs:** em JSON, uma linha por evento: `docker compose -p livro-production -f infra/app/compose.yaml --env-file /opt/livro/production/app.env logs -f session`.
- **Latência fala → tela:** gravada por sessão em `dictation_sessions` (`latency_p50_ms`, `latency_p95_ms`, `latency_samples`). O alvo é p95 abaixo de 1,5 s (T.05):
  ```sql
  select date_trunc('day', started_at) dia, percentile_cont(0.95) within group (order by latency_p95_ms) p95
  from dictation_sessions where latency_samples > 0 group by 1 order by 1 desc;
  ```

## Incidentes comuns

| Sintoma | O que olhar |
| --- | --- |
| "A transcrição está fora do ar" na tela | Log do `session` (`erro do provedor de transcrição`) e o evento no Sentry com o `sessionId`; status do provedor |
| "A conexão com o servidor caiu" | `docker compose ps` (healthchecks), log do Caddy, `ALLOWED_ORIGINS` igual ao domínio |
| Login volta sempre para a tela de login | Relógio da VPS, chave publicável e URL do Supabase no `app.env` (exigem novo deploy) |
| Certificado não emitido | DNS apontando para a VPS, portas 80 e 443 abertas, log do Caddy |
