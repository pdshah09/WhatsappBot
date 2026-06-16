// connect/connect/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { botConnect } from "@/lib/bot";

function WhatsAppLogo() {
  return (
    <svg viewBox="0 0 48 48" width="52" height="52" fill="none">
      <circle cx="24" cy="24" r="24" fill="#25d366" />
      <path d="M24 10C16.27 10 10 16.27 10 24c0 2.49.67 4.83 1.82 6.85L10 38l7.36-1.8A13.93 13.93 0 0024 38c7.73 0 14-6.27 14-14S31.73 10 24 10zm7.07 19.43c-.3.84-1.74 1.62-2.4 1.72-.62.1-1.41.14-2.27-.14-.52-.17-1.19-.39-2.05-.77-3.6-1.56-5.95-5.18-6.13-5.42-.18-.24-1.47-1.96-1.47-3.74s.93-2.65 1.26-3.01c.33-.36.72-.45.96-.45h.69c.22 0 .52-.08.81.62.3.72 1.02 2.5 1.11 2.68.09.18.15.39.03.63-.12.24-.18.39-.36.6-.18.21-.38.47-.54.63-.18.18-.37.37-.16.73.21.36.93 1.53 2 2.48 1.37 1.22 2.53 1.6 2.89 1.78.36.18.57.15.78-.09.21-.24.9-1.05 1.14-1.41.24-.36.48-.3.81-.18.33.12 2.1.99 2.46 1.17.36.18.6.27.69.42.09.15.09.87-.21 1.71z" fill="white" />
    </svg>
  );
}

export default function ConnectPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await botConnect();
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Bot server not ready yet. Please wait a moment and try again.");
        return;
      }
      router.push("/qr");
    } catch {
      setError("Cannot reach the bot server. Make sure it is running on port 3001.");
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
        {error && (
          <p className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 w-full">
            {error}
          </p>
        )}
        <button
          onClick={handleConnect}
          disabled={loading}
          className="w-full bg-[#25d366] hover:bg-[#1ebe5d] disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold py-2.5 rounded-xl transition"
        >
          {loading ? "Starting..." : "Connect Now"}
        </button>
      </div>
    </div>
  );
}