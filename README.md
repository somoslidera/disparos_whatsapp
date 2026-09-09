# Disparos WhatsApp · Somos Lidera

Aplicativo para envio de mensagens em massa no WhatsApp, conectado ao seu número através do [uazapi](https://uazapi.com).

- Dispara para **contatos individuais** e **grupos do WhatsApp**
- **Minhas listas**: crie listas com contatos, grupos e até outras listas. Ao selecionar a lista, todos recebem.
- Mensagem com **texto, imagens, vídeos, áudios (mensagem de voz ou arquivo) e documentos**
- Pré-visualização em estilo WhatsApp, formatação (*negrito*, _itálico_, ~tachado~)
- Envio de **mensagem de teste** para um número antes do disparo
- Intervalo aleatório entre envios (reduz risco de bloqueio) e progresso em tempo real
- Histórico com o status de cada destinatário e opção de reutilizar campanhas
- Conexão do número por QR code (ou código de pareamento)
- Proteção opcional por senha

## Como rodar

Requisitos: Node.js 20 ou superior.

```bash
cp .env.example .env   # preencha UAZAPI_URL e UAZAPI_TOKEN
npm install
npm run dev            # desenvolvimento: http://localhost:3000
```

Em produção:

```bash
npm run build
npm start
```

Ou com Docker:

```bash
docker compose up -d --build
```

## Configuração (`.env`)

| Variável        | Descrição                                                                 |
| --------------- | ------------------------------------------------------------------------- |
| `UAZAPI_URL`    | URL do servidor uazapi, ex.: `https://seu-servidor.uazapi.com`            |
| `UAZAPI_TOKEN`  | Token da instância (Instance Token)                                       |
| `APP_PASSWORD`  | Opcional. Senha para acessar o app. Vazio desabilita a proteção.          |
| `DATA_DIR`      | Opcional. Pasta do banco (`db.json`) e dos anexos. Padrão: `./data`       |

Nunca versione o `.env`: ele já está no `.gitignore`.

## Uso

1. **Conexão**: gere o QR code e escaneie no WhatsApp (Aparelhos conectados).
2. **Minhas listas** (opcional): crie listas reutilizáveis com contatos, grupos e outras listas.
3. **Nova campanha**: escreva a mensagem, anexe arquivos, selecione contatos, grupos ou listas e clique em **Disparar**.
   Use **Enviar teste** para receber a mensagem no seu próprio número antes.
4. **Histórico**: acompanhe o resultado por destinatário e reutilize campanhas antigas.

## Como funciona o envio

- Os destinatários são expandidos e deduplicados (uma lista dentro de outra lista funciona, referências circulares são bloqueadas).
- O envio é sequencial, um destinatário por vez, com intervalo aleatório entre o mínimo e o máximo configurados (padrão 4 a 10 s).
- Texto com imagem, vídeo ou documento vai como legenda do primeiro anexo. Áudios não aceitam legenda, então o texto é enviado em uma mensagem separada.
- Áudios são enviados como **mensagem de voz** (`ptt`) por padrão; é possível alternar para arquivo de áudio em cada anexo.
- Arquivos são enviados ao uazapi em base64, então o app não precisa de URL pública.
- Se o servidor reiniciar durante um disparo, a campanha fica marcada como cancelada nos destinatários que não receberam.

## Endpoints do uazapi utilizados

| Endpoint                     | Uso                                    |
| ---------------------------- | -------------------------------------- |
| `GET /instance/status`       | Status da conexão                      |
| `POST /instance/connect`     | QR code / código de pareamento         |
| `POST /instance/disconnect`  | Desconectar                            |
| `GET /group/list`            | Grupos do WhatsApp                     |
| `GET /contacts`              | Agenda de contatos                     |
| `POST /chat/find`            | Conversas (contatos fora da agenda)    |
| `POST /send/text`            | Texto                                  |
| `POST /send/media`           | Imagem, vídeo, áudio, voz e documento  |

O cliente fica em `src/lib/uazapi.ts` e faz parsing tolerante das respostas. Se a sua versão do uazapi devolver campos com nomes diferentes, ajuste ali.

## Estrutura

```
src/app            páginas (Next.js App Router) e rotas /api
src/components     interface (compositor, seletor de destinatários, listas, histórico, conexão)
src/lib            cliente uazapi, banco JSON, motor de campanhas, validações
data/              db.json e anexos (não versionados)
```

Scripts: `npm run dev`, `npm run build`, `npm start`, `npm run lint`, `npm run typecheck`.
