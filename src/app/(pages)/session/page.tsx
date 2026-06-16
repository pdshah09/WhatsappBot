// connect/session/page.tsx

"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BOT, botLogout } from "@/lib/bot";
import SessionCard from "@/app/components/SessionCard";
import SendForm from "@/app/components/SendForm";

export default function SessionPage() {
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    // get initial state
    fetch(`${BOT}/status`)
      .then(r => r.json())
      .then(d => {
        if (d.status !== "connected") { router.push("/connect"); return; }
        setConnectedAt(d.connectedAt);
      })
      .catch(() => router.push("/connect"));

    const es = new EventSource(`${BOT}/events`);
    es.onmessage = ({ data }) => {
      const d = JSON.parse(data);
      if (d.type === "ready")   setConnectedAt(d.connectedAt);
      if (d.type === "status" && d.status === "disconnected") { es.close(); router.push("/connect"); }
    };
    es.onerror = () => { es.close(); };
    return () => es.close();
  }, [router]);

  const handleLogout = async () => {
    await botLogout();
    router.push("/connect");
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm flex flex-col gap-4">
        <SessionCard connectedAt={connectedAt} onLogout={handleLogout} />
        <SendForm />
      </div>
    </div>
  );
}