import "dotenv/config";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Chat } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createTelegramAdapter, type TelegramAdapterMode } from "@chat-adapter/telegram";

interface Participant {
  userId: string;
  displayName: string;
}

interface EventList {
  title: string;
  coming: Participant[];
}

interface BotThreadState {
  eventLists: Record<string, EventList>;
}

interface TelegramPinTarget {
  chat_id: number | string;
  message_id: number;
}

const modeFromEnv = process.env.TELEGRAM_MODE as TelegramAdapterMode | undefined;
const telegram = createTelegramAdapter({
  mode: modeFromEnv ?? "auto",
  longPolling: {
    allowedUpdates: ["message", "edited_message", "callback_query", "message_reaction"],
  },
});

const bot = new Chat<{ telegram: typeof telegram }, BotThreadState>({
  userName: process.env.BOT_USERNAME ?? "telegram-list-bot",
  adapters: {
    telegram,
  },
  state: createMemoryState(),
});

function upsertParticipant(participants: Participant[], incoming: Participant): Participant[] {
  const existing = participants.find((participant) => participant.userId === incoming.userId);
  if (existing) {
    return participants.map((participant) =>
      participant.userId === incoming.userId ? incoming : participant,
    );
  }

  return [...participants, incoming];
}

function removeParticipant(participants: Participant[], userId: string): Participant[] {
  return participants.filter((participant) => participant.userId !== userId);
}

function renderEventList(list: EventList): string {
  const lines: string[] = [list.title, ""];
  if (list.coming.length === 0) {
    lines.push("1. ");
  } else {
    list.coming.forEach((participant, index) => {
      lines.push(`${index + 1}. ${participant.displayName}`);
    });
  }

  return lines.join("\n");
}

function mentionDisplayName(user: { fullName: string; userName: string; userId: string }): string {
  return user.fullName || user.userName || user.userId;
}

async function pinTelegramMessage(raw: unknown): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return;
  }

  const target = raw as Partial<TelegramPinTarget> | undefined;
  if (!target?.chat_id || !target?.message_id) {
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/pinChatMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: target.chat_id,
      message_id: target.message_id,
      disable_notification: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`pinChatMessage failed (${response.status}): ${body}`);
  }
}

async function startWebhookServer(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);

  const server = createServer(async (req, res) => {
    if (!req.url || !req.method) {
      respond(res, 400, "Bad Request");
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      respond(res, 200, "ok");
      return;
    }

    if (req.method !== "POST" || req.url !== "/api/webhooks/telegram") {
      respond(res, 404, "Not Found");
      return;
    }

    try {
      const body = await readRequestBody(req);
      const request = new Request(
        `http://localhost:${port}/api/webhooks/telegram`,
        {
          method: "POST",
          headers: toHeaders(req),
          body: new Uint8Array(body),
        },
      );

      const response = await bot.webhooks.telegram(request);
      const responseBody = await response.text();
      respond(res, response.status, responseBody, Object.fromEntries(response.headers.entries()));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      respond(res, 500, message);
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, resolve);
  });

  console.log(`[telegram-list] webhook server listening on :${port}`);
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      headers.set(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    }
  }
  return headers;
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function respond(
  res: ServerResponse,
  statusCode: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "transfer-encoding") {
      continue;
    }
    res.setHeader(name, value);
  }
  res.statusCode = statusCode;
  res.end(body);
}

bot.onNewMessage(/^\/(?:list|event)(?:@\w+)?\s+(.+)$/i, async (thread, message) => {
  const title = message.text
    .replace(/^\/(?:list|event)(?:@\w+)?/i, "")
    .trim();
  if (!title) {
    await thread.post("Usage: /list <event name>");
    return;
  }

  const sent = await thread.post(
    renderEventList({
      title,
      coming: [],
    }),
  );

  const previousState = ((await thread.state) as BotThreadState | null) ?? { eventLists: {} };
  const nextState: BotThreadState = {
    eventLists: {
      ...previousState.eventLists,
      [sent.id]: {
        title,
        coming: [],
      },
    },
  };
  await thread.setState(nextState, { replace: true });

  try {
    await pinTelegramMessage(sent.raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[telegram-list] could not pin list message: ${message}`);
  }
});

bot.onReaction(async (event) => {
  if (event.user.isBot) {
    return;
  }

  // Simpler rule: any added reaction means "coming".
  if (!event.added) {
    return;
  }

  const state = (await event.thread.state) as BotThreadState | null;
  const targetList =
    state?.eventLists?.[event.messageId] ??
    (event.message?.id ? state?.eventLists?.[event.message.id] : undefined);
  if (!targetList) {
    return;
  }

  const participant: Participant = {
    userId: event.user.userId,
    displayName: mentionDisplayName(event.user),
  };

  const updatedList: EventList = {
    ...targetList,
    coming: upsertParticipant(removeParticipant(targetList.coming, participant.userId), participant),
  };

  const nextState: BotThreadState = {
    eventLists: {
      ...(state?.eventLists ?? {}),
      [event.messageId]: updatedList,
    },
  };

  if (event.message?.id && event.message.id !== event.messageId) {
    nextState.eventLists[event.message.id] = updatedList;
  }

  await event.thread.setState(nextState, { replace: true });
  await event.adapter.editMessage(event.threadId, event.messageId, renderEventList(updatedList));
});

async function main(): Promise<void> {
  await bot.initialize();
  console.log(`[telegram-list] adapter mode: ${telegram.runtimeMode}`);
  console.log("[telegram-list] command: /list <event name>");

  if (telegram.runtimeMode === "webhook") {
    await startWebhookServer();
    return;
  }

  console.log("[telegram-list] polling started.");
}

main().catch((error) => {
  console.error("[telegram-list] fatal error", error);
  process.exit(1);
});
