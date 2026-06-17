// src/app/components/WhatsAppLayout.tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  botGetChats, botGetMessages, botSend,
  botSwitch, botConnect, botLogout, botGetSessions,
  type BotChat, type BotMessage, type BotSession, type BotState,
} from '@/lib/bot';

// ─── Global themed scrollbar style ───────────────────────────────────────────
const SCROLLBAR_STYLE = `
  .wa-scroll::-webkit-scrollbar { width: 4px; height: 4px; }
  .wa-scroll::-webkit-scrollbar-track { background: transparent; }
  .wa-scroll::-webkit-scrollbar-thumb { background: #25d36640; border-radius: 9999px; }
  .wa-scroll::-webkit-scrollbar-thumb:hover { background: #25d366aa; }
  .wa-scroll { scrollbar-width: thin; scrollbar-color: #25d36640 transparent; }
`;

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmt(ts: number) {
  const d = new Date(ts * 1000), now = new Date();
  const today = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function initials(s: string) {
  return s.split(/[\s_\-]+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}
function isImageUrl(url: string) { return /\.(jpe?g|png|gif|webp|bmp|svg)(\?|$)/i.test(url); }
function isVideoUrl(url: string) { return /\.(mp4|webm|ogg|mov)(\?|$)/i.test(url); }
function isAudioUrl(url: string) { return /\.(mp3|ogg|wav|m4a|aac)(\?|$)/i.test(url); }
function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s<>"]+/g;
  return [...new Set(text.match(re) ?? [])];
}
function isLinkOnly(text: string) {
  return /^https?:\/\/[^\s]+$/.test(text.trim());
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name, isGroup = false, pic, size = 10 }: { name: string; isGroup?: boolean; pic?: string | null; size?: number }) {
  const [err, setErr] = useState(false);
  const abbr = isGroup ? '#' : initials(name);
  const cls  = `w-${size} h-${size} rounded-full flex-shrink-0`;
  if (pic && !err)
    return <img src={pic} alt={name} width={40} height={40} loading="lazy" onError={() => setErr(true)}
      className={`${cls} object-cover border border-white/10`} />;
  return (
    <div className={`${cls} bg-[#25d366]/15 border border-[#25d366]/20 flex items-center justify-center`}>
      <span className="text-[#25d366] text-xs font-semibold">{abbr}</span>
    </div>
  );
}

// ─── Uptime ───────────────────────────────────────────────────────────────────
function Uptime({ since }: { since: string }) {
  const [lbl, setLbl] = useState('');
  useEffect(() => {
    const tick = () => {
      const s = Math.floor((Date.now() - new Date(since).getTime()) / 1000);
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
      setLbl(h > 0 ? `${h}h ${String(m).padStart(2,'0')}m` : `${String(m).padStart(2,'0')}m ${String(ss).padStart(2,'0')}s`);
    };
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, [since]);
  return <span className="tabular-nums">{lbl}</span>;
}

// ─── LinkPreview ──────────────────────────────────────────────────────────────
function LinkPreview({ url }: { url: string }) {
  const domain = (() => { try { return new URL(url).hostname.replace('www.',''); } catch { return url; } })();
  const isYT = /youtu\.?be/.test(url);
  const ytId = isYT ? (url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] ?? null) : null;

  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="mt-1.5 flex items-center gap-2 bg-black/25 border border-white/8 rounded-xl overflow-hidden hover:border-[#25d366]/30 transition no-underline">
      {ytId ? (
        <img src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`} alt="thumbnail"
          width={80} height={45} loading="lazy" className="w-20 h-12 object-cover flex-shrink-0" />
      ) : (
        <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center bg-white/5 text-white/20">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </div>
      )}
      <div className="flex-1 min-w-0 py-2 pr-2">
        <p className="text-[10px] text-[#25d366]/70 truncate">{domain}</p>
        <p className="text-xs text-white/50 truncate">{url.length > 48 ? url.slice(0,48)+'…' : url}</p>
      </div>
    </a>
  );
}

// ─── MediaBubble: renders image / video / audio / file attachments ────────────
function MediaBubble({ msg }: { msg: BotMessage }) {
  const urls = extractUrls(msg.body ?? '');
  const textBody = msg.body?.trim() ?? '';
  const pureLink = isLinkOnly(textBody);

  // Determine media type from `type` field (image / video / audio / document / sticker / ptt)
  const t = msg.type;
  const isImg    = t === 'image' || t === 'sticker' || (t === 'chat' && urls.some(isImageUrl));
  const isVid    = t === 'video' || (t === 'chat' && urls.some(isVideoUrl));
  const isAud    = t === 'audio' || t === 'ptt';
  const isDoc    = t === 'document';

  // Pick first matched url for direct media rendering
  const imgUrl   = urls.find(isImageUrl);
  const vidUrl   = urls.find(isVideoUrl);
  const audUrl   = urls.find(isAudioUrl);
  const linkUrls = urls.filter(u => !isImageUrl(u) && !isVideoUrl(u) && !isAudioUrl(u));

  return (
    <div className="flex flex-col gap-1">
      {/* Image */}
      {(isImg && imgUrl) && (
        <a href={imgUrl} target="_blank" rel="noopener noreferrer">
          <img src={imgUrl} alt="image" loading="lazy" width={260}
            className="rounded-xl max-w-[260px] max-h-[220px] object-cover border border-white/8 hover:opacity-90 transition" />
        </a>
      )}
      {/* hasMedia image placeholder (no URL yet) */}
      {(isImg && !imgUrl && msg.hasMedia) && (
        <div className="w-[180px] h-[120px] rounded-xl bg-white/6 flex items-center justify-center text-white/20">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>
      )}
      {/* Video */}
      {(isVid && vidUrl) && (
        <video src={vidUrl} controls className="rounded-xl max-w-[260px] max-h-[200px] border border-white/8" />
      )}
      {(isVid && !vidUrl && msg.hasMedia) && (
        <div className="flex items-center gap-2 bg-white/6 rounded-xl px-3 py-2.5 w-[180px]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#25d366" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          <span className="text-xs text-white/40">Video</span>
        </div>
      )}
      {/* Audio / PTT */}
      {(isAud && audUrl) && (
        <audio src={audUrl} controls className="w-full max-w-[240px] h-9 rounded-full" />
      )}
      {(isAud && !audUrl && msg.hasMedia) && (
        <div className="flex items-center gap-2 bg-white/6 rounded-xl px-3 py-2.5 w-[180px]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#25d366" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>
          <span className="text-xs text-white/40">{msg.type === 'ptt' ? 'Voice note' : 'Audio'}</span>
        </div>
      )}
      {/* Document */}
      {(isDoc && msg.hasMedia) && (
        <div className="flex items-center gap-2.5 bg-white/6 border border-white/8 rounded-xl px-3 py-2.5 w-[200px]">
          <div className="w-9 h-9 rounded-lg bg-[#25d366]/15 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#25d366" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-white/70 truncate">{msg.body || 'Document'}</p>
            <p className="text-[10px] text-white/30">File</p>
          </div>
        </div>
      )}
      {/* Text body (skip if it's purely a media URL we already rendered) */}
      {textBody && !pureLink && !(isImg && isLinkOnly(textBody)) && (
        <p className="whitespace-pre-wrap break-words text-sm">{textBody}</p>
      )}
      {/* Link previews for non-media URLs */}
      {linkUrls.map(u => <LinkPreview key={u} url={u} />)}
    </div>
  );
}

// ─── Simple Emoji Picker ──────────────────────────────────────────────────────
const EMOJIS = [
  '😀','😂','🥰','😍','🤔','😅','😭','😡','🥺','🤣',
  '👍','👎','❤️','🔥','🎉','✅','⭐','💯','🙏','👏',
  '😊','🤗','😎','🥳','😴','🤝','💪','🫶','🫡','😇',
  '🤩','😏','😬','🤐','🥱','😤','😩','😓','🙄','😒',
];
function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);
  return (

    <div ref={ref}
      // Changed "left-0" to "right-0" below so it anchors to the right and prevents overflow
      className="absolute bottom-full mb-2 right-0 z-50 bg-[#1a1a1a] border border-white/10 rounded-2xl p-2 shadow-2xl w-[232px]">
      <div className="grid grid-cols-8 gap-0.5 wa-scroll overflow-y-auto max-h-[160px]">
        {EMOJIS.map(em => (
          <button key={em} onClick={() => { onPick(em); onClose(); }}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-lg hover:bg-white/8 transition select-none">
            {em}
          </button>
        ))}
      </div>
    </div>

  );
}

// ─── Session dropdown ─────────────────────────────────────────────────────────
const DOT: Record<string, string> = {
  connected: 'bg-[#25d366]', initializing: 'bg-amber-400', qr: 'bg-amber-400',
  authenticated: 'bg-amber-400', saved: 'bg-white/20', disconnected: 'bg-white/10',
};

function SessionDropdown({
  activeSession, refetchTrigger, onClose, onSwitchDone,
}: { activeSession: string | null; refetchTrigger: number; onClose: () => void; onSwitchDone: (id: string) => void }) {
  const [sessions, setSessions] = useState<BotSession[]>([]);
  const [busy, setBusy]         = useState<string | null>(null);
  const [err, setErr]           = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setErr(false);
    botGetSessions().then(setSessions).catch(() => setErr(true));
  }, [refetchTrigger]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const handleRow = async (s: BotSession) => {
    if (busy || s.clientId === activeSession) { onClose(); return; }
    setBusy(s.clientId);
    try {
      s.status === 'connected' ? await botSwitch(s.clientId) : await botConnect(s.clientId);
      onSwitchDone(s.clientId);
    } finally { setBusy(null); onClose(); }
  };

  const handleLogoutRow = async (e: React.MouseEvent, s: BotSession) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(`lo-${s.clientId}`);
    try { await botLogout(s.clientId); setSessions(p => p.filter(x => x.clientId !== s.clientId)); }
    finally { setBusy(null); }
  };

  return (
    <div ref={ref} className="absolute top-full left-0 mt-1 z-50 w-60 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
      <div className="px-4 pt-3 pb-1.5 border-b border-white/5">
        <p className="text-white/30 text-[10px] uppercase tracking-widest">Switch session</p>
      </div>
      <div className="flex flex-col py-1 max-h-60 overflow-y-auto wa-scroll">
        {err ? (
          <p className="text-red-400 text-xs text-center py-4">Failed to load</p>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col gap-1.5 p-3">
            {[1,2].map(i => <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />)}
          </div>
        ) : sessions.map(s => {
          const isActive = s.clientId === activeSession;
          return (
            <div key={s.clientId}
              className={`group flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-white/5 transition ${isActive ? 'bg-[#25d366]/5' : ''}`}
              onClick={() => handleRow(s)}
            >
              <span className="w-7 h-7 rounded-full bg-[#25d366]/15 text-[#25d366] text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                {initials(s.label) || '?'}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-white/80 truncate">{s.label}</span>
                <span className="block text-[10px] text-white/30">{s.phone ? `+${s.phone}` : s.status}</span>
              </span>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT[s.status] ?? 'bg-white/20'}`} />
              {isActive && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#25d366" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
              {!isActive && (
                <button onClick={e => handleLogoutRow(e, s)}
                  className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 text-xs p-1 transition">
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="border-t border-white/5 p-2">
        <a href="/connect" className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/35 hover:text-white hover:bg-white/5 rounded-lg transition">
          <span className="text-base">+</span> Add new session
        </a>
      </div>
    </div>
  );
}

// ─── New Message modal ────────────────────────────────────────────────────────
function NewMessageModal({ onClose }: { onClose: () => void }) {
  const [phone, setPhone]       = useState('');
  const [message, setMessage]   = useState('');
  const [attachment, setAttach] = useState<File | null>(null);
  const [sending, setSending]   = useState(false);
  const [result, setResult]     = useState<{ ok: boolean; msg: string } | null>(null);
  const [history, setHistory]   = useState<{ phone: string; preview: string; ok: boolean; at: Date }[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const fileRef    = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (overlayRef.current === e.target) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const send = async () => {
    const p = phone.replace(/\D/g, '');
    if (!p || !message.trim()) return;
    setSending(true); setResult(null);
    try {
      const data = await botSend(p, message.trim(), attachment ?? undefined);
      const ok = !!data.ok;
      setResult({ ok, msg: ok ? 'Message sent!' : ((data as never as { error?: string }).error ?? 'Send failed') });
      if (ok) {
        setHistory(h => [{ phone: p, preview: message.trim().slice(0, 40), ok: true, at: new Date() }, ...h.slice(0, 4)]);
        setMessage(''); setAttach(null); if (fileRef.current) fileRef.current.value = '';
      } else {
        setHistory(h => [{ phone: p, preview: message.trim().slice(0, 40), ok: false, at: new Date() }, ...h.slice(0, 4)]);
      }
    } catch { setResult({ ok: false, msg: 'Bot server unreachable' }); }
    finally { setSending(false); }
  };

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-md p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/80">New Message</h3>
          <button onClick={onClose} className="text-white/30 hover:text-white transition">✕</button>
        </div>

        {result && (
          <div className={`text-sm px-4 py-2 rounded-lg text-center ${
            result.ok ? 'bg-[#25d366]/15 text-[#25d366] border border-[#25d366]/20'
                      : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}>{result.msg}</div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-white/40">Phone Number</label>
          <input type="tel" value={phone}
            onChange={e => setPhone(e.target.value.replace(/\D/g,'').slice(0,15))}
            placeholder="919876543210"
            className="bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#25d366]/50 placeholder:text-white/20" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-white/40">Message</label>
          <div className="relative">
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4}
              placeholder="Type your message…"
              className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 pr-10 text-sm resize-none focus:outline-none focus:border-[#25d366]/50 placeholder:text-white/20 wa-scroll" />
            <div className="absolute bottom-2.5 right-2.5">
              {emojiOpen && <EmojiPicker onPick={em => setMessage(p => p + em)} onClose={() => setEmojiOpen(false)} />}
              <button onClick={() => setEmojiOpen(v => !v)} title="Emoji"
                className="text-white/30 hover:text-[#25d366] transition text-base leading-none">😊</button>
            </div>
          </div>
          <p className="text-xs text-white/20 text-right">{message.length} chars</p>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => fileRef.current?.click()}
            className="text-xs text-white/50 hover:text-white border border-white/10 hover:border-white/30 px-3 py-2 rounded-xl transition">+ Attachment</button>
          {attachment && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-white/40 truncate max-w-[120px]">{attachment.name}</span>
              <button onClick={() => { setAttach(null); if (fileRef.current) fileRef.current.value=''; }} className="text-white/20 hover:text-red-400 text-xs">×</button>
            </div>
          )}
          <input ref={fileRef} type="file" className="hidden" onChange={e => setAttach(e.target.files?.[0] ?? null)} />
        </div>

        <button onClick={send} disabled={sending || !phone.replace(/\D/g,'') || !message.trim()}
          className="w-full bg-[#25d366] hover:bg-[#1ebe5d] disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold py-2.5 rounded-xl transition text-sm">
          {sending ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />Sending…</span> : 'Send'}
        </button>

        {history.length > 0 && (
          <div className="border-t border-white/5 pt-3 flex flex-col gap-2">
            <p className="text-xs text-white/30 uppercase tracking-widest">Recent</p>
            {history.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${h.ok ? 'bg-[#25d366]' : 'bg-red-400'}`} />
                <span className="text-white/50 font-mono flex-shrink-0">+{h.phone}</span>
                <span className="text-white/30 truncate">{h.preview}</span>
                <span className="text-white/20 flex-shrink-0 ml-auto tabular-nums">{h.at.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main layout ──────────────────────────────────────────────────────────────
interface Props {
  botState: BotState;
  sessionsVersion: number;
  onLogout: () => Promise<void>;
  onSwitch: (clientId: string) => void;
}

export default function WhatsAppLayout({ botState, sessionsVersion, onLogout, onSwitch }: Props) {
  // Chats
  const [chats,        setChats]        = useState<BotChat[]>([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [chatsError,   setChatsError]   = useState<string | null>(null);
  const [search,       setSearch]       = useState('');

  // Thread
  const [selected,    setSelected]    = useState<BotChat | null>(null);
  const [messages,    setMessages]    = useState<BotMessage[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [msgsError,   setMsgsError]   = useState<string | null>(null);

  // Compose
  const [compose,     setCompose]     = useState('');
  const [composeFile, setComposeFile] = useState<File | null>(null);
  const [sending,     setSending]     = useState(false);
  const [emojiOpen,   setEmojiOpen]   = useState(false);
  const composeFileRef = useRef<HTMLInputElement>(null);
  const bottomRef      = useRef<HTMLDivElement>(null);

  // Session dropdown
  const [ddOpen,         setDdOpen]         = useState(false);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const [loggingOut,     setLoggingOut]     = useState(false);

  // New message modal
  const [newMsgOpen, setNewMsgOpen] = useState(false);

  // ── Load chats
  const loadChats = useCallback(async () => {
    setChatsLoading(true); setChatsError(null);
    setSelected(null); setMessages([]);
    try { setChats(await botGetChats()); }
    catch (e) { setChatsError(e instanceof Error ? e.message : 'Failed'); }
    finally { setChatsLoading(false); }
  }, []);

  useEffect(() => { if (botState.activeSession) loadChats(); }, [botState.activeSession, loadChats]);
  useEffect(() => { setRefetchTrigger(n => n + 1); }, [sessionsVersion]);

  // ── Open chat thread
  const openChat = useCallback(async (chat: BotChat) => {
    setSelected(chat); setMessages([]); setMsgsError(null); setMsgsLoading(true);
    try { setMessages(await botGetMessages(chat.id, 30)); }
    catch (e) { setMsgsError(e instanceof Error ? e.message : 'Failed'); }
    finally { setMsgsLoading(false); }
  }, []);

  useEffect(() => {
    if (!msgsLoading) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, msgsLoading]);

  // ── In-thread send
  const sendInThread = async () => {
    if (!selected || !compose.trim() || sending) return;
    const phone = selected.id.split('@')[0];
    setSending(true);
    try {
      await botSend(phone, compose.trim(), composeFile ?? undefined);
      setMessages(p => [...p, {
        id: `local-${Date.now()}`, body: compose.trim(), fromMe: true,
        author: null, timestamp: Math.floor(Date.now() / 1000), hasMedia: false, type: 'chat',
      }]);
      setCompose(''); setComposeFile(null); if (composeFileRef.current) composeFileRef.current.value = '';
    } catch { /* silent */ }
    finally { setSending(false); }
  };

  const handleComposeKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInThread(); }
  };

  // ── Session header
  const displayLabel = botState.label || botState.name || botState.activeSession || '—';
  const handleOpenDd = useCallback(() => {
    setDdOpen(v => { if (!v) setRefetchTrigger(n => n + 1); return !v; });
  }, []);
  const handleLogout = async () => { setLoggingOut(true); try { await onLogout(); } finally { setLoggingOut(false); } };

  const filtered = chats.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      {/* Inject themed scrollbar CSS once */}
      <style dangerouslySetInnerHTML={{ __html: SCROLLBAR_STYLE }} />

      <div className="flex h-screen bg-[#111] text-white overflow-hidden">

        {/* ── LEFT SIDEBAR ─────────────────────────────────── */}
        <aside className="w-[340px] flex-shrink-0 flex flex-col border-r border-white/8 bg-[#111]">

          {/* Session header */}
          <div className="flex items-center gap-2 px-3 py-3 border-b border-white/8">
            <div className="relative flex-1 min-w-0">
              <button onClick={handleOpenDd}
                className="flex items-center gap-2 w-full bg-white/4 hover:bg-white/8 border border-white/8 rounded-xl pl-2 pr-3 py-2 transition">
                <Avatar name={displayLabel} size={8} />
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-white/80 truncate leading-none">{displayLabel}</p>
                  {botState.connectedAt ? (
                    <p className="text-[10px] text-white/30 mt-0.5 truncate">
                      <Uptime since={botState.connectedAt} />
                      {botState.phone && <> · +{botState.phone}</>}
                    </p>
                  ) : (
                    <p className="text-[10px] text-[#25d366] mt-0.5">Connected</p>
                  )}
                </div>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className={`text-white/30 transition-transform ${ddOpen ? 'rotate-180' : ''}`}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {ddOpen && (
                <SessionDropdown
                  activeSession={botState.activeSession}
                  refetchTrigger={refetchTrigger}
                  onClose={() => setDdOpen(false)}
                  onSwitchDone={id => { onSwitch(id); setDdOpen(false); }}
                />
              )}
            </div>

            <button onClick={() => setNewMsgOpen(true)} title="New message"
              className="w-8 h-8 flex items-center justify-center rounded-xl text-white/40 hover:text-[#25d366] hover:bg-white/6 border border-white/8 transition">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </button>
            <button onClick={handleLogout} disabled={loggingOut} title="Logout"
              className="w-8 h-8 flex items-center justify-center rounded-xl text-white/40 hover:text-red-400 hover:bg-white/6 border border-white/8 disabled:opacity-40 transition">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-white/5">
            <div className="relative">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search or start new chat"
                className="w-full bg-[#1a1a1a] border border-white/8 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-[#25d366]/40 placeholder:text-white/20" />
            </div>
          </div>

          {/* Chat list */}
          <div className="flex-1 overflow-y-auto wa-scroll">
            {chatsLoading && (
              <div className="flex flex-col gap-0">
                {Array.from({length:8}).map((_,i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-3">
                    <div className="w-10 h-10 rounded-full bg-white/5 animate-pulse flex-shrink-0" />
                    <div className="flex-1 flex flex-col gap-1.5">
                      <div className="h-3 bg-white/5 rounded animate-pulse w-2/3" />
                      <div className="h-2.5 bg-white/5 rounded animate-pulse w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {chatsError && (
              <div className="p-4 text-center">
                <p className="text-red-400 text-xs mb-3">{chatsError}</p>
                <button onClick={loadChats} className="text-xs text-white/40 hover:text-white border border-white/10 px-3 py-1.5 rounded-lg transition">Retry</button>
              </div>
            )}
            {!chatsLoading && !chatsError && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-white/20">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                <span className="text-xs">{search ? 'No matches' : 'No chats'}</span>
              </div>
            )}
            {!chatsLoading && !chatsError && filtered.map(chat => (
              <button key={chat.id} onClick={() => openChat(chat)}
                className={`w-full flex items-center gap-3 px-3 py-3 hover:bg-white/4 transition text-left border-b border-white/4 ${
                  selected?.id === chat.id ? 'bg-[#25d366]/6' : ''
                }`}>
                <Avatar name={chat.name} isGroup={chat.isGroup} pic={chat.profilePicUrl} size={10} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm text-white/80 font-medium truncate">{chat.name}</span>
                    {chat.timestamp && <span className="text-[10px] text-white/25 flex-shrink-0 tabular-nums">{fmt(chat.timestamp)}</span>}
                  </div>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <p className="text-xs text-white/35 truncate">
                      {chat.lastMessage
                        ? (chat.lastMessage.fromMe ? 'You: ' : '') +
                          (chat.lastMessage.hasMedia && !chat.lastMessage.body ? '📎 Media' : chat.lastMessage.body || '—')
                        : '—'}
                    </p>
                    {chat.unreadCount > 0 && (
                      <span className="flex-shrink-0 min-w-[18px] h-[18px] bg-[#25d366] text-black text-[10px] font-bold rounded-full flex items-center justify-center px-1 tabular-nums">
                        {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* ── RIGHT MAIN ───────────────────────────────────── */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#0d0d0d]">

          {selected ? (
            <>
              {/* Thread header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-white/8 bg-[#111]">
                <button onClick={() => setSelected(null)} className="text-white/30 hover:text-white transition md:hidden">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 12H5M12 5l-7 7 7 7" />
                  </svg>
                </button>
                <Avatar name={selected.name} isGroup={selected.isGroup} pic={selected.profilePicUrl} size={10} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white/90 truncate">{selected.name}</p>
                  <p className="text-[10px] text-white/30">{selected.isGroup ? 'Group' : 'Contact'}</p>
                </div>
                <button onClick={() => openChat(selected)} title="Refresh messages"
                  className="text-white/25 hover:text-white transition">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    className={msgsLoading ? 'animate-spin' : ''}>
                    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                  </svg>
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto wa-scroll px-4 py-3 flex flex-col gap-1.5"
                style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.02) 1px, transparent 0)', backgroundSize: '24px 24px' }}>
                {msgsLoading && (
                  <div className="flex flex-col gap-3">
                    {Array.from({length:5}).map((_,i) => (
                      <div key={i} className={`flex ${i%2===0?'justify-start':'justify-end'}`}>
                        <div className="h-9 w-44 bg-white/5 rounded-2xl animate-pulse" />
                      </div>
                    ))}
                  </div>
                )}
                {msgsError && <p className="text-red-400 text-xs text-center mt-8">{msgsError}</p>}
                {!msgsLoading && !msgsError && messages.length === 0 && (
                  <p className="text-white/20 text-xs text-center mt-12">No messages</p>
                )}
                {!msgsLoading && messages.map(msg => {
                  const time = new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const hasRichContent = msg.hasMedia || (msg.type !== 'chat') || extractUrls(msg.body ?? '').length > 0;
                  return (
                    <div key={msg.id} className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[72%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                        msg.fromMe ? 'bg-[#25d366]/25 text-white rounded-br-sm' : 'bg-white/8 text-white/80 rounded-bl-sm'
                      }`}>
                        {hasRichContent
                          ? <MediaBubble msg={msg} />
                          : msg.body && <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                        }
                        <p className={`text-[10px] mt-1 ${msg.fromMe ? 'text-white/40 text-right' : 'text-white/30'}`}>{time}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* Compose bar */}
              <div className="border-t border-white/8 bg-[#111] px-3 py-2.5 flex items-end gap-2">
                {/* Attachment */}
                <button onClick={() => composeFileRef.current?.click()} title="Attach file"
                  className="w-8 h-8 flex items-center justify-center rounded-full text-white/30 hover:text-white hover:bg-white/8 transition flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <input ref={composeFileRef} type="file" className="hidden" onChange={e => setComposeFile(e.target.files?.[0] ?? null)} />

                {/* Text area + emoji */}
                <div className="flex-1 flex flex-col min-w-0 relative">
                  {composeFile && (
                    <div className="flex items-center gap-2 mb-1.5 bg-white/5 rounded-lg px-2.5 py-1">
                      <span className="text-xs text-white/50 truncate">{composeFile.name}</span>
                      <button onClick={() => { setComposeFile(null); if (composeFileRef.current) composeFileRef.current.value=''; }}
                        className="text-white/20 hover:text-red-400 text-xs">×</button>
                    </div>
                  )}
                  <textarea value={compose} onChange={e => setCompose(e.target.value)} onKeyDown={handleComposeKey}
                    rows={1} placeholder="Type a message"
                    className="w-full bg-transparent text-sm text-white/80 placeholder:text-white/25 resize-none focus:outline-none max-h-32 overflow-y-auto wa-scroll leading-relaxed pr-8"
                    style={{ minHeight: '24px' }}
                    onInput={e => { const el = e.currentTarget; el.style.height='auto'; el.style.height=`${Math.min(el.scrollHeight,128)}px`; }}
                  />
                  {/* Emoji toggle */}
                  <div className="absolute right-0 bottom-0">
                    {emojiOpen && (
                      <EmojiPicker
                        onPick={em => setCompose(p => p + em)}
                        onClose={() => setEmojiOpen(false)}
                      />
                    )}
                    <button onClick={() => setEmojiOpen(v => !v)} title="Emoji"
                      className={`text-base leading-none transition ${emojiOpen ? 'text-[#25d366]' : 'text-white/25 hover:text-[#25d366]'}`}>
                      😊
                    </button>
                  </div>
                </div>

                {/* Send */}
                <button onClick={sendInThread} disabled={sending || !compose.trim()}
                  title="Send" className="w-9 h-9 flex items-center justify-center rounded-full bg-[#25d366] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#1ebe5d] transition flex-shrink-0">
                  {sending
                    ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  }
                </button>
              </div>
            </>
          ) : (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-white/20">
              <div className="w-20 h-20 rounded-full border-2 border-white/10 flex items-center justify-center">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-white/30">WhatsApp Bot</p>
                <p className="text-xs text-white/20 mt-1">Select a chat to start messaging</p>
                <button onClick={() => setNewMsgOpen(true)}
                  className="mt-4 text-xs text-[#25d366]/70 hover:text-[#25d366] border border-[#25d366]/20 hover:border-[#25d366]/40 px-4 py-2 rounded-xl transition">
                  ✏ New Message
                </button>
              </div>
            </div>
          )}
        </main>

        {/* New Message modal */}
        {newMsgOpen && <NewMessageModal onClose={() => setNewMsgOpen(false)} />}
      </div>
    </>
  );
}
