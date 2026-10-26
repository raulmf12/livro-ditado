# Validação da Fase 0

Roteiro para conferir a Fase 0 com as próprias mãos. A parte automática já passa no CI; aqui você confere o que importa ver funcionando. Leva uns 15 minutos.

## Antes de começar

```bash
cd ~/Desktop/"Livro Fred"
git checkout fase-0-conclusao && git pull
pnpm install
pnpm dev
```

Use o Chrome. A senha dos autores de teste é a `E2E_PASSWORD` do `.env`; para ver, rode `grep E2E_PASSWORD .env`.

## 1. Login e obras (F0.05)

- [ ] Abra http://localhost:3000/obra. Você deve cair na tela de login.
- [ ] Entre com `autor-a@example.com` e uma senha errada. Deve aparecer "E-mail ou senha incorretos."
- [ ] Entre com a senha certa. Você vai para a lista de obras e vê "Obra semente A".
- [ ] Crie uma obra chamada "Validação". A página da obra abre.
- [ ] Clique em **Sair** e tente abrir a obra de novo pelo histórico do navegador. Deve voltar ao login.

## 2. Ditado com o seu microfone (F0.07, F0.06)

Até a F1.03 a transcrição vem do simulador. Ele não entende a sua fala: devolve sempre o texto do cenário `ditado-simples`, no ritmo do áudio que recebe. O teste aqui é o caminho do áudio, não o reconhecimento.

- [ ] Na obra "Validação", clique em **Gravar** e permita o microfone. O status muda para "gravando".
- [ ] Fale qualquer coisa. A barra de nível acompanha a sua voz.
- [ ] Em 1 ou 2 segundos aparece texto em cinza (provisório). Depois de uns 5 segundos de fala, os dois parágrafos finais aparecem em preto: "A função social da propriedade rural…" e "O imóvel rural deve ser explorado…".
- [ ] Clique em **Pausar**. O status volta para "parado".

## 3. Segurança (E2E-12)

- [ ] Ainda como autor A, copie a URL da obra "Validação". Saia e entre como `autor-b@example.com`. Cole a URL: deve aparecer "Obra não encontrada", sem o título da obra.
- [ ] Como autor B, a lista de obras mostra só "Obra semente B".

## 4. Aviso quando a transcrição cai (F0.06)

- [ ] Com o `pnpm dev` rodando, pare o simulador. Em outro terminal, rode `lsof -ti tcp:4010 | xargs kill`.
- [ ] Clique em **Gravar**. Deve aparecer: "A transcrição está fora do ar no momento. Seu áudio não foi perdido…", sem nenhum detalhe técnico.
- [ ] Reinicie o `pnpm dev` para voltar ao normal.

## 5. O que a automação já provou (só conferir que está verde)

Na aba **Actions** do repositório, os workflows do PR "Fase 0: conclusão":

- [ ] **CI**: lint, typecheck, unitários, integração de RLS e 16 testes E2E.
- [ ] **Infra / Imagens e staging local**: as imagens sobem atrás do Caddy com HTTPS, e 14 testes E2E passam contra essa pilha.
- [ ] **Infra / Backup e restauração**: backup, banco zerado, restauração; o autor entra, abre a obra e baixa o áudio.

## O que depende de você para fechar a fase "em staging"

O plano pede que a fase feche com a jornada passando em staging de verdade. Para isso faltam recursos externos; o código e os scripts já estão prontos:

| Item | O que é preciso | Onde está o passo a passo |
| --- | --- | --- |
| VPS e domínios (F0.02) | VPS Ubuntu 24.04 e dois domínios (staging e produção) | [runbook, Primeira instalação](runbook.md#primeira-instalação-da-vps) |
| Sentry de verdade (F0.06) | Conta no Sentry e os dois DSN (servidor e navegador) | [runbook, Observabilidade](runbook.md#observabilidade-f006) |
| Backup da produção (F0.08) | Senha do Postgres de cada ambiente e um destino fora da VPS | [runbook, Backup](runbook.md#backup-e-restauração-f008) |
| Projeto Supabase de staging/produção | Hoje tudo usa o `livro-ditado-dev` | [runbook, Migrações](runbook.md#migrações-do-banco) |
