# Disparos WhatsApp · Somos Lidera

Aplicativo para envio de mensagens em massa no WhatsApp, conectado ao seu número através do [uazapi](https://uazapi.com).

- Dispara para **contatos individuais** e **grupos do WhatsApp**
- Em cada grupo, botão **Membros**: envie no grupo, no privado de membros escolhidos, ou nos dois
- **Minhas listas**: crie listas com contatos, grupos e até outras listas. Ao selecionar a lista, todos recebem.
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
- Arquivos são enviados ao uazapi em base64, então o app não precisa de URL pública. Limite de 3 MB por arquivo (limite de corpo de requisição da Vercel).
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
