# Validação da Fase 1

Roteiro para conferir a Fase 1 com as próprias mãos. A parte automática já passa no CI; aqui você confere o que importa ver funcionando. Leva uns 30 minutos.

## Antes de começar

```bash
cd ~/Desktop/"Livro Fred"
git checkout fase-1 && git pull
pnpm install
pnpm dev
```

Use o Chrome e entre com `autor-a@example.com` (a senha é a `E2E_PASSWORD` do `.env`). O manual do autor ([manual-do-autor.md](manual-do-autor.md)) explica cada comando.

**Sobre a transcrição:** sem chave de provedor, quem “ouve” é o simulador, que devolve um cenário gravado. Você fala qualquer coisa (o áudio precisa chegar) e o texto que aparece é o do cenário. Em outro terminal, escolha o cenário antes de cada teste com `pnpm cenario <nome>`.

Para testar com a sua voz de verdade, crie uma conta gratuita na Deepgram, ponha `STT_PROVIDER=deepgram` e `DEEPGRAM_API_KEY=...` no `.env` e reinicie o `pnpm dev`.

## 1. Capítulo completo por voz (E2E-01)

- [ ] Rode `pnpm cenario capitulo-completo`.
- [ ] Crie uma obra “Validação fase 1” e clique em **Gravar**. Fale por cerca de 50 segundos.
- [ ] Na faixa abaixo da barra aparecem as confirmações (“✓ Capítulo 1: Da função social da propriedade”, “✓ Seção 1: Conceito”…).
- [ ] O manuscrito fica assim: capítulo, seção, três parágrafos, uma citação recuada e duas chamadas de nota (`*`). Nenhuma palavra de comando aparece no texto.
- [ ] O sumário à esquerda mostra o capítulo e a seção.
- [ ] Clique em **Pausar**.

## 2. Word (F1.22 a F1.25)

- [ ] Vá em **Exportações**. Já há um arquivo “Fim da sessão”, gerado sozinho.
- [ ] Clique em **Exportar Word** e abra o arquivo. Confira:
  - títulos;
  - corpo em Times 12 com entrelinha 1,5;
  - citação com recuo de 4 cm, fonte menor;
  - duas notas de rodapé de verdade;
  - página A4 com margens ABNT.
- [ ] **Aprovação:** este é o modelo do livro. Se algo deve mudar (fonte, recuo, título do capítulo), anote: o modelo é gerado por script e muda rápido.

## 3. Prévia (F1.18)

- [ ] Volte ao manuscrito e clique em **Prévia** (ou Alt+P). A folha deve se parecer com a página do Word.
- [ ] **Aprovação:** a imagem de referência da prévia fica em `tests/e2e/specs/fase1-manuscrito.spec.ts-snapshots/`.

## 4. Comandos e edição

- [ ] `pnpm cenario edicao-voz`, nova obra, **Gravar**. A segunda frase some (“✓ Última frase apagada”) e volta (“✓ Desfeito”).
- [ ] `pnpm cenario comando-tecla`, nova obra, **Gravar**, e segure **F9** enquanto o simulador “ouve” o comando. Aparece “Modo comando”, e o capítulo “Da propriedade” é criado sem dizer “Atena”.
- [ ] `pnpm cenario comando-normativo`, nova obra, **Gravar**. “O comando normativo…” e “A coruja de Atena…” entram como texto, sem disparar nada.

## 5. Cursor de ditado, digitação e histórico

- [ ] Numa obra com texto, clique no meio de um parágrafo, aperte **Alt+D** e grave. O texto entra ali (a barrinha laranja marca o ponto).
- [ ] Digite uma frase em qualquer parágrafo. O indicador muda para “Salvo”. Recarregue a página: a frase continua lá.
- [ ] Em **Histórico**, a mudança aparece. **Restaurar** volta o parágrafo ao que era.
- [ ] Arraste um capítulo no sumário para outra posição. O conteúdo vai junto e o Word sai na ordem nova.

## 6. Glossário, grafia e hesitações

- [ ] Em **Glossário**, cadastre “usucapião”.
- [ ] Em **Grafia**, crie a regra “rex” → “REsp” (aprovada). Rode `pnpm cenario grafia-rex`, grave, e o texto sai “No REsp 1.234…”. Em **Trocas feitas**, **Desfazer** volta para “rex”.
- [ ] Em **Configurações**, ligue “Remover hesitações”. Rode `pnpm cenario hesitacao` e grave: o “hã” some.

## 7. Queda de rede (F1.02)

- [ ] `pnpm cenario comando-normativo`, nova obra, **Gravar**.
- [ ] Depois do primeiro parágrafo aparecer, desligue o Wi-Fi por uns 5 segundos e religue.
- [ ] Aparece “Reconectando… o áudio continua sendo gravado”. Quando a rede volta, o texto completo entra, sem buracos.

## 8. Outras telas

- [ ] Abra a mesma obra em duas abas e grave numa delas: o texto aparece na outra em até 2 segundos.
- [ ] Clique num parágrafo ditado e em **Ouvir trecho**: toca o áudio que gerou aquele texto.
- [ ] **Custos** (no topo) mostra os minutos de transcrição do mês.

## 9. O que a automação já provou

Na aba **Actions** do repositório, no PR “Fase 1”:

- [ ] **CI**: lint, typecheck, unitários (motor, servidor, provedores, exportação, benchmark), integração (RLS, 1.000 blocos no banco, histórico) e todos os E2E da fase, inclusive E2E-01 (mouse e teclado) e E2E-09.
- [ ] **Infra**: imagens e staging local com o E2E contra ele; backup e restauração.

## O que depende de você

| Item | O que é preciso |
| --- | --- |
| Benchmark (F1.04), o portão da fase | ~30 min de áudio do autor + transcrição revisada + chaves dos três provedores (passo a passo no [runbook](runbook.md#provedor-de-transcrição-f103-f104)) |
| Aprovação do modelo Word e da prévia (F1.18, F1.22) | Abrir o Word gerado e a prévia e dizer se está de acordo |
| Piloto (T.08) | Sessão guiada com o autor ditando um capítulo real, já com o provedor escolhido |
| Teste noturno com provedor real (E2E-13) | Áudio longo do autor no bucket privado e o segredo do provedor no GitHub |
| VPS, domínios, Sentry (pendências da fase 0) | Continuam valendo para publicar em staging e produção |
