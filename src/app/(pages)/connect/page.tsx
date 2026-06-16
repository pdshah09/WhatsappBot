// src/app/(pages)/connect/page.tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { botConnect, botGetSessions, type BotSession } from '@/lib/bot';

// ─── helpers ──────────────────────────────────────────────────────────────────
function initials(label: string): string {
  return label
    .split(/[\s_\-]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

const STATUS_COLOR: Record<string, string> = {
  connected:    'bg-[#25d366]',
  initializing: 'bg-amber-400',
  qr:           'bg-amber-400',
  authenticated:'bg-amber-400',
  saved:        'bg-white/20',
  disconnected: 'bg-white/10',
};

const STATUS_LABEL: Record<string, string> = {
  connected:    'Connected',
  initializing: 'Starting…',
  qr:           'Scan QR',
  authenticated:'Authenticated',
  saved:        'Saved',
  disconnected: 'Disconnected',
};

// ─── WhatsApp logo SVG ────────────────────────────────────────────────────────
function WhatsAppLogo() {
  return (
    <svg viewBox="0 0 48 48" width="48" height="48" fill="none">
      <circle cx="24" cy="24" r="24" fill="#25d366" />
      <path
        fill="white"
        d="M24 10C16.27 10 10 16.27 10 24c0 2.49.67 4.83 1.82 6.85L10 38l7.36-1.8A13.93
           13.93 0 0024 38c7.73 0 14-6.27 14-14S31.73 10 24 10zm7.07 19.43c-.3.84-1.74
           1.62-2.4 1.72-.62.1-1.41.14-2.27-.14-.52-.17-1.19-.39-2.05-.77-3.6-1.56-5.95
           -5.18-6.13-5.42-.18-.24-1.47-1.96-1.47-3.74s.93-2.65 1.26-3.01c.33-.36.72-.45
           .96-.45h.69c.22 0 .52-.08.81.62.3.72 1.02 2.5 1.11 2.68.09.18.15.39.03.63
           -.12.24-.18.39-.36.6-.18.21-.38.47-.54.63-.18.18-.37.37-.16.73.21.36.93 1.53
           2 2.48 1.37 1.22 2.53 1.6 2.89 1.78.36.18.57.15.78-.09.21-.24.9-1.05
           1.14-1.41.24-.36.48-.3.81-.18.33.12 2.1.99 2.46 1.17.36.18.6.27.69.42.09.15
           .09.87-.21 1.71z"
      />
    </svg>
  );
}

// ─── Session row ──────────────────────────────────────────────────────────────
function SessionRow({
  session,
  loading,
  onClick,
}: {
  session: BotSession;
  loading: boolean;
  onClick: () => void;
}) {
  const chip = initials(session.label);
  const dot  = STATUS_COLOR[session.status] ?? 'bg-white/20';
  const tag  = STATUS_LABEL[session.status] ?? session.status;

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="
        w-full flex items-center gap-3 px-4 py-3
        rounded-xl border border-white/8
        bg-white/[0.03] hover:bg-[#25d366]/10 hover:border-[#25d366]/40
        transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed
        text-left group
      "
    >
      {/* Avatar */}
      <span className="w-9 h-9 rounded-full bg-[#25d366]/15 text-[#25d366] text-xs font-bold flex items-center justify-center flex-shrink-0">
        {chip || '?'}
      </span>

      {/* Info */}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-white/90 truncate leading-tight">
          {session.label}
        </span>
        <span className="block text-[11px] text-white/35 mt-0.5 truncate">
          {session.phone ? `+${session.phone}` : tag}
        </span>
      </span>

      {/* Status dot */}
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />

      {/* Arrow */}
      <span className="text-white/20 group-hover:text-[#25d366] text-sm transition-colors flex-shrink-0">
        →
      </span>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ConnectPage() {
  const router = useRouter();

  const [sessions, setSessions] = useState<BotSession[]>([]);
  const [fetching, setFetching] = useState(true);
  const [loading,  setLoading]  = useState<string | null>(null); // clientId being loaded
  const [error,    setError]    = useState<string | null>(null);

  // Refresh session list
  const refresh = useCallback(() => {
    setFetching(true);
    botGetSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setFetching(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Handle restore or new connect ──────────────────────────────────────────
  const handleConnect = async (sessionId?: string) => {
    const key = sessionId ?? '__new__';
    setLoading(key);
    setError(null);
    try {
      const data = await botConnect(sessionId);
      if (sessionId || data.status === 'connected') {
        // Restoring an existing session → wait for SSE ready → /session
        router.push('/session');
      } else {
        // New session → show QR
        router.push('/qr');
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Cannot reach the bot server. Is it running?'
      );
      setLoading(null);
    }
  };

  // ── Redirect if a session is already connected ──────────────────────────────
  useEffect(() => {
    if (sessions.some((s) => s.status === 'connected')) {
      router.replace('/session');
    }
  }, [sessions, router]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-6">
      <div className="bg-[#111] border border-white/10 rounded-2xl p-8 w-full max-w-sm flex flex-col items-center gap-6 shadow-2xl">

        {/* Header */}
        <WhatsAppLogo />
        <div className="text-center -mt-2">
          <h1 className="text-lg font-semibold tracking-tight">Connect your session</h1>
          <p className="text-white/35 text-sm mt-1">Link your WhatsApp to get started</p>
        </div>

        {/* Error */}
        {error && (
          <div className="w-full bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3">
            <p className="text-red-400 text-sm text-center">{error}</p>
          </div>
        )}

        {/* Saved sessions */}
        {fetching ? (
          <div className="w-full flex flex-col gap-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-[60px] rounded-xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : sessions.length > 0 ? (
          <div className="w-full flex flex-col gap-2">
            <p className="text-white/30 text-[10px] uppercase tracking-widest">Saved sessions</p>
            {sessions.map((s) => (
              <SessionRow
                key={s.clientId}
                session={s}
                loading={loading !== null}
                onClick={() => handleConnect(s.clientId)}
              />
            ))}
            {/* Divider */}
            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-white/20 text-[11px]">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
          </div>
        ) : null}

        {/* Connect new */}
        <button
          onClick={() => handleConnect()}
          disabled={loading !== null}
          className="
            w-full flex items-center justify-center gap-2
            bg-[#25d366] hover:bg-[#1ebe5d] active:bg-[#17a34a]
            disabled:opacity-50 disabled:cursor-not-allowed
            text-black font-semibold py-3 rounded-xl
            transition-colors duration-150
          "
        >
          {loading === '__new__' ? (
            <>
              <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              Starting…
            </>
          ) : (
            <><span className="text-base leading-none mr-0.5">+</span> CONNECT NEW</>
          )}
        </button>

        <p className="text-white/20 text-[11px] text-center -mt-2">
          Opens WhatsApp QR scan
        </p>
      </div>
    </div>
  );
}
