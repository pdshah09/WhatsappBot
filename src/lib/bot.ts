// src/lib/bot.ts
const BASE = '/api/bot';

async function request<T = unknown>(
  path: string,
  options: RequestInit = {},
  timeoutMs?: number
): Promise<T> {
  const controller = timeoutMs ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      signal: controller?.signal,
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || String(res.status));
    try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function botStatus(): Promise<BotState & { status: string }> {
  return request('/status');
}

export function botGetSessions(): Promise<BotSession[]> {
  return request('/sessions');
}

export function botConnect(
  sessionId?: string,
  label?: string
): Promise<{ ok: boolean; status: string; activeSession: string; isRestore: boolean }> {
  return request('/connect', { method: 'POST', body: JSON.stringify({ sessionId, label }) });
}

export function botSwitch(sessionId: string): Promise<BotState & { ok: boolean }> {
  return request('/switch', { method: 'POST', body: JSON.stringify({ sessionId }) });
}

export function botLogout(sessionId?: string): Promise<{ ok: boolean }> {
  return request('/logout', { method: 'POST', body: JSON.stringify({ sessionId }) });
}

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

/** Fetch chats — 2-minute timeout (getChats can be slow on large accounts). */
export function botGetChats(): Promise<BotChat[]> {
  return request('/chats', {}, 120_000);
}

export function botGetMessages(chatId: string, limit = 20): Promise<BotMessage[]> {
  return request(`/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BotSession {
  clientId:    string;
  sessionName: string;
  label:       string;
  phone:       string | null;
  name:        string | null;
  status:      string;
}

export interface BotState {
  status:        string;
  qr:            string | null;
  connectedAt:   string | null;
  activeSession: string | null;
  phone:         string | null;
  name:          string | null;
  label:         string | null;
}

export interface BotChat {
  id:            string;
  name:          string;
  isGroup:       boolean;
  unreadCount:   number;
  timestamp:     number;
  profilePicUrl: string | null;   // ← added
  lastMessage: {
    body: string; fromMe: boolean; timestamp: number; hasMedia: boolean;
  } | null;
}

export interface BotMessage {
  id:        string;
  body:      string;
  fromMe:    boolean;
  author:    string | null;
  timestamp: number;
  hasMedia:  boolean;
  type:      string;
}
