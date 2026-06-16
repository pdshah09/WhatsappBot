// src/app/(pages)/qr/page.tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { botLogout } from "@/lib/bot";
import QrBox from "@/app/components/QrBox";

export default function QrPage() {
  const [qr, setQr] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const es = new EventSource("/api/bot/events");

    es.onmessage = ({ data }) => {
      const d = JSON.parse(data);
      // first message is always current state snapshot
      if (d.type === "state") {
        if (d.status === "connected")    { es.close(); router.replace("/session"); return; }
        if (d.status === "disconnected") { es.close(); router.replace("/connect"); return; }
        if (d.qr) setQr(d.qr); // restore QR if mid-scan
      }
      if (d.type === "qr")           setQr(d.qr);
      if (d.type === "ready")        { es.close(); router.replace("/session"); }
      if (d.type === "disconnected") { es.close(); router.replace("/connect"); }
      if (d.type === "auth_failure") { es.close(); router.replace("/connect"); }
    };

    es.onerror = () => es.close();
    return () => es.close();
  }, [router]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-6">
      <div className="bg-[#111] border border-white/10 rounded-2xl p-8 w-full max-w-sm flex flex-col items-center gap-5">
        <h2 className="text-base font-semibold text-center">Scan now to connect your WhatsApp</h2>
        <QrBox qr={qr} />
        <p className="text-white/30 text-xs">QR refreshes every 30 seconds</p>
        <button
          onClick={async () => { await botLogout(); router.replace("/connect"); }}
          className="w-full border border-white/10 hover:border-red-500/40 text-white/50 hover:text-red-400 py-2 rounded-xl text-sm transition"
        >
          Logout
        </button>
      </div>
    </div>
  );
}