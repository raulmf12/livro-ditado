# Plano de desenvolvimento — sistema de ditado do livro jurídico

Oct 25, 2026 · @Raul

O sistema é construído em 5 fases (67 tarefas) mais 8 tarefas transversais, da fundação à biblioteca do autor. Cada tarefa tem critério de aceite e um teste E2E automatizado, e cada fase só fecha quando a jornada completa dela passa em staging.

## Mapa das fases

&#91;embedded content: roadmap · 5 fases, 6 portões, frentes transversais\]

O piloto no fim da fase 1 é o principal ponto de decisão: se o autor aprovar o capítulo ditado, o resto do plano segue; se não, ajusta-se transcrição e comandos antes de investir em pesquisa.

## Estratégia de testes

Todo teste E2E roda sem microfone de verdade e sem depender do humor de uma API externa: o áudio entra por arquivo e a transcrição vem de um simulador que reproduz respostas gravadas. A API real de transcrição só roda no teste noturno.

**Camadas**

| Camada | Ferramenta | O que cobre | Quando roda |
| --- | --- | --- | --- |
| Unitário | Vitest (TS) e pytest (ingestão) | Parser de comandos, regras de grafia, segmentação de leis, checagem de literalidade, montagem de referências | A cada commit |
| Integração | Vitest + Supabase local (CLI) | Servidor de sessão, banco, RLS, serviço de exportação, busca | A cada pull request |
| E2E | Playwright (Chromium, WebKit, emulação de celular) | Jornadas na tela, do login ao Word baixado | A cada pull request, com transcrição simulada |
| E2E noturno | Playwright + provedor real | Ditado com áudio gravado do autor, latência e precisão | Toda noite em staging |

**Peças da base de testes** (construídas na fase 0, tarefa F0.07)

- **Microfone falso:** o Chromium roda com `--use-fake-device-for-media-stream` e `--use-file-for-fake-audio-capture=<arquivo.wav>`. Cada cenário tem seu áudio: ditado simples, comandos de estrutura, pesquisa, frase com "comando normativo".
- **Simulador de transcrição (mock STT):** servidor WebSocket que imita o provedor e devolve, para cada áudio, a sequência gravada de resultados provisórios e finais. Torna o E2E determinístico.
- **Simulador do Claude:** respostas fixas por cenário, incluindo uma resposta "maliciosa" com trecho alterado, para provar que a checagem de literalidade bloqueia.
- **Verificador de Word:** helper que abre o .docx exportado (python-docx), confere estilos por parágrafo, notas de rodapé, citações com recuo, marcação "Inserido IA" e lista de referências.
- **Banco semente:** CF, Código Civil, Estatuto da Terra, 20 súmulas e 200 acórdãos, carregados no Supabase local para os testes de busca.

**Ambientes:** local (Supabase CLI + Docker), staging (VPS, dados reais de bases públicas, provedor real) e produção. Merge na branch principal publica em staging; produção sai por tag.

## Fase 0 — Fundação

A fase 0 entrega o esqueleto que tudo usa: repositório, deploy, banco com RLS, login e a base de testes com microfone e transcrição simulados. Portão de saída: o pipeline roda um E2E de exemplo em staging e a jornada E2E-12 (segurança) passa.

| ID | Tarefa | Critério de aceite | Teste E2E | Depende de | Status |
| --- | --- | --- | --- | --- | --- |
| F0.01 | Monorepo (pnpm + Turborepo): `apps/web` (Next.js), `apps/session` (Node WebSocket), `services/export` (Pandoc), `packages/shared` (tipos e esquemas) | Um comando sobe tudo localmente; tipos compartilhados compilam | Smoke: a tela de login abre | — | Concluído |
| F0.02 | Infra e ambientes: VPS com Docker Compose, Caddy com TLS, domínios de staging e produção, segredos fora do repositório | Deploy de staging reproduzível por script | Smoke roda contra a URL de staging | F0.01 | Concluído no CI (publicação aguarda VPS) |
| F0.03 | CI/CD no GitHub Actions: lint, typecheck, unitário, integração, E2E com simuladores; staging no merge, produção por tag | PR bloqueado se qualquer etapa falhar | O pipeline executa a suíte E2E completa | F0.01, F0.07 | Concluído (deploy aguarda VPS) |
| F0.04 | Esquema do banco (migrações Supabase): `books`, `blocks` (árvore com ordem fracionária, origem autor ou IA, status), `dictation_sessions`, `audio_segments`, `transcript_events`, `commands`, `references` (CSL-JSON), `glossary_terms`, `spelling_rules`, `search_logs`; políticas RLS | Migração sobe do zero e reverte; RLS bloqueia acesso cruzado | Usuário B logado não enxerga a obra do usuário A | F0.01 | Concluído |
| F0.05 | Autenticação: Supabase Auth com e-mail e senha; papéis autor e admin; token validado no WebSocket | Rotas e WebSocket recusam quem não tem sessão | Login, logout; abrir `/obra` sem sessão redireciona ao login | F0.04 | Concluído |
| F0.06 | Observabilidade: Sentry no front e no servidor, logs estruturados, métrica de latência fala → texto na tela | Erro forçado aparece no Sentry com o ID da sessão | Falha simulada do STT mostra aviso amigável na tela | F0.02 | Concluído (Sentry real aguarda DSN) |
| F0.07 | Base de testes: Playwright, microfone falso, simulador de STT, simulador do Claude, verificador de Word, banco semente | Um cenário de exemplo usa todas as peças | O cenário de exemplo passa no CI | F0.01, F0.04 | Concluído |
| F0.08 | Backup: Postgres diário, versionamento do Storage de áudio, restauração testada | Restauração em staging recupera obra e áudio | Após restaurar, abrir a obra e tocar o áudio de um trecho | F0.02, F0.04 | Concluído no CI (produção aguarda VPS) |

## Fase 1 — Ditado no computador e exportação Word

Ao fim da fase 1, o autor dita um capítulo no computador, com estrutura e notas, e baixa um Word diagramado. Dois portões: o benchmark de transcrição (F1.04) escolhe o provedor antes de seguir, e o piloto (jornadas E2E-01, E2E-09 e E2E-13 + aprovação do autor num capítulo real, tarefa T.08) fecha a fase.

**1A — Captura e transcrição**

| ID | Tarefa | Critério de aceite | Teste E2E | Depende de | Status |
| --- | --- | --- | --- | --- | --- |
| F1.01 | Captura de microfone: getUserMedia, AudioWorklet convertendo para PCM 16 kHz, medidor de nível, escolha do microfone | Áudio chega ao servidor em pedaços de 100 ms | Com microfone falso, o medidor reage e o botão alterna Gravar/Pausar | F0.05 | Em validação |
| F1.02 | Servidor de sessão: WebSocket autenticado, repasse ao provedor, buffer de reenvio, reconexão automática | Queda de 5 s não perde áudio | Rede derrubada no meio do ditado: aviso "reconectando" e texto completo após voltar | F1.01 | Em validação |
| F1.03 | Adaptador de STT: interface única com Deepgram, AssemblyAI e ElevenLabs, escolha por configuração | Trocar de provedor não muda código fora do adaptador | Mesmo cenário passa com o simulador imitando os três formatos | F1.02 | Em validação |
| F1.04 | Benchmark (portão): script roda os três provedores com 30 min de áudio do autor e mede erros gerais e em termos jurídicos | Relatório entregue e provedor escolhido | Vira o cenário noturno com o provedor escolhido | F1.03 | Ferramenta pronta (aguarda áudio do autor e chaves) |
| F1.05 | Áudio bruto no Storage, por segmento, ligado aos blocos de texto | Cada parágrafo aponta para o áudio de origem | "Ouvir trecho" num parágrafo toca o áudio certo | F1.02, F0.04 | Em validação |
| F1.06 | Provisório e final: texto provisório em cinza, só o final é gravado | Recarregar mantém só o texto final | Simulador envia provisórios e finais; após recarregar, só os finais estão no manuscrito | F1.02 | Em validação |
| F1.07 | Glossário por livro e por capítulo, enviado ao provedor ao abrir a sessão | Termos do capítulo ativo vão na requisição | Cadastrar "usucapião" e iniciar sessão: o simulador registra o termo recebido | F1.03 | Em validação |
| F1.08 | Dicionário de grafia: regras aprovadas pelo autor, aplicadas no texto final, com log e desfazer | Toda troca registrada com antes e depois | Ditar "rex": aparece "REsp"; o log mostra a troca; desfazer restaura | F1.06 | Em validação |
| F1.09 | Remoção opcional de hesitações ("é…", "hã" isolados) | Desligada por padrão; nada fora da lista é removido | Mesmo áudio com a opção ligada e desligada gera os dois textos esperados | F1.06 | Em validação |
| F1.10 | Guarda de fidelidade: texto gravado = finais do STT + regras aprovadas | Diff zero em todos os cenários | Compara o manuscrito com a transcrição de referência e falha em qualquer diferença | F1.08 | Em validação |

**1B — Comandos de voz**

| ID | Tarefa | Critério de aceite | Teste E2E | Depende de | Status |
| --- | --- | --- | --- | --- | --- |
| F1.11 | Ativação: palavra configurável (padrão "Atena"), tecla segurada e pedal USB (que envia uma tecla) | Os três modos marcam o trecho como comando | Comando dito com a palavra e depois segurando a tecla: ambos executam igual | F1.06 | Em validação |
| F1.12 | Parser de estrutura: capítulo (número e título), seção, subseção, abre/fecha citação, nota/fim da nota, novo parágrafo | Gramática coberta por testes unitários com variações de fala | "Capítulo três, Da posse agrária" cria o título no nível certo | F1.11 | Em validação |
| F1.13 | Comandos de edição: apaga a última frase, desfaz, refaz | Desfazer reverte também comandos de estrutura | Ditar, "apaga a última frase", "desfaz": texto volta ao estado anterior | F1.12 | Em validação |
| F1.14 | Fim de comando ("fim" ou pausa de 2 s) e faixa de confirmação na tela | Nenhuma palavra do comando entra no texto | Após o cenário, o texto do comando não aparece no manuscrito nem no Word | F1.11 | Em validação |
| F1.15 | Proteção contra falso positivo: palavra só vale no início de segmento e fora de citação | Frases comuns do domínio não disparam nada | Áudio com "o comando normativo do artigo" e "Atena" no meio da frase não gera comando | F1.11 | Em validação |

**1C — Manuscrito e editor**

| ID | Tarefa | Critério de aceite | Teste E2E | Depende de | Status |
| --- | --- | --- | --- | --- | --- |
| F1.16 | Modelo do manuscrito: blocos tipados (capítulo, seção, subseção, parágrafo, citação, nota), ordem fracionária, API de inserção e movimentação | Inserir no meio não renumera o livro | Integração: 1.000 blocos inseridos em posições aleatórias mantêm a ordem | F0.04 | Em validação |
| F1.17 | Editor TipTap com o esquema do livro; cursor de ditado separado do de digitação | Ditado entra na posição do cursor de ditado | Mover o cursor para o meio do capítulo e ditar: o texto entra ali | F1.16 | Em validação |
| F1.18 | Prévia diagramada: CSS espelhando o modelo Word (página, fontes, recuos) | Autor aprova a prévia de uma página de amostra | Captura de tela da prévia comparada com a referência aprovada | F1.17, F1.22 | Em validação (aprovação do autor) |
| F1.19 | Sumário lateral: navegação e reordenação de capítulos por arrastar | Reordenar move o capítulo com todo o conteúdo | Arrastar o capítulo 3 para antes do 2 e conferir a ordem no Word | F1.17 | Em validação |
| F1.20 | Salvamento contínuo e histórico de versões | Nada se perde ao fechar a aba | Fechar a aba no meio do ditado, reabrir e encontrar tudo até o último final | F1.16 | Em validação |
| F1.21 | Sincronização ao vivo (Supabase Realtime) entre abas e aparelhos | Atraso abaixo de 2 s | Duas abas: o ditado na primeira aparece na segunda | F1.16 | Em validação |

**1D — Exportação Word**

| ID | Tarefa | Critério de aceite | Teste E2E | Depende de | Status |
| --- | --- | --- | --- | --- | --- |
| F1.22 | Modelo .docx próprio: títulos 1 a 3, corpo, citação longa (recuo 4 cm, fonte menor, espaço simples), nota de rodapé, página e margens | Autor aprova a página de amostra | Verificador confere cada estilo no arquivo de amostra | — | Em validação (aprovação do autor) |
| F1.23 | Serviço de exportação: manuscrito → Markdown do Pandoc → .docx com o modelo | Cada tipo de bloco sai com o estilo certo | Exportar o capítulo do cenário e conferir estilos parágrafo a parágrafo | F1.16, F1.22 | Em validação |
| F1.24 | Notas de rodapé ditadas pelo autor | Numeração contínua por capítulo ou livro, configurável | Duas notas ditadas viram notas reais do Word, na ordem | F1.23 | Em validação |
| F1.25 | Opções: capítulo ou livro, download e exportação automática ao fim da sessão | Livro de 300 páginas exportado em menos de 30 s | Encerrar a sessão gera o arquivo na lista de exportações | F1.23 | Em validação |

## Fase 2 — Leis, súmulas e referências ABNT

Ao fim da fase 2, o autor pede um artigo de lei ou uma súmula por voz, o texto literal entra com referência ABNT, e nada da IA chega ao Word sem aprovação. Portão de saída: jornadas E2E-02, E2E-03, E2E-05 e E2E-06.

**2A — Base de leis e súmulas**

| ID | Tarefa | Critério de aceite | Teste E2E | Depende de | Status |
| --- | --- | --- | --- | --- | --- |
| F2.01 | Ingestão do `ctresb/leis`: clone parcial (`constituicao.md`, `federal/`, `jurisprudencia/`), leitura do cabeçalho YAML, tabela de normas | Normas federais com URN, situação e link da fonte | Integração: CF e Código Civil carregados com metadados corretos | F0.04 | A fazer |
| F2.02 | Segmentação por dispositivo (artigo, parágrafo, inciso, alínea) com ID estável e texto literal | Unitários sobre CF, CC, CPC e Estatuto da Terra; texto idêntico ao arquivo | "Art. 5º, inciso XXIII, da Constituição" retorna só aquele inciso | F2.01 | A fazer |
| F2.03 | Tabela de apelidos editável (Código Civil → Lei 10.406/2002, CPC, CF, Estatuto da Terra…) | Autor cadastra apelidos pela tela | Cadastrar um apelido e buscá-lo por voz | F2.01 | A fazer |
| F2.04 | Súmulas e temas: tribunal, número, enunciado, situação (vigente ou cancelada) | Súmula cancelada aparece sinalizada | Buscar uma súmula cancelada mostra aviso antes de inserir | F2.01 | A fazer |
| F2.05 | Atualização semanal: `git pull`, detecção de normas alteradas, reindexação só das diferenças | Nova redação vira nova versão sem apagar a já citada | Commit de teste altera um artigo: a citação antiga mantém o texto e ganha aviso | F2.02 | A fazer |

**2B — Pesquisa, inserção e aprovação**

| ID | Tarefa | Critério de aceite | Teste E2E | Depende de | Status |
| --- | --- | --- | --- | --- | --- |
| F2.06 | Interpretação do comando de pesquisa com Claude (tool use, esquema JSON validado) | 95% de acerto em 100 frases de teste | Simulador no CI; API real no noturno sobre as 100 frases | F1.14 | A fazer |
| F2.07 | Busca exata: norma + dispositivo; súmula + tribunal + número | Resposta em menos de 300 ms | "Atena, busca o artigo 1.228 do Código Civil" insere o caput com referência | F2.02, F2.06 | A fazer |
| F2.08 | Painel lateral de resultados, assíncrono | Ditado continua enquanto a busca roda | Ditar logo após o comando: o texto segue entrando e o painel abre ao fim da busca | F2.07 | A fazer |
| F2.09 | Checagem de literalidade: o trecho precisa ser substring exata da fonte (normalizando só espaços) | Inserção bloqueada se não for | Simulador do Claude devolve trecho alterado: nada entra e aparece "não encontrei na fonte" | F2.07 | A fazer |
| F2.10 | Inserção: citação curta no corpo (até 3 linhas) ou longa com recuo (NBR 10520), no cursor de ditado | Regra das 3 linhas aplicada sozinha | Inserir artigo curto e longo; conferir formato no editor e no Word | F2.09 | A fazer |
| F2.11 | Marcação "Inserido IA — pendente": destaque no editor e contador de pendências por capítulo | Pendências sempre visíveis | Após inserir, contador mostra 1; aprovar zera | F2.10 | A fazer |
| F2.12 | Aprovação por voz e clique: "insere a segunda", "descarta", aprovar ou rejeitar, aprovar em lote | Rejeitar remove o trecho e a referência | Escolher o 2º candidato por voz, rejeitar outro por clique, conferir o manuscrito | F2.08, F2.11 | A fazer |

**2C — Referências ABNT**

| ID | Tarefa | Critério de aceite | Teste E2E | Depende de | Status |
| --- | --- | --- | --- | --- | --- |
| F2.13 | Referência em CSL-JSON (legislação, súmula) com URL da fonte e data de acesso | Toda inserção gera referência completa | Inserir lei e súmula e conferir os dois registros | F2.10 | A fazer |
| F2.14 | Citeproc na exportação com dois estilos: nota de rodapé (referência completa) e autor-data, escolhidos ao exportar | Mesmo manuscrito correto nos dois | Exportar o capítulo nos dois estilos e comparar com os arquivos esperados | F2.13, F1.23 | A fazer |
| F2.15 | Lista de referências no fim do livro, ordenada pela ABNT | Sem duplicatas | Citar a mesma lei duas vezes gera uma única entrada | F2.14 | A fazer |
| F2.16 | Estilo "Inserido IA" no Word, com opção de omitir na versão final | Versão final sem nenhum realce | Exportar com e sem a opção; o verificador conta os trechos marcados | F2.11, F1.23 | A fazer |
| F2.17 | Link da fonte oficial em cada citação (na referência e como comentário no Word de revisão) | Todo trecho inserido é rastreável | Verificador confere que cada citação tem URL | F2.13 | A fazer |

## Fase 3 — Celular e jurisprudência por tema

Ao fim da fase 3, o autor dita pelo celular, inclusive sem rede, e pede jurisprudência por assunto. Portão de saída: jornadas E2E-04, E2E-07 e E2E-08.

**3A — Celular (PWA)**

| ID | Tarefa | Critério de aceite | Teste E2E | Depende de | Status |
| --- | --- | --- | --- | --- | --- |
| F3.01 | PWA: manifest, service worker, ícone, instalação em Android e iOS | Instala e abre em tela cheia nos dois | Emulação de celular: manifest válido e service worker ativo | F1.17 | A fazer |
| F3.02 | Interface do celular: gravar, botão de comando segurado, painel de candidatos compacto, leitura do capítulo | Uso com uma mão; alvos de toque de 48 px ou mais | iPhone e Pixel emulados: ditar, segurar o botão de comando, escolher candidato | F3.01, F2.12 | A fazer |
| F3.03 | Fila offline: grava em IndexedDB, envia quando a rede volta, transcrição em lote, encaixe no ponto certo | Nenhum áudio perdido sem rede | `setOffline(true)`, ditar 1 min, voltar online: texto aparece na posição certa | F3.01, F1.05 | A fazer |
| F3.04 | Microfone no Safari do iOS: permissões, interrupções (ligação, bloqueio de tela), aviso e retomada | Ditado retoma após uma interrupção | WebKit emulado: perda do microfone mostra aviso e botão de retomar | F3.02 | A fazer |
| F3.05 | Trava de sessão: um aparelho dita por vez; o outro acompanha ao vivo e pode assumir | Nunca dois ditados simultâneos no mesmo livro | Celular e computador abertos: o segundo a gravar recebe "assumir a sessão?" | F1.21 | A fazer |

**3B — Jurisprudência por tema**

| ID | Tarefa | Critério de aceite | Teste E2E | Depende de | Status |
| --- | --- | --- | --- | --- | --- |
| F3.06 | Ingestão do RepoJus filtrada (STF + tribunais escolhidos), com DuckDB lendo o Parquet direto do Hugging Face | Sem duplicatas (`normalized_hash`) e com URL oficial | Integração: amostra do STF com ementa, relator, data e URL | F0.04 | A fazer |
| F3.07 | Ingestão dos dados abertos do STJ (2022 em diante), atualização mensal | Acórdãos com ementa e inteiro teor | Integração: amostra do STJ carregada e buscável | F0.04 | A fazer |
| F3.08 | Fragmentação e vetores: ementa e trechos do inteiro teor, embeddings multilíngues, índice pgvector + busca textual em português | Busca híbrida em menos de 2 s | "Função social da propriedade rural" retorna acórdãos do tema no banco semente | F3.06, F3.07 | A fazer |
| F3.09 | Reordenação com Claude e até 3 candidatos (ementa, tribunal, relator, data, link) | Todo candidato existe na base | Comando de jurisprudência abre o painel com 3 candidatos reais do banco semente | F3.08, F2.08 | A fazer |
| F3.10 | Referência CSL-JSON de jurisprudência (tribunal, classe, número, relator, órgão, julgamento, publicação) | Sai em ABNT nos dois estilos | Inserir um acórdão e exportar nos dois estilos | F3.09, F2.14 | A fazer |
| F3.11 | Registro de buscas sem resultado + painel com contagem por tipo e tribunal | Base para decidir sobre API paga | Busca sem resultado aparece no painel com data e frase falada | F2.07 | A fazer |
| F3.12 | Conferência opcional no DataJud: número, classe e tribunal do processo citado | Divergência gera aviso, não bloqueio | Acórdão com número divergente mostra aviso no painel | F3.10 | A fazer |

## Fase 4 — STJ anterior a 2022 e biblioteca do autor

A fase 4 fecha as lacunas que as bases gratuitas deixam: precedentes antigos do STJ e doutrina dos livros que o autor já possui. Portão de saída: jornada E2E-10. Antes de começar, revisar o painel de buscas sem resultado (F3.11): se a lacuna do STJ for pequena, F4.01 pode sair do escopo.

| ID | Tarefa | Critério de aceite | Teste E2E | Depende de | Status |
| --- | --- | --- | --- | --- | --- |
| F4.01 | Coletor da pesquisa oficial do STJ (anterior a 2022): por tema e por número, no máximo 1 requisição por segundo, sem contornar bloqueios | Acórdão coletado com ementa, inteiro teor e URL | Integração com páginas gravadas (HTML de fixture) | F3.08 | A fazer |
| F4.02 | Colar inteiro teor: o autor cola um acórdão, o sistema extrai ementa e dados da referência e indexa | Campos revisáveis antes de salvar | Colar um acórdão de exemplo, revisar campos e inserir a ementa | F3.10 | A fazer |
| F4.03 | Biblioteca do autor: upload de PDFs próprios, extração de texto (OCR quando escaneado), páginas preservadas | Cada trecho guarda o número da página | Enviar PDF de teste e buscar uma frase: volta o trecho com a página | F3.08 | A fazer |
| F4.04 | Citação de doutrina: busca na biblioteca, checagem de literalidade, referência de livro, capítulo ou artigo, com página | Citação direta sempre com página | "Atena, busca na biblioteca posse agrária" insere trecho com página e referência | F4.03, F2.09 | A fazer |
| F4.05 | Gestão da biblioteca: listar, remover, reprocessar obras | Remover uma obra marca suas citações como órfãs | Remover um PDF citado gera aviso nas citações afetadas | F4.03 | A fazer |

## Transversais

Os itens transversais não são uma fase: cada um entra no momento indicado e continua valendo dali em diante.

| ID | Tarefa | Critério de aceite | Teste E2E | Quando | Status |
| --- | --- | --- | --- | --- | --- |
| T.01 | Chaves só no servidor: nenhuma chave de API no código do navegador, rotação documentada | Varredura do bundle não encontra chaves | Teste baixa o JS servido e falha se achar padrão de chave | Fase 0 | Concluído |
| T.02 | Limites de uso: rate limiting no WebSocket e nas buscas, CORS restrito ao domínio | Excesso recebe erro claro, sem derrubar a sessão | 100 buscas em 10 s: as excedentes recebem aviso e o ditado continua | Fase 1 | Em validação |
| T.03 | Sigilo do livro: STT em modo de retenção zero, Claude pela API comercial, criptografia em repouso, termo de confidencialidade com o cliente | Configurações documentadas e conferidas | CI verifica que a configuração de retenção zero está ativa | Fase 1 | Em validação |
| T.04 | Custos: minutos de STT e tokens do Claude por sessão, alerta de teto mensal | Painel mostra o custo do mês | Sessão de teste registra minutos e tokens no painel | Fase 1 | Em validação |
| T.05 | Desempenho: sessão de 2 h sem vazamento de memória; latência fala → tela abaixo de 1,5 s | Métricas no alvo no teste noturno | Jornada E2E-13 | Fase 1 | Em validação |
| T.06 | Atalhos e acessibilidade: gravar, comando e aprovar pelo teclado; contraste adequado | Tudo operável sem mouse | Jornada E2E-01 repetida só com teclado | Fase 1 | Em validação |
| T.07 | Documentação: manual do autor (comandos falados), runbook de operação, README de desenvolvimento | Autor usa o manual sem ajuda | Revisão do manual na sessão piloto | Fases 1 a 4 | Em validação |
| T.08 | Piloto e treinamento: sessão guiada, ditado de um capítulo real, ajuste de glossário e regras de grafia | Autor aprova o Word do capítulo piloto | Aceite do cliente (fora da automação) | Fim da fase 1 | Aguarda o cliente |

## Jornadas E2E completas

As jornadas cruzam várias tarefas e são o critério de saída de cada fase. Todas rodam a cada pull request com os simuladores, exceto a E2E-13, que roda toda noite com o provedor real. Uma jornada que passou continua na suíte como teste de regressão.

| ID | Jornada | Passos | Resultado esperado | Fecha a fase | Status |
| --- | --- | --- | --- | --- | --- |
| E2E-01 | Capítulo completo no computador | 1) Login 2) Nova obra 3) Áudio com capítulo, seção, três parágrafos, citação e nota 4) Exportar Word | Word com títulos, citação com recuo e nota real; texto idêntico à transcrição | 1 | Em validação |
| E2E-02 | Artigo de lei até o Word | 1) Ditar 2) "Atena, busca o artigo 1.228 do Código Civil" 3) Aprovar 4) Exportar nos dois estilos | Texto literal do artigo; referência ABNT em nota e em autor-data; sem realce na versão final | 2 | A fazer |
| E2E-03 | Súmula vigente e cancelada | 1) Pedir súmula vigente e aprovar 2) Pedir súmula cancelada | Vigente entra com referência; cancelada mostra aviso antes de qualquer inserção | 2 | A fazer |
| E2E-04 | Jurisprudência por tema | 1) "Atena, jurisprudência do STF sobre função social da propriedade rural" 2) "Insere a segunda" 3) Exportar | Painel com 3 candidatos reais; o 2º entra com ementa literal e referência completa | 3 | A fazer |
| E2E-05 | Busca sem resultado | 1) Pedir norma inexistente 2) Abrir o painel de buscas | Aviso "não encontrei"; nada inserido; a partir da fase 3, a busca aparece no painel (F3.11) com data e frase | 2 | A fazer |
| E2E-06 | Bloqueio de citação alterada | 1) Simulador do Claude devolve trecho modificado 2) Tentar inserir | Inserção bloqueada; manuscrito inalterado; evento registrado | 2 | A fazer |
| E2E-07 | Celular sem rede | 1) Emulação de celular 2) Ficar offline 3) Ditar 1 min 4) Voltar online | Texto aparece no ponto certo; áudio no Storage; nada perdido | 3 | A fazer |
| E2E-08 | Troca entre aparelhos | 1) Ditar no computador 2) Abrir no celular 3) Assumir a sessão e ditar | Celular vê o texto ao vivo; após assumir, só ele grava; computador mostra "sessão em outro aparelho" | 3 | A fazer |
| E2E-09 | Falso positivo e queda de rede | 1) Áudio com "comando normativo" e "Atena" no meio da frase 2) Derrubar a rede por 5 s no meio | Nenhum comando disparado; texto completo após reconectar | 1 | Em validação |
| E2E-10 | Doutrina da biblioteca | 1) Enviar PDF 2) "Atena, busca na biblioteca posse agrária" 3) Aprovar 4) Exportar | Trecho literal com página; referência de livro ABNT | 4 | A fazer |
| E2E-11 | Fidelidade de ponta a ponta | Roda sobre todas as jornadas acima | Diff zero entre o texto do autor no Word e a transcrição de referência + regras aprovadas | Todas | Em validação (fases 0 e 1) |
| E2E-12 | Segurança | 1) Acessar obra e áudio sem sessão 2) Acessar obra de outro usuário 3) Abrir WebSocket sem token | Tudo recusado, sem vazar conteúdo | 0 | Concluído |
| E2E-13 | Sessão longa real (noturno) | Áudio de 2 h do autor com o provedor escolhido | Sem quedas nem vazamento de memória; latência abaixo de 1,5 s; taxa de erro dentro do benchmark | 1 | Pronto (aguarda áudio do autor e chave) |

## Definição de pronto

Uma tarefa só vai para "Concluído" quando cumpre todos os itens abaixo; uma fase, quando todas as tarefas e as jornadas dela passam em staging.

- Critério de aceite da linha cumprido e demonstrado em staging.
- Teste E2E da linha escrito, passando no CI e incluído na suíte de regressão.
- Testes unitários e de integração da lógica nova, sem queda de cobertura.
- E2E-11 (fidelidade) continua com diff zero.
- Nenhum texto gerado pela IA entra no manuscrito sem passar pela checagem de literalidade e pela marcação de pendente.
- Migrações de banco reversíveis e políticas RLS cobrindo as tabelas novas.
- Erros relevantes chegando ao Sentry; métricas novas no painel.
- Manual do autor atualizado quando a tarefa muda o que ele fala ou vê.
- Revisão de código aprovada e status atualizado nesta tabela.
