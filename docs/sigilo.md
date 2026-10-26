# Sigilo do livro (T.03)

O manuscrito é sigiloso até a publicação. Este documento registra para onde vai cada dado e como isso é verificado.

## Para onde vai cada dado

| Dado | Onde fica | Quem acessa |
| --- | --- | --- |
| Texto do manuscrito, histórico, glossário, regras | Postgres do Supabase (criptografado em repouso pelo provedor) | Só o autor dono da obra (RLS em todas as tabelas; testado em `tests/kit/integration`) |
| Áudio de cada trecho | Bucket privado `audio` do Supabase Storage | Só o autor dono da obra (políticas por pasta da obra) |
| Arquivos Word gerados | Bucket privado `exports` | Só o autor dono da obra |
| Áudio do autor para benchmark e teste noturno | Bucket privado `benchmark`, sem nenhuma política | Só a chave secreta (CI noturno e operação) |
| Áudio em trânsito para transcrição | Provedor de STT escolhido (F1.04) | Veja a tabela abaixo |
| Erros do sistema | Sentry, se configurado | Só a mensagem do erro, o ID da sessão e o tipo de provedor: corpo de requisição, cabeçalhos, cookies e variáveis estão desligados (`packages/shared/src/privacy.ts`) |

O repositório é público e não contém dado nenhum do livro, áudio do autor nem chave. O E2E `chaves.spec.ts` varre o JavaScript servido em busca de chaves, e o histórico do git foi conferido antes de abrir o repositório.

## Provedores de transcrição

O áudio vai para o provedor por uma conexão criptografada, saindo do servidor de sessão. As chaves ficam só no servidor, em cabeçalho, nunca na URL nem no navegador.

| Provedor | O que a conexão pede | O que ainda depende de contrato |
| --- | --- | --- |
| Deepgram | `mip_opt_out=true`: o áudio não entra no programa de melhoria de modelo | Política de retenção da conta |
| ElevenLabs | `enable_logging=false`: retenção zero | Só funciona no plano enterprise; sem ele, a conexão é recusada (`ELEVENLABS_ZERO_RETENTION=false` libera, mas não deve ser usado em produção) |
| AssemblyAI | Nenhuma opção de retenção na conexão foi encontrada na documentação da API de streaming | Retenção zero precisa ser contratada na conta |

O teste `apps/session/src/stt/providers.test.ts` roda no CI e confere que as opções de retenção estão na URL de cada provedor e que a chave vai em cabeçalho.

## Claude (fase 2)

A pesquisa usa a API comercial da Anthropic, chamada só pelo servidor. Antes de ligar em produção, confira os termos comerciais vigentes sobre uso e retenção de dados da API.

## Pendências fora do sistema

- Termo de confidencialidade com o cliente (documento jurídico).
- Contrato com o provedor de STT escolhido, incluindo retenção zero onde a API não oferece a opção.
- Proteção contra senhas vazadas no Supabase: exige o plano Pro.
