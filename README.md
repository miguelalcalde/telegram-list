# Telegram List Bot (Chat SDK)

A Telegram bot that creates one event message and keeps editing that same message as people react.

## Behavior

1. Send `/list <event name>` (or `/event <event name>`).
2. Bot posts:
   - Event name
   - Empty "coming" list (`1. `)
3. Reactions on that message update it:
   - Any added reaction => user is added/updated in the list
   - Extra reactions from the same user increase their count (`(+1)`, `(+2)`, ...)
   - Removing a reaction => user is removed from the list
   - No reaction => no changes

## Bot Commands

The bot currently supports two text commands in Telegram chats:

### 1) `/list <event name>`

Creates a new list message for the event and pins it (if the bot has pin permission).

Examples:

```text
/list Christmas dinner
/list Team offsite planning
/list@thelistingbot Friday padel
```

What happens:

- Bot posts a message with the event title and an empty numbered list.
- Users join by adding any reaction on that bot message.
- Users leave by removing their reaction.

### 2) `/event <event name>`

Alias of `/list`. Same behavior and output.

Examples:

```text
/event Christmas dinner
/event Product sync lunch
/event@thelistingbot Sunday brunch
```

### 3) `/rename <new title>` or `/update <new title>`

Rename an existing list. Must be sent as a reply to the target list message.

Examples:

```text
/rename Dinner at Maria's
/update Christmas dinner final list
/rename@thelistingbot Team lunch confirmed
```

Reply-based usage:

1. Long-press the list message (the one created by bot)
2. Tap Reply
3. Send `/rename <new title>` (or `/update <new title>`)

### 4) `/delete` or `/remove`

Delete an existing list. Must be sent as a reply to the target list message.

Examples:

```text
/delete
/remove
/delete@thelistingbot
```

Reply-based usage:

1. Reply to the specific list message you want to delete
2. Send `/delete` or `/remove`

This supports multiple active lists in the same group because commands target the replied list.

## Reaction Controls (No Text Command Needed)

After list creation, membership is controlled only with reactions on the list message:

- Add any reaction (`👍`, `🔥`, `✅`, etc.) => you are added to the list.
- Add more reactions yourself => increases your attendee count as `(+N)`.
- Remove a reaction => decreases your count by one.
- Remove your last reaction => you are removed from the list.

Example flow:

1. User A sends `/list Birthday picnic`
2. Bot posts and pins:
   - `Birthday picnic`
   - `1. `
3. User B reacts with `👍`
4. Bot updates:
   - `Birthday picnic`
   - `1. User B`
5. User B removes `👍`
6. Bot updates back to:
   - `Birthday picnic`
   - `1. `

Example with extra attendees:

1. User C reacts once => `1. User C`
2. User C reacts two more times (3 total) => `1. User C (+2)`
3. User C removes one reaction => `1. User C (+1)`
4. User C removes the remaining two => list entry for User C disappears

## Stack

- [`chat`](https://www.npmjs.com/package/chat)
- [`@chat-adapter/telegram`](https://www.npmjs.com/package/@chat-adapter/telegram)
- [`@chat-adapter/state-memory`](https://www.npmjs.com/package/@chat-adapter/state-memory) (fallback)
- [`@chat-adapter/state-redis`](https://www.npmjs.com/package/@chat-adapter/state-redis) (recommended for persistence)
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
- `REDIS_URL` (optional outside Docker; Docker Compose sets it automatically)

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
npm run build
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

## Docker (bot + Redis)

1. Prepare `.env`:

```bash
cp env.example .env
```

2. Set at least:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`

3. Start services:

```bash
docker compose up --build
```

This starts:
- `bot` container (your Telegram bot)
- `redis` container (persistent state backend)

By default in Compose, bot uses:
- `REDIS_URL=redis://redis:6379`
- `TELEGRAM_MODE=polling`

### Docker webhook mode

Set `TELEGRAM_MODE=webhook` in `.env` (or export it), then:

```bash
docker compose up --build
```

Expose your server publicly and set Telegram webhook to:

- `https://your-domain.com/api/webhooks/telegram`

## Notes

- If `REDIS_URL` is set, bot uses Redis state (recommended).
- If `REDIS_URL` is not set, bot falls back to in-memory state.
- Pinning list messages requires bot permissions in the group (admin pin rights).
