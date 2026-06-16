// src/app/components/SessionCard.tsx
"use client";
import { useEffect, useState } from "react";

interface Props {
  connectedAt: string | null;
  onLogout: () => Promise<void>;
}

function Uptime({ since }: { since: string }) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    function tick() {
      const diff = Math.floor((Date.now() - new Date(since).getTime()) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setLabel(
        h > 0
          ? `${h}h ${String(m).padStart(2, "0")}m`
          : `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [since]);

  return <span>{label}</span>;
}

export default function SessionCard({ connectedAt, onLogout }: Props) {
  const [loggingOut, setLoggingOut] = useState(false);
  // W2: surface logout errors in UI
  const [logoutErr, setLogoutErr]   = useState<string | null>(null);
  const isLoading = !connectedAt;

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutErr(null);
    try {
      await onLogout();
    } catch {
      setLogoutErr("Logout failed. Try again.");
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="bg-[#111] border border-[#25d366]/30 rounded-2xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        {/* Status dot + info */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="relative flex-shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-[#25d366] block" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#25d366] block absolute inset-0 animate-ping opacity-60" />
          </span>
          <div className="min-w-0">
            <p className="text-[#25d366] text-sm font-medium leading-none">Connected</p>
            {isLoading ? (
              <div className="mt-1.5 h-3 w-28 rounded bg-white/10 animate-pulse" />
            ) : (
              <p className="text-white/40 text-xs mt-1 tabular-nums">
                Uptime&nbsp;<Uptime since={connectedAt!} />
                &nbsp;·&nbsp;
                {new Date(connectedAt!).toLocaleString([], {
                  month: "short", day: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
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
