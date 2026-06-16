// src/app/(pages)/connect/page.tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { botConnect, botGetSessions, type BotSession } from "@/lib/bot";

function WhatsAppLogo() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="none">
      <circle cx="24" cy="24" r="24" fill="#25d366" />
      <path d="M24 10C16.27 10 10 16.27 10 24c0 2.49.67 4.83 1.82 6.85L10 38l7.36-1.8A13.93 13.93 0 0024 38c7.73 0 14-6.27 14-14S31.73 10 24 10zm7.07 19.43c-.3.84-1.74 1.62-2.4 1.72-.62.1-1.41.14-2.27-.14-.52-.17-1.19-.39-2.05-.77-3.6-1.56-5.95-5.18-6.13-5.42-.18-.24-1.47-1.96-1.47-3.74s.93-2.65 1.26-3.01c.33-.36.72-.45.96-.45h.69c.22 0 .52-.08.81.62.3.72 1.02 2.5 1.11 2.68.09.18.15.39.03.63-.12.24-.18.39-.36.6-.18.21-.38.47-.54.63-.18.18-.37.37-.16.73.21.36.93 1.53 2 2.48 1.37 1.22 2.53 1.6 2.89 1.78.36.18.57.15.78-.09.21-.24.9-1.05 1.14-1.41.24-.36.48-.3.81-.18.33.12 2.1.99 2.46 1.17.36.18.6.27.69.42.09.15.09.87-.21 1.71z" fill="white"/>
    </svg>
  );
}

function initials(label: string) {
  return label.split(/[\s_-]+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

const STATUS_LABEL: Record<string, string> = {
  connected:    "Connected",
  initializing: "Starting…",
  qr:           "Awaiting QR",
  authenticated:"Authenticated",
  saved:        "Saved",
  disconnected: "Disconnected",
};

export default function ConnectPage() {
  const router = useRouter();
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [sessions,  setSessions]  = useState<BotSession[]>([]);
  const [fetching,  setFetching]  = useState(true);

  useEffect(() => {
    botGetSessions().then(setSessions).finally(() => setFetching(false));
  }, []);

  const handleConnect = async (sessionId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res  = await botConnect(sessionId);
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; status?: string };
      if (!res.ok) {
        setError(data.error ?? "Bot not ready. Try again.");
        return;
      }
      // Restoring saved session → skip QR, go to session
      // New session → go to QR page
      if (sessionId || data.status === "connected") {
        router.push("/session");
      } else {
        router.push("/qr");
      }
    } catch {
      setError("Cannot reach the bot server. Make sure it is running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-6">
      <div className="bg-[#111] border border-white/10 rounded-2xl p-8 w-full max-w-sm flex flex-col items-center gap-5">

        <WhatsAppLogo />
        <div className="text-center">
          <h2 className="text-lg font-semibold">Connect your session</h2>
          <p className="text-white/40 text-sm mt-1">Link your WhatsApp to get started</p>
        </div>

        {/* Saved sessions */}
        {fetching ? (
          <div className="w-full flex flex-col gap-2">
            {[1, 2].map((i) => <div key={i} className="h-11 rounded-xl bg-white/5 animate-pulse" />)}
          </div>
        ) : sessions.length > 0 && (
          <div className="w-full flex flex-col gap-2">
            <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">Saved sessions</p>
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => handleConnect(s.id)}
                disabled={loading}
                className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-[#25d366]/10 border border-white/8 hover:border-[#25d366]/30 transition-colors disabled:opacity-50 text-left"
              >
                <span className="w-8 h-8 rounded-full bg-[#25d366]/20 text-[#25d366] text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {initials(s.label)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-sm text-white/80 block truncate">{s.label}</span>
                  <span className="text-[10px] text-white/30">
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                </span>
                <span className="text-white/20 text-xs flex-shrink-0">Restore →</span>
              </button>
            ))}
            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-white/20 text-xs">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 w-full">
            {error}
          </p>
        )}

        <button
          onClick={() => handleConnect()}
          disabled={loading}
          className="w-full bg-[#25d366] hover:bg-[#1ebe5d] disabled:opacity-50 text-black font-semibold py-2.5 rounded-xl transition flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              Starting…
            </>
          ) : (
            <><span className="text-base leading-none">+</span> CONNECT NEW</>
          )}
        </button>
      </div>
    </div>
  );
}
