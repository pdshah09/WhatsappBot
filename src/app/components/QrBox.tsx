// components/QrBox.tsx

"use client";
import QRCode from "react-qr-code";

export default function QrBox({ qr }: { qr: string | null }) {
  if (!qr) return <p className="text-[#25d366] text-sm animate-pulse">Authenticating…</p>;
  return (
    <div className="bg-white p-3 rounded-xl">
      <QRCode value={qr} size={200} />
    </div>
  );
}