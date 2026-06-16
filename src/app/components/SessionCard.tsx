// src/app/components/SessionCard.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { botGetSessions, botSwitch, botConnect, type BotSession } from "@/lib/bot";

interface Props {
  connectedAt:   string | null;
  activeSession: string | null;  // clientId e.g. "RemoteAuth" | "work"
  phone:         string | null;
  name:          string | null;
  onLogout:      () => Promise<void>;
  onSwitch:      (sessionId: string) => void; // called after successful switch
}

// ── helpers ──────────────────────────────────────────────────────────────────
function sessionLabel(clientId: string | null): string {
  if (!clientId || clientId === "RemoteAuth") return "Default";
  return clientId;
}

function initials(label: string): string {
  return label.split(/[\s_-]+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function Uptime({ since }: { since: string }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    function tick() {
      const diff = Math.floor((Date.now() - new Date(since).getTime()) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setLabel(h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [since]);
  return <span>{label}</span>;
}

// ── SessionDropdown ──────────────────────────────────────────────────────────
function SessionDropdown({
  activeSession,
  onClose,
  onSwitchDone,
}: {
  activeSession: string | null;
  onClose: () => void;
  onSwitchDone: (sessionId: string) => void;
}) {
  const [sessions,  setSessions]  = useState<BotSession[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    botGetSessions().then(setSessions).finally(() => setLoading(false));
  }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const handleSwitch = async (s: BotSession) => {
    if (s.clientId === activeSession) { onClose(); return; }
    setSwitching(s.clientId);
    if (s.status === "connected") {
      // Already connected in memory — just switch active
      await botSwitch(s.id);
    } else {
      // Restore from MongoDB
      await botConnect(s.id);
    }
    onSwitchDone(s.clientId);
    onClose();
    setSwitching(null);
  };

  const statusDot = (status: string) => {
    if (status === "connected")    return "bg-[#25d366]";
    if (["initializing", "qr", "authenticated"].includes(status)) return "bg-yellow-400";
    return "bg-white/20";
  };

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-2 z-50 w-56 bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
    >
      <div className="px-3 pt-3 pb-1">
        <p className="text-white/30 text-[10px] uppercase tracking-widest">Switch session</p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-1.5 p-3">
          {[1, 2].map((i) => <div key={i} className="h-9 rounded-xl bg-white/5 animate-pulse" />)}
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-white/30 text-xs text-center py-4">No saved sessions</p>
      ) : (
        <div className="flex flex-col py-1">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => handleSwitch(s)}
              disabled={!!switching}
              className={`flex items-center gap-3 px-3 py-2.5 text-left transition hover:bg-white/5 disabled:opacity-60 ${
                s.clientId === activeSession ? "bg-[#25d366]/8" : ""
              }`}
            >
              <span className="w-7 h-7 rounded-full bg-[#25d366]/15 text-[#25d366] text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                {initials(s.label)}
              </span>
              <span className="flex-1 min-w-0">
                <span className="text-sm text-white/80 block truncate">{s.label}</span>
                <span className="text-[10px] text-white/30 capitalize">{s.status}</span>
              </span>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(s.status)}`} />
              {switching === s.clientId && (
                <span className="w-3 h-3 border border-white/20 border-t-white rounded-full animate-spin flex-shrink-0" />
              )}
              {s.clientId === activeSession && !switching && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#25d366" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Add new session */}
      <div className="border-t border-white/5 p-2">
        <button
          onClick={() => { window.location.href = "/connect"; }}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/40 hover:text-white hover:bg-white/5 rounded-xl transition"
        >
          <span className="text-base leading-none">+</span>
          Add new session
        </button>
      </div>
    </div>
  );
}

// ── SessionCard ──────────────────────────────────────────────────────────────
export default function SessionCard({
  connectedAt, activeSession, phone, name, onLogout, onSwitch,
}: Props) {
  const [loggingOut,    setLoggingOut]    = useState(false);
  const [logoutErr,     setLogoutErr]     = useState<string | null>(null);
  const [dropdownOpen,  setDropdownOpen]  = useState(false);
  const isLoading = !connectedAt;

  const label = sessionLabel(activeSession);
  const chip  = initials(label);
  const displayName = name || label;

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutErr(null);
    try { await onLogout(); }
    catch { setLogoutErr("Logout failed. Try again."); }
    finally { setLoggingOut(false); }
  };

  return (
    <div className="bg-[#111] border border-[#25d366]/30 rounded-2xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">

        {/* Left — profile chip (clickable) + dot + status */}
        <div className="flex items-center gap-3 min-w-0">

          {/* Profile chip — click to open session switcher */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#25d366]/30 rounded-full pl-1 pr-3 py-1 transition flex-shrink-0"
              title="Switch session"
            >
              <span className="w-6 h-6 rounded-full bg-[#25d366]/20 text-[#25d366] text-[10px] font-bold flex items-center justify-center">
                {chip}
              </span>
              <span className="text-white/70 text-xs font-medium leading-none">{displayName}</span>
              {/* Chevron */}
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={`text-white/30 transition-transform ${ dropdownOpen ? "rotate-180" : "" }`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {dropdownOpen && (
              <SessionDropdown
                activeSession={activeSession}
                onClose={() => setDropdownOpen(false)}
                onSwitchDone={(sid) => { onSwitch(sid); }}
              />
            )}
          </div>

          {/* Blinking green dot */}
          <span className="relative flex-shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-[#25d366] block" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#25d366] block absolute inset-0 animate-ping opacity-60" />
          </span>

          {/* Connected + uptime */}
          <div className="min-w-0">
            <p className="text-[#25d366] text-sm font-medium leading-none">Connected</p>
            {isLoading ? (
              <div className="mt-1.5 h-3 w-28 rounded bg-white/10 animate-pulse" />
            ) : (
              <p className="text-white/40 text-xs mt-1 tabular-nums">
                Uptime&nbsp;<Uptime since={connectedAt!} />
                {phone && <>&nbsp;·&nbsp;+{phone}</>}
              </p>
            )}
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex-shrink-0 text-xs text-white/40 hover:text-red-400 disabled:opacity-40 border border-white/10 hover:border-red-500/30 px-3 py-1.5 rounded-lg transition-colors"
        >
          {loggingOut ? "Logging out…" : "Logout"}
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
