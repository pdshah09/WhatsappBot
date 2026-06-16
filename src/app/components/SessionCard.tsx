// src/app/components/SessionCard.tsx
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { botGetSessions, botSwitch, botConnect, botLogout, type BotSession } from '@/lib/bot';

interface Props {
  connectedAt:     string | null;
  activeSession:   string | null;
  phone:           string | null;
  name:            string | null;
  label:           string | null;
  onLogout:        () => Promise<void>;
  onSwitch:        (clientId: string) => void;
  /** Incrementing this causes the dropdown to refetch /sessions */
  sessionsVersion: number;
}

function initials(label: string): string {
  return label
    .split(/[\s_\-]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function Uptime({ since }: { since: string }) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    function tick() {
      const diff = Math.floor((Date.now() - new Date(since).getTime()) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setLabel(
        h > 0
          ? `${h}h ${String(m).padStart(2, '0')}m`
          : `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [since]);
  return <span className="tabular-nums">{label}</span>;
}

const DOT: Record<string, string> = {
  connected:     'bg-[#25d366]',
  initializing:  'bg-amber-400',
  qr:            'bg-amber-400',
  authenticated: 'bg-amber-400',
  saved:         'bg-white/20',
  disconnected:  'bg-white/10',
};

const TAG: Record<string, string> = {
  connected:     'Connected',
  initializing:  'Starting…',
  qr:            'Scan QR',
  authenticated: 'Authenticating…',
  saved:         'Saved',
  disconnected:  'Disconnected',
};

// ─── Session dropdown ─────────────────────────────────────────────────────────
function SessionDropdown({
  activeSession,
  refetchTrigger,
  onClose,
  onSwitchDone,
}: {
  activeSession:  string | null;
  refetchTrigger: number;
  onClose:        () => void;
  onSwitchDone:   (clientId: string) => void;
}) {
  const [sessions, setSessions] = useState<BotSession[]>([]);
  const [busy,     setBusy]     = useState<string | null>(null);
  const [fetchErr, setFetchErr] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Refetch whenever dropdown opens OR server signals sessions_changed (via refetchTrigger)
  useEffect(() => {
    setFetchErr(false);
    botGetSessions()
      .then(setSessions)
      .catch(() => setFetchErr(true));
  }, [refetchTrigger]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleRow = useCallback(async (s: BotSession) => {
    if (busy) return;
    if (s.clientId === activeSession) { onClose(); return; }
    setBusy(s.clientId);
    try {
      if (s.status === 'connected') {
        await botSwitch(s.clientId);
      } else {
        await botConnect(s.clientId);
      }
      onSwitchDone(s.clientId);
    } finally {
      setBusy(null);
      onClose();
    }
  }, [busy, activeSession, onSwitchDone, onClose]);

  const handleLogoutRow = useCallback(async (e: React.MouseEvent, s: BotSession) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(`logout-${s.clientId}`);
    try {
      await botLogout(s.clientId);
      setSessions((prev) => prev.filter((x) => x.clientId !== s.clientId));
    } finally {
      setBusy(null);
    }
  }, [busy]);

  return (
    <div
      ref={panelRef}
      className="absolute top-full left-0 mt-2 z-50 w-64 bg-[#161616] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
    >
      <div className="px-4 pt-3 pb-1.5 border-b border-white/5">
        <p className="text-white/30 text-[10px] uppercase tracking-widest">Switch session</p>
      </div>

      <div className="flex flex-col py-1 max-h-64 overflow-y-auto">
        {fetchErr ? (
          <p className="text-red-400 text-xs text-center py-4 px-3">Failed to load sessions</p>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col gap-1.5 p-3">
            {[1, 2].map((i) => <div key={i} className="h-10 rounded-xl bg-white/5 animate-pulse" />)}
          </div>
        ) : (
          sessions.map((s) => {
            const isActive = s.clientId === activeSession;
            const isBusy   = busy === s.clientId;
            const chip = initials(s.label);
            const dot  = DOT[s.status] ?? 'bg-white/20';
            const tag  = TAG[s.status] ?? s.status;

            return (
              <div
                key={s.clientId}
                className={`group flex items-center gap-3 px-3 py-2.5 cursor-pointer transition hover:bg-white/5 ${
                  isActive ? 'bg-[#25d366]/5' : ''
                }`}
                onClick={() => handleRow(s)}
              >
                <span className="w-7 h-7 rounded-full bg-[#25d366]/15 text-[#25d366] text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                  {chip || '?'}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-white/80 truncate leading-tight">{s.label}</span>
                  <span className="block text-[10px] text-white/30 truncate">
                    {s.phone ? `+${s.phone}` : tag}
                  </span>
                </span>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                {isBusy ? (
                  <span className="w-3 h-3 border border-white/20 border-t-white/70 rounded-full animate-spin" />
                ) : isActive ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#25d366" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
                {!isActive && !isBusy && (
                  <button
                    title="Logout this session"
                    onClick={(e) => handleLogoutRow(e, s)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-white/20 hover:text-red-400 text-xs leading-none p-1"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add new session — navigates to /connect, no auto-pass to /session */}
      <div className="border-t border-white/5 p-2">
        <a
          href="/connect"
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/35 hover:text-white hover:bg-white/5 rounded-xl transition"
        >
          <span className="text-base leading-none">+</span>
          Add new session
        </a>
      </div>
    </div>
  );
}

// ─── SessionCard ──────────────────────────────────────────────────────────────
export default function SessionCard({
  connectedAt, activeSession, phone, name, label,
  onLogout, onSwitch, sessionsVersion,
}: Props) {
  const [loggingOut,     setLoggingOut]     = useState(false);
  const [logoutErr,      setLogoutErr]      = useState<string | null>(null);
  const [dropdownOpen,   setDropdownOpen]   = useState(false);
  // Local trigger = max(sessionsVersion bump, open bump)
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  // Whenever the parent bumps sessionsVersion (SSE sessions_changed), refetch
  useEffect(() => {
    setRefetchTrigger((n) => n + 1);
  }, [sessionsVersion]);

  const displayLabel = label || name || activeSession || '—';
  const chip         = initials(displayLabel);

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutErr(null);
    try { await onLogout(); }
    catch { setLogoutErr('Logout failed. Try again.'); }
    finally { setLoggingOut(false); }
  };

  const handleOpenDropdown = useCallback(() => {
    setDropdownOpen((v) => {
      if (!v) setRefetchTrigger((n) => n + 1); // fresh fetch on every open
      return !v;
    });
  }, []);

  return (
    <div className="bg-[#111] border border-[#25d366]/25 rounded-2xl px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative">
            <button
              onClick={handleOpenDropdown}
              className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#25d366]/30 rounded-full pl-1 pr-2.5 py-1 transition"
              title="Switch session"
            >
              <span className="w-6 h-6 rounded-full bg-[#25d366]/20 text-[#25d366] text-[10px] font-bold flex items-center justify-center">
                {chip}
              </span>
              <span className="text-white/70 text-xs font-medium leading-none">{displayLabel}</span>
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={`text-white/30 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {dropdownOpen && (
              <SessionDropdown
                activeSession={activeSession}
                refetchTrigger={refetchTrigger}
                onClose={() => setDropdownOpen(false)}
                onSwitchDone={(id) => { onSwitch(id); }}
              />
            )}
          </div>

          <span className="relative flex-shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-[#25d366] block" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#25d366] block absolute inset-0 animate-ping opacity-60" />
          </span>

          <div className="min-w-0">
            <p className="text-[#25d366] text-sm font-medium leading-none">Connected</p>
            {connectedAt ? (
              <p className="text-white/40 text-xs mt-1">
                Uptime&nbsp;<Uptime since={connectedAt} />
                {phone && <>&nbsp;·&nbsp;+{phone}</>}
              </p>
            ) : (
              <div className="mt-1.5 h-3 w-28 rounded bg-white/10 animate-pulse" />
            )}
          </div>
        </div>

        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex-shrink-0 text-xs text-white/40 hover:text-red-400 disabled:opacity-40 border border-white/10 hover:border-red-500/30 px-3 py-1.5 rounded-lg transition-colors"
        >
          {loggingOut ? 'Logging out…' : 'Logout'}
        </button>
      </div>

      {logoutErr && (
        <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5">
          {logoutErr}
        </p>
      )}
    </div>
  );
}
