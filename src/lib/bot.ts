// src/lib/bot.ts
const BASE = "/api/bot";

export const botConnect = () => fetch(`${BASE}/connect`, { method: "POST" });
export const botLogout  = () => fetch(`${BASE}/logout`,  { method: "POST" });

export async function botSend(
  phone: string,
  message: string,
  attachment?: File
): Promise<{ ok: boolean; error?: string }> {
  const body: Record<string, unknown> = { phone, message };
  if (attachment) {
    const data = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res((r.result as string).split(",")[1]);
      r.readAsDataURL(attachment);
    });
    body.attachment = { data, mimetype: attachment.type, filename: attachment.name };
  }
  const res = await fetch(`${BASE}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, ...json };
}

export async function botGetChats(): Promise<BotChat[]> {
  const res = await fetch(`${BASE}/chats`, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function botGetMessages(chatId: string, limit = 20): Promise<BotMessage[]> {
  const res = await fetch(
    `${BASE}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface BotChat {
  id: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
  timestamp: number;
  lastMessage: {
    body: string;
    fromMe: boolean;
    timestamp: number;
    hasMedia: boolean;
  } | null;
}

export interface BotMessage {
  id: string;
  body: string;
  fromMe: boolean;
  author: string | null;
  timestamp: number;
  hasMedia: boolean;
  type: string;
}
