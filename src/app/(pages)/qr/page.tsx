// src/app/(pages)/qr/page.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { botLogout } from "@/lib/bot";
import QrBox from "@/app/components/QrBox";

export default function QrPage() {
  const [qr, setQr]           = useState<string | null>(null);
  const [logoutErr, setLogoutErr] = useState<string | null>(null);
  const router                = useRouter();
  const retryRef              = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef                 = useRef<EventSource | null>(null);

  useEffect(() => {
    let retryDelay = 1000;

    function connect() {
      const es = new EventSource("/api/bot/events");
      esRef.current = es;

      es.onmessage = ({ data }) => {
        retryDelay = 1000; // reset backoff on successful message
        const d = JSON.parse(data);
        if (d.type === "state") {
          if (d.status === "connected")    { es.close(); router.replace("/session"); return; }
          if (d.status === "disconnected") { es.close(); router.replace("/connect");  return; }
          if (d.qr) setQr(d.qr);
        }
        if (d.type === "qr")           setQr(d.qr);
        if (d.type === "ready")        { es.close(); router.replace("/session"); }
        if (d.type === "disconnected") { es.close(); router.replace("/connect"); }
        if (d.type === "auth_failure") { es.close(); router.replace("/connect"); }
      };

      // FIX C2: reconnect with exponential backoff instead of instant redirect
      es.onerror = () => {
        es.close();
        retryDelay = Math.min(retryDelay * 2, 16000);
        retryRef.current = setTimeout(connect, retryDelay);
      };
    }

    connect();
    return () => {
      esRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [router]);

  // FIX C1: logout wrapped in try/catch with visible error
  const handleLogout = async () => {
    setLogoutErr(null);
    try {
      const res = await botLogout();
      if (!res.ok) throw new Error(await res.text());
      esRef.current?.close();
      router.replace("/connect");
    } catch {
      setLogoutErr("Logout failed — bot may be unreachable.");
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-6">
      <div className="bg-[#111] border border-white/10 rounded-2xl p-8 w-full max-w-sm flex flex-col items-center gap-5">
        <h2 className="text-base font-semibold text-center">Scan to connect your WhatsApp</h2>
        <QrBox qr={qr} />
        <p className="text-white/30 text-xs">QR refreshes every 30 seconds</p>
        {logoutErr && (
          <p className="text-red-400 text-xs text-center bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 w-full">
            {logoutErr}
          </p>
        )}
        <button
          onClick={handleLogout}
          className="w-full border border-white/10 hover:border-red-500/40 text-white/50 hover:text-red-400 py-2 rounded-xl text-sm transition"
        >
          Logout
        </button>
      </div>
    </div>
  );
}
