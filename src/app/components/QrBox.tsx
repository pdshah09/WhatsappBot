// src/app/components/QrBox.tsx
"use client";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";

export default function QrBox({ qr }: { qr: string | null }) {
  const [expired, setExpired] = useState(false);

  // W1: removed incorrect eslint-disable comment — setState in useEffect is valid
  useEffect(() => {
    if (!qr) { setExpired(false); return; }
    setExpired(false);
    const t = setTimeout(() => setExpired(true), 29_000);
    return () => clearTimeout(t);
  }, [qr]);

  if (!qr) return (
    <div className="w-[224px] h-[224px] rounded-xl bg-white/5 border border-white/10 flex flex-col items-center justify-center gap-3">
      <span className="w-6 h-6 border-2 border-[#25d366] border-t-transparent rounded-full animate-spin" />
      <p className="text-white/40 text-xs">Waiting for QR…</p>
    </div>
  );

  if (expired) return (
    <div className="w-[224px] h-[224px] rounded-xl bg-white/5 border border-yellow-500/20 flex flex-col items-center justify-center gap-3">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-yellow-400">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4l2 2"/>
      </svg>
      <p className="text-yellow-400/80 text-xs text-center px-4">QR expired<br/>New one arriving…</p>
    </div>
  );

  return (
    <div className="bg-white p-3 rounded-xl shadow-lg">
      <QRCode value={qr} size={200} />
    </div>
  );
}
