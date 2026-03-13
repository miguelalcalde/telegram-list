# Telegram List Bot (Chat SDK)

A Telegram bot that creates one event message and keeps editing that same message as people react.

## Behavior

1. Send `/list <event name>` (or `/event <event name>`).
2. Bot posts:
   - Event name in bold
   - Empty "coming" list (`1. `)
3. Reactions on that message update it:
   - Positive reaction (`👍`, `✅`, `➕`, etc.) => added to "coming"
   - Negative reaction (`👎`, `❌`, etc.) => moved to "Not coming"
   - No reaction => no changes

## Stack

- [`chat`](https://www.npmjs.com/package/chat)
- [`@chat-adapter/telegram`](https://www.npmjs.com/package/@chat-adapter/telegram)
- [`@chat-adapter/state-memory`](https://www.npmjs.com/package/@chat-adapter/state-memory)
- TypeScript + `tsx`

## Setup

1. Install:

```bash
npm install
```

2. Copy env template:

```bash
cp env.example .env
```

3. Fill `.env`:

- `TELEGRAM_BOT_TOKEN` (required)
- `TELEGRAM_WEBHOOK_SECRET_TOKEN` (recommended for webhook mode)
- `TELEGRAM_BOT_USERNAME` (recommended for mention detection)

## Run

### Local development (polling)

`auto` mode falls back to polling locally when no webhook is configured.

```bash
npm run dev
```

You can force polling:

```bash
TELEGRAM_MODE=polling npm run dev
```

### Webhook mode

```bash
TELEGRAM_MODE=webhook PORT=3000 npm run start
```

Webhook endpoint exposed by this app:

- `POST /api/webhooks/telegram`
- `GET /health`

Set your Telegram webhook URL:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/api/webhooks/telegram",
    "secret_token": "'"$TELEGRAM_WEBHOOK_SECRET_TOKEN"'",
    "allowed_updates": ["message", "edited_message", "callback_query", "message_reaction"]
  }'
```

## Notes

- Per-thread list state is stored with Chat SDK thread state (currently backed by memory state adapter).
- For production persistence across restarts, swap `@chat-adapter/state-memory` for Redis/Postgres state adapter.
