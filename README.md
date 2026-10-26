# Ditado do Livro

Sistema de ditado por voz do livro jurídico. O plano completo, com fases, tarefas e jornadas E2E, está em [docs/plano-de-desenvolvimento.md](docs/plano-de-desenvolvimento.md).

## Estrutura

| Pasta | O que é |
| --- | --- |
| `apps/web` | Next.js 16: login, obras, editor do manuscrito, ditado, sumário, prévia, glossário, grafia, exportações, histórico, custos |
| `apps/session` | Servidor de sessão (WebSocket autenticado): áudio com confirmação e retomada, provedores de transcrição, motor de ditado, áudio por trecho; benchmark de provedores |
| `services/export` | Exportação Word: manuscrito → documento do Pandoc → .docx com o modelo ABNT (`template/`) |
| `packages/dictation` | Motor de ditado: comandos falados, regras de grafia e hesitações, manuscrito com ordem fracionária, desfazer/refazer |
| `packages/shared` | Tipos e esquemas (zod) do manuscrito, do protocolo do WebSocket e dos custos |
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

Abra http://localhost:3000 e entre com `autor-a@example.com` e a senha `E2E_PASSWORD` do `.env`. Em desenvolvimento a transcrição vem do simulador, que devolve o texto de um cenário gravado para qualquer áudio: `pnpm cenario` lista os cenários e `pnpm cenario capitulo-completo` escolhe um. Para ditar com a sua voz de verdade, ponha `STT_PROVIDER=deepgram` e `DEEPGRAM_API_KEY` no `.env` (ou AssemblyAI/ElevenLabs).

O manual de uso para o autor está em [docs/manual-do-autor.md](docs/manual-do-autor.md).

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

## Estado do plano

Fase 0 validada pelo cliente em 26/10/2026. O que depende de VPS, domínios e conta no Sentry está pronto e testado no CI, mas ainda não foi publicado.

### Fase 1: ditado no computador e exportação Word

| Grupo | Tarefas | Como foi verificado |
| --- | --- | --- |
| Captura e transcrição | F1.01–F1.03, F1.05–F1.10 | Unitários do motor e do servidor; os três provedores contra o simulador; E2E de reconexão, áudio por trecho, glossário, grafia com desfazer, hesitações e fidelidade |
| Benchmark (portão) | F1.04 | Ferramenta pronta e testada contra o simulador; **falta rodar com 30 min de áudio do autor e as chaves dos provedores** |
| Comandos de voz | F1.11–F1.15 | Parser com 44 casos; E2E de palavra e tecla (mesmo resultado), apagar/desfazer, falso positivo |
| Manuscrito e editor | F1.16–F1.21 | 1.000 inserções aleatórias (memória e banco); E2E de cursor de ditado, prévia contra imagem de referência, reordenar capítulo até o Word, fechar a aba, duas abas |
| Exportação Word | F1.22–F1.25 | Verificador de Word estilo a estilo; notas por capítulo/livro; 300 páginas em cerca de 3 s; Word automático ao fim da sessão |
| Transversais | T.02–T.07 | Limites de taxa; sigilo ([docs/sigilo.md](docs/sigilo.md)); painel de custos; sessão longa de 2 h; jornada só com teclado; [manual do autor](docs/manual-do-autor.md) |
| Jornadas | E2E-01, E2E-09, E2E-11 | Passam a cada PR; E2E-13 (noturno, provedor real) fica ativo quando houver o áudio e a chave |

Depende do cliente: rodar o benchmark (F1.04), aprovar a página de amostra do Word e da prévia (F1.18, F1.22) e fazer o piloto com um capítulo real (T.08). Roteiro em [docs/validacao-fase-1.md](docs/validacao-fase-1.md).
