// src/app/(pages)/session/page.tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { botLogout } from "@/lib/bot";
import SessionCard from "@/app/components/SessionCard";
import SendForm from "@/app/components/SendForm";

export default function SessionPage() {
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const es = new EventSource("/api/bot/events");

    es.onmessage = ({ data }) => {
      const d = JSON.parse(data);
      // first message: verify still connected
      if (d.type === "state") {
        if (d.status !== "connected") { es.close(); router.replace("/connect"); return; }
        setConnectedAt(d.connectedAt);
      }
      if (d.type === "ready")        setConnectedAt(d.connectedAt);
      if (d.type === "disconnected") { es.close(); router.replace("/connect"); }
    };

    es.onerror = () => { es.close(); router.replace("/connect"); };
    return () => es.close();
  }, [router]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm flex flex-col gap-4">
        <SessionCard
          connectedAt={connectedAt}
          onLogout={async () => { await botLogout(); router.replace("/connect"); }}
        />
        <SendForm />
      </div>
    </div>
  );
}