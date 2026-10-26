# Ditado do Livro

Sistema de ditado por voz do livro jurídico. O plano completo, com fases, tarefas e jornadas E2E, está em [docs/plano-de-desenvolvimento.md](docs/plano-de-desenvolvimento.md).

## Estrutura

| Pasta | O que é |
| --- | --- |
| `apps/web` | Next.js 16: login, obras e tela de ditado |
| `apps/session` | Servidor de sessão (WebSocket autenticado) que repassa o áudio ao provedor de transcrição |
| `services/export` | Serviço de exportação Word com Pandoc (esqueleto; conversão em F1.22–F1.25) |
| `packages/shared` | Tipos e esquemas (zod) do manuscrito e do protocolo do WebSocket |
| `packages/eslint-config` | Regras de lint comuns |
| `tests/kit` | Base de testes: simulador de STT, simulador do Claude, cenários com áudio, verificador de Word, banco semente |
| `tests/e2e` | Jornadas E2E (Playwright) |
| `tools/ops` | Backup e restauração (pg_dump + espelho versionado do áudio) |
| `infra` | Dockerfile, Compose por ambiente, Caddy e scripts da VPS |
| `supabase/migrations` | Migrações do banco; a reversão de cada uma fica em `supabase/rollbacks` |

Operação (deploy, backup, rotação de chaves, incidentes): [docs/runbook.md](docs/runbook.md). Roteiro de validação da fase 0: [docs/validacao-fase-0.md](docs/validacao-fase-0.md).

## Primeiros passos

Pré-requisitos: Node 22 ou mais novo, pnpm, [uv](https://docs.astral.sh/uv/) (Python do verificador de Word) e o CLI do Supabase, já logado e vinculado ao projeto (`supabase link`).

```bash
pnpm install
cp .env.example .env              # e preencha as chaves do Supabase
pnpm --filter @livro/test-kit setup:py
pnpm --filter @livro/e2e install:browsers
pnpm seed                         # autores de teste e obras semente
pnpm dev                          # web :3000, sessão :4001, simuladores :4010/:4020/:4040, exportação :4030
```

Abra http://localhost:3000 e entre com `autor-a@example.com` e a senha `E2E_PASSWORD` do `.env`. Em desenvolvimento a transcrição vem do simulador, que devolve o texto do cenário `ditado-simples` para qualquer áudio.

Não há cadastro público (desligado também no Supabase). Para criar a conta do autor, use `pnpm user:create email@dominio`; para um admin, acrescente `--admin`.

## Testes

| Comando | Camada | Contra o quê |
| --- | --- | --- |
| `pnpm test` | Unitário (Vitest e pytest) | Nada externo |
| `pnpm test:integration` | RLS, Storage e regras do banco | Supabase do `.env` |
| `pnpm test:e2e` | Jornadas no navegador | Sobe simuladores, sessão e web (build de produção) |

O microfone falso usa o `.wav` de cada cenário (`tests/kit/fixtures/audio`). No Linux/CI isso passa pelas flags do Chromium (`--use-file-for-fake-audio-capture`). No macOS o Chromium trava a captura de áudio por causa da permissão de microfone do sistema, então o teste injeta o mesmo arquivo no `getUserMedia`. Para forçar um dos modos, use `E2E_FAKE_MIC=flags` ou `E2E_FAKE_MIC=script`.

Para refazer os áudios sintéticos depois de mudar a fala de um cenário, rode `pnpm audio:gerar --force` (usa a voz Luciana do macOS).

## Banco

- Aplicar migrações: `pnpm db:push`
- Reverter a última: `pnpm db:rollback --yes` (esvazia o bucket de áudio, roda o `.down.sql` e marca a migração como revertida)

Toda tabela tem RLS: cada autor só enxerga as próprias obras e tudo o que pende delas. O servidor de sessão acessa o banco com o token do usuário, nunca com a chave secreta. A chave secreta só é usada pelos scripts de teste e de administração.

## Estado da fase 0

Tudo o que não depende de servidor próprio está pronto e testado no CI. Falta só demonstrar em staging de verdade, que depende de VPS e domínios.

| ID | Status | Como foi verificado |
| --- | --- | --- |
| F0.01 Monorepo | Pronto | `pnpm dev` sobe tudo; smoke E2E |
| F0.02 Infra e ambientes | Pronto, aguardando VPS | Imagens, Compose e Caddy sobem no CI como na VPS, e o E2E passa contra essa pilha; scripts de provisionamento e deploy |
| F0.03 CI/CD | Pronto, deploy aguardando VPS | CI completo em todo PR; deploy de staging após CI verde e de produção por tag (inativo até existirem os segredos da VPS) |
| F0.04 Esquema e RLS | Pronto | Migrações sobem, revertem e sobem; 12 testes de integração de RLS |
| F0.05 Autenticação | Pronto | Login, logout, proxy e WebSocket com token; papéis `autor`/`admin`; cadastro público desligado |
| F0.06 Observabilidade | Pronto, aguardando DSN | Erro com ID da sessão chega ao Sentry (simulado no E2E); latência p50/p95 por sessão; aviso amigável |
| F0.07 Base de testes | Pronto | Exemplo E2E com microfone falso, simuladores de STT, Claude e Sentry, verificador de Word e banco semente |
| F0.08 Backup | Pronto, aguardando VPS | No CI: backup, banco zerado, restauração; login, obra e áudio voltam |
| T.01 Chaves só no servidor | Pronto | E2E varre o JS servido; rotação no runbook |
| E2E-12 Segurança | Pronto | No CI local e contra a pilha com Caddy |
