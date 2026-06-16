// src/lib/bot.ts
const BASE = "/api/bot";

/** Start or restore a session. Pass sessionId (raw doc id) to restore, omit for new QR. */
export async function botConnect(sessionId?: string): Promise<Response> {
  return fetch(`${BASE}/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: sessionId ? JSON.stringify({ sessionId }) : undefined,
  });
}

/** Switch the active session without disconnecting others. */
export async function botSwitch(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const res  = await fetch(`${BASE}/switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  return res.json().catch(() => ({ ok: false }));
}

/** Logout a specific session, or the active one if omitted. */
export async function botLogout(sessionId?: string): Promise<Response> {
  return fetch(`${BASE}/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: sessionId ? JSON.stringify({ sessionId }) : undefined,
  });
}

export async function botSend(
  phone: string,
  message: string,
  attachment?: File
): Promise<{ ok: boolean; error?: string }> {
  const body: Record<string, unknown> = { phone, message };
  if (attachment) {
    const data = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve((r.result as string).split(",")[1]);
      r.readAsDataURL(attachment);
    });
    body.attachment = { data, mimetype: attachment.type, filename: attachment.name };
  }
  const res = await fetch(`${BASE}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ ok: false }));
}

/** List all saved sessions from MongoDB + in-memory running sessions. */
export async function botGetSessions(): Promise<BotSession[]> {
  const res = await fetch(`${BASE}/sessions`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json().catch(() => []);
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

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BotSession {
  id: string;       // raw doc id: "RemoteAuth" | "RemoteAuth-work"
  clientId: string; // stripped: "RemoteAuth" | "work"
  label: string;    // human: "Default" | "work"
  status: string;   // "saved" | "connected" | "initializing" | "qr" | ...
}

export interface BotState {
  status: string;
  qr: string | null;
  connectedAt: string | null;
  activeSession: string | null;
  phone: string | null;
  name: string | null;
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
