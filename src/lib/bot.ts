// src/lib/bot.ts
const BASE = '/api/bot';

async function request<T = unknown>(
  path: string,
  options: RequestInit = {},
  timeoutMs?: number,
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
  sessionId?: string, label?: string,
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
  attachment?: File,
): Promise<{ ok: boolean }> {
  const body: Record<string, unknown> = { phone, message };
  if (attachment) {
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload  = () => resolve((r.result as string).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(attachment);
    });
    body.attachment = { data, mimetype: attachment.type, filename: attachment.name };
  }
  return request('/send', { method: 'POST', body: JSON.stringify(body) }, 60_000);
}
/** Fetch chats — 5-minute timeout. */
export function botGetChats(): Promise<BotChat[]> {
  return request('/chats', {}, 300_000);
}
export function botGetMessages(chatId: string, limit = 30): Promise<BotMessage[]> {
  return request(`/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`);
}
/**
 * Resolve media for a message.
 * Returns a proxied URL: /api/bot/media/<msgId>
 * The bot server must implement GET /media/:msgId → binary stream.
 */
export function botMediaUrl(msgId: string): string {
  return `${BASE}/media/${encodeURIComponent(msgId)}`;
}

/**
 * Derive the phone number to pass to botSend.
 *
 * Priority order:
 *  1. chat.phone  — plain number already provided by the bot server (preferred)
 *  2. Strip the @-suffix from chat.id (e.g. 919876543210@c.us → "919876543210")
 *
 * Group chats: always return the full chat.id unchanged — the server routes
 * by chatId for groups, not a phone number.
 */
export function chatRecipient(chat: BotChat): string {
  if (chat.isGroup) return chat.id;
  // Prefer the explicit phone field if the server populated it
  if (chat.phone) return chat.phone;
  // Fallback: strip JID suffix (@c.us, @lid, @s.whatsapp.net, …)
  return chat.id.split('@')[0];
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
  /** Plain phone number returned by the bot server (e.g. "919876543210").
   *  Preferred over parsing the JID. Null when the server doesn't send it. */
  phone:         string | null;
  profilePicUrl: string | null;
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
  /** Populated by bot server when available */
  mediaUrl?: string | null;
  mimetype?: string | null;
  filename?: string | null;
}
