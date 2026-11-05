# Disparos WhatsApp · Somos Lidera

Aplicativo para envio de mensagens em massa no WhatsApp, conectado ao seu número através do [uazapi](https://uazapi.com).

- Dispara para **contatos individuais** e **grupos do WhatsApp**
- Em cada grupo, botão **Membros**: envie no grupo, no privado de membros escolhidos, ou nos dois
- **Minhas listas**: crie listas com contatos, grupos e até outras listas. Ao selecionar a lista, todos recebem.
  As listas ficam no servidor e são compartilhadas entre todos os computadores conectados à mesma instância do uazapi.
- **Listas automáticas**: regras por nome (ex.: grupos que começam com `PLL |`, contatos que terminam com `PLL`).
  Ao criar a regra, quem já existe e não está na lista fica "fora da lista"; só os novos entram sozinhos. Cada item pode ser incluído ou retirado manualmente.
- Mensagem com **texto, imagens, vídeos, áudios (mensagem de voz ou arquivo) e documentos**
- **Blocos**: a mensagem pode ser dividida em várias mensagens enviadas em sequência
- **Personalização**: `{nome}` vira o primeiro nome salvo na agenda (`{nome_completo}` também), com texto reserva configurável
- **Agendamento** por data e hora (o disparo sai do navegador, com a aba aberta)
- Pré-visualização em estilo WhatsApp, formatação (*negrito*, _itálico_, ~tachado~)
- Envio de **mensagem de teste** para um número antes do disparo
- Intervalo aleatório entre envios (reduz risco de bloqueio) e progresso em tempo real
- Histórico com o status de cada destinatário e opção de reutilizar campanhas
- Conexão do número por QR code (ou código de pareamento)
- Funciona hospedado na Vercel: a configuração do uazapi é feita pelo navegador
- Proteção opcional por senha (para instalação própria)

## Como usar (hospedado)

1. Abra o app e vá em **Conexão**.
2. Cole a **Server URL** e o **Instance Token** do uazapi e clique em Salvar. Essas informações ficam salvas apenas no seu navegador.
3. Gere o QR code e escaneie no WhatsApp.
4. Pronto: contatos e grupos são carregados da sua conta e você já pode disparar.

Listas, histórico e configuração ficam no navegador (localStorage). O servidor não guarda nada; ele apenas repassa as chamadas ao uazapi.
Durante um disparo, mantenha a aba aberta: o envio é orquestrado pelo navegador, um destinatário por vez.

## Como rodar localmente

Requisitos: Node.js 20 ou superior.

```bash
npm install
npm run dev            # desenvolvimento: http://localhost:3000
```

Opcionalmente, copie `.env.example` para `.env` e preencha `UAZAPI_URL` e `UAZAPI_TOKEN` para não precisar configurar pelo navegador.

Em produção:

```bash
npm run build
npm start
```

## Configuração (`.env`)

Todas opcionais. Sem elas, o app pede a URL e o token na tela Conexão.

| Variável        | Descrição                                                                 |
| --------------- | ------------------------------------------------------------------------- |
| `UAZAPI_URL`    | URL do servidor uazapi, ex.: `https://seu-servidor.uazapi.com`            |
| `UAZAPI_TOKEN`  | Token da instância (Instance Token)                                       |
| `APP_PASSWORD`  | Senha para acessar o app. Vazio desabilita a proteção.                    |
| `BLOB_READ_WRITE_TOKEN` | Criado automaticamente ao conectar um Vercel Blob ao projeto. Habilita anexos grandes. |

Nunca versione o `.env`: ele já está no `.gitignore`.

## Telas

- **Conexão**: configuração do uazapi, QR code e status do número.
- **Minhas listas**: listas reutilizáveis com contatos, grupos e outras listas.
- **Nova campanha**: mensagem, anexos, seleção de destinatários e disparo. Use **Enviar teste** para receber no seu próprio número antes.
- **Histórico**: resultado por destinatário e opção de reutilizar campanhas.

## Como funciona o envio

- Os destinatários são expandidos e deduplicados (uma lista dentro de outra lista funciona, referências circulares são bloqueadas).
- O navegador envia um destinatário por vez para `POST /api/send`, com intervalo aleatório entre o mínimo e o máximo configurados (padrão 4 a 10 s).
- Texto com imagem, vídeo ou documento vai como legenda do primeiro anexo. Áudios não aceitam legenda, então o texto é enviado em uma mensagem separada.
- Áudios são enviados como **mensagem de voz** (`ptt`) por padrão; é possível alternar para arquivo de áudio em cada anexo.
- Anexos: com o **Vercel Blob** ligado no projeto (Storage → Blob → Connect), o navegador envia o arquivo direto ao armazenamento e o uazapi recebe a URL; limite de 100 MB por arquivo. Sem o Blob, o arquivo vai embutido em base64 com limite de 3 MB (limite de corpo de requisição da Vercel). Os arquivos são apagados do Blob ao terminar o disparo ou ao remover o anexo.
- Se a aba for fechada durante um disparo, a campanha fica marcada como cancelada nos destinatários que não receberam.
- Campanhas agendadas ficam guardadas no navegador (anexos em IndexedDB). Se a aba for fechada e reaberta antes da hora, o agendamento continua; se o horário passar há mais de 2 horas com a aba fechada, o agendamento é cancelado.

## Endpoints do uazapi utilizados

| Endpoint                     | Uso                                    |
| ---------------------------- | -------------------------------------- |
| `GET /instance/status`       | Status da conexão                      |
| `POST /instance/connect`     | QR code / código de pareamento         |
| `POST /instance/disconnect`  | Desconectar                            |
| `GET /group/list`            | Grupos do WhatsApp                     |
| `GET /group/info`            | Membros de um grupo                    |
| `GET /contacts`              | Agenda de contatos                     |
| `POST /chat/find`            | Conversas (contatos fora da agenda)    |
| `POST /send/text`            | Texto                                  |
| `POST /send/media`           | Imagem, vídeo, áudio, voz e documento  |

O cliente fica em `src/lib/uazapi.ts` e faz parsing tolerante das respostas. Se a sua versão do uazapi devolver campos com nomes diferentes, ajuste ali.

## Estrutura

```
src/app            páginas (Next.js App Router) e rotas /api (proxy para o uazapi)
src/components     interface (compositor, seletor de destinatários, listas, histórico, conexão)
src/lib            cliente uazapi, entrega de mensagens, store local, motor de campanhas no navegador
```

Scripts: `npm run dev`, `npm run build`, `npm start`, `npm run lint`, `npm run typecheck`.

## API para agentes (envio de atas sem interface)

Rotas pensadas para um agente automático enviar mensagens em grupos de clientes pelo servidor, sem navegador.

Autenticação: header `Authorization: Bearer <DISPAROS_AGENT_KEY>`. Variáveis necessárias na Vercel:

| Variável | Descrição |
| --- | --- |
| `DISPAROS_AGENT_KEY` | Chave secreta do agente (mínimo 16 caracteres; use 32+ aleatórios). Ao trocar, faça um novo deploy e atualize a chave nas tarefas agendadas; recusas aparecem no log como `[agente] acesso recusado`, com o motivo |
| `DISPAROS_TESTE_NUMERO` | Número (DDI+DDD+número) que recebe os envios com `"teste": true` |
| `DISPAROS_AVISO_NUMERO` | Opcional: número que recebe os avisos do agente (padrão: `DISPAROS_TESTE_NUMERO`) |
| `UAZAPI_URL` / `UAZAPI_TOKEN` | Servidor e token da instância, para o servidor falar com o uazapi sem o navegador |

Regras de segurança: só grupos cujo nome começa com `PLL |` ou `PLL Flow |`; um grupo por chamada; nunca contatos ou listas; no máximo 30 chamadas por hora.

- `GET /api/agente/grupos`: grupos permitidos `[{ nome, id, participantes }]`.
- `POST /api/agente/enviar`: corpo `{ grupo | grupoId, blocos: string[1..4] (até 1.000 caracteres cada), referencia, teste? }`.
  Cada bloco vira uma mensagem, em sequência. `referencia` é única: uma referência já concluída (total ou parcialmente) responde 409 com o resultado anterior e não reenvia; uma referência cujo envio falhou por completo pode ser repetida. Nome não encontrado ou ambíguo: 422 com `parecidos`. Grupo fora do prefixo: 403. `teste: true` envia para `DISPAROS_TESTE_NUMERO` com a primeira linha `[TESTE] grupo: <nome>`.
- `GET /api/agente/historico`: envios do agente (exibidos na tela Histórico como "Agente").
- `GET /api/agente/conversas?grupo=<nome exato>` (ou `grupoId=`): **somente leitura** das mensagens de um grupo permitido (mesma trava de prefixo, 403/422 iguais ao envio). Parâmetros opcionais: `limite` (1–200, padrão 50: as N mensagens mais recentes), `offset` (para páginas anteriores, use `proximoOffset`) e `desde` (data/hora ISO). Resposta `{ ok, grupo, grupoId, total, temMais, proximoOffset, mensagens: [{ id, data (-03:00), deMim, autor (nome salvo na agenda, quando houver), autorNumero, tipo, texto, arquivo?, respondendo? }] }`, em ordem cronológica. O uazapi só guarda mensagens recebidas enquanto o número estava conectado nele.

- `POST /api/agente/aviso`: **aviso interno para você** quando o agente lê algo importante num grupo. Corpo `{ grupo | grupoId, texto (até 1.000 caracteres), referencia }`. O destino é fixo no servidor: `DISPAROS_AVISO_NUMERO` (opcional; sem ela usa `DISPAROS_TESTE_NUMERO`); o corpo não escolhe destino e nunca envia ao grupo ou a clientes. A mensagem chega como `🔔 Aviso do agente / Grupo: <nome>`. `referencia` repetida responde 409 sem reenviar (use, por exemplo, o id da mensagem do grupo). Limite próprio de 30 avisos por hora. Aparece no Histórico como "Aviso enviado para você".

### Lançamentos de notas fiscais (grupos "Lançamentos - <cliente>")

Para um agente buscar o que os clientes mandam nesses grupos e fazer os lançamentos. Mesma chave do agente.

- `GET /api/agente/lancamentos/pendentes`: tudo que os clientes mandaram e ainda não foi tratado, por grupo: fotos e PDFs de notas e textos com despesas (em qualquer formato, ex.: "01 cx de ovos - 145,00"). Ficam de fora mensagens deste número e de contatos da equipe (salvos com "Lidera" no nome). Opcionais: `grupo`/`grupoId` (um grupo só), `desde` (ISO; padrão 7 dias; nunca antes do início dos lançamentos automáticos, 05/11/2026 10:30, ajustável por `DISPAROS_LANC_INICIO`), `limitePorGrupo` (1–200, padrão 100), `maxArquivos` (1–100: no máximo N fotos/PDFs por resposta, sem separar a foto do texto que a acompanha; o resto vem em `restantes` e `temMais` e sai na próxima busca, depois de marcar estes). Resposta `{ grupos: [{ grupo, grupoId, itens: [{ id, data, autor, autorNumero, tipo: foto|pdf|documento|texto, texto, temArquivo?, arquivo?, mimetype? }] }], totalItens }`.
- `GET /api/agente/lancamentos/arquivo?grupoId=<jid>&id=<id>`: baixa a foto/PDF do item (só de mensagens entre as 200 mais recentes de um grupo de Lançamentos).
- `POST /api/agente/lancamentos/marcar`: `{ grupo | grupoId, ids: [...], status: "lancada" | "ignorada", observacao? }`. Tira os itens de `/pendentes` sem enviar nada.
- `POST /api/agente/lancamentos/confirmar`: `{ grupo | grupoId, ids: [...], observacao? (até 300) }`. Envia **uma** mensagem no grupo para o lote ("✅ Recebemos e já lançamos N itens. Obrigado!" + observação) e marca os itens como lançados. O mesmo lote nunca é confirmado duas vezes (409). Só grupos "Lançamentos -"; limite de 30 por hora.

`/api/agente/conversas` também lê grupos "Lançamentos -". Atas (`/enviar`) continuam só para grupos PLL.

Histórico e trava de referência ficam no Vercel Blob (em `agente/<segmento secreto>/`).
