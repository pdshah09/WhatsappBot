// src/lib/bot.ts
const BASE = '/api/bot';

async function request<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || String(res.status));
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

/** Get current bot state (status, qr, phone, etc.) */
export function botStatus(): Promise<BotState & { status: string }> {
  return request('/status');
}

/** List all sessions: saved in MongoDB + running in memory. */
export function botGetSessions(): Promise<BotSession[]> {
  return request('/sessions');
}

/**
 * Connect or restore a session.
 * @param sessionId  clientId to restore ("RemoteAuth" | "work"). Omit for new QR.
 * @param label      Optional display name for new sessions.
 */
export function botConnect(
  sessionId?: string,
  label?: string
): Promise<{ ok: boolean; status: string; activeSession: string; isRestore: boolean }> {
  return request('/connect', {
    method: 'POST',
    body: JSON.stringify({ sessionId, label }),
  });
}

/** Switch active session (must already be running in memory). */
export function botSwitch(
  sessionId: string
): Promise<BotState & { ok: boolean }> {
  return request('/switch', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

/** Logout + delete session from MongoDB. */
export function botLogout(sessionId?: string): Promise<{ ok: boolean }> {
  return request('/logout', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

/** Send a message from the active session. */
export async function botSend(
  phone: string,
  message: string,
  attachment?: File
): Promise<{ ok: boolean }> {
  const body: Record<string, unknown> = { phone, message };
  if (attachment) {
    const data = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload  = () => resolve((r.result as string).split(',')[1]);
      r.readAsDataURL(attachment);
    });
    body.attachment = { data, mimetype: attachment.type, filename: attachment.name };
  }
  return request('/send', { method: 'POST', body: JSON.stringify(body) });
}

/** Fetch chats for the active session. */
export function botGetChats(): Promise<BotChat[]> {
  return request('/chats');
}

/** Fetch messages for a chat in the active session. */
export function botGetMessages(chatId: string, limit = 20): Promise<BotMessage[]> {
  return request(`/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BotSession {
  clientId:    string;   // map key: "RemoteAuth" | "work"
  sessionName: string;   // wwebjs doc id: "RemoteAuth" | "RemoteAuth-work"
  label:       string;   // display: WA pushname or custom
  phone:       string | null;
  name:        string | null;
  status:      string;   // "saved" | "connected" | "initializing" | "qr" | "disconnected"
}

export interface BotState {
  status:       string;
  qr:           string | null;
  connectedAt:  string | null;
  activeSession: string | null;
  phone:        string | null;
  name:         string | null;
  label:        string | null;
}

export interface BotChat {
  id:          string;
  name:        string;
  isGroup:     boolean;
  unreadCount: number;
  timestamp:   number;
  lastMessage: {
    body: string; fromMe: boolean; timestamp: number; hasMedia: boolean;
  } | null;
}

export interface BotMessage {
  id:       string;
  body:     string;
  fromMe:   boolean;
  author:   string | null;
  timestamp: number;
  hasMedia: boolean;
  type:     string;
}
