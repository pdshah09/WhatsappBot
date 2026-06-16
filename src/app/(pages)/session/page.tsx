// src/app/(pages)/session/page.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { botLogout } from "@/lib/bot";
import SessionCard from "@/app/components/SessionCard";
import SendForm from "@/app/components/SendForm";

export default function SessionPage() {
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const router   = useRouter();
  const esRef    = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let retryDelay = 1000;

    function connect() {
      const es = new EventSource("/api/bot/events");
      esRef.current = es;

      es.onmessage = ({ data }) => {
        retryDelay = 1000;
        const d = JSON.parse(data);
        if (d.type === "state") {
          if (d.status !== "connected") { es.close(); router.replace("/connect"); return; }
          setConnectedAt(d.connectedAt);
        }
        if (d.type === "ready")        setConnectedAt(d.connectedAt);
        if (d.type === "disconnected") { es.close(); router.replace("/connect"); }
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

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm flex flex-col gap-4">
        <SessionCard
          connectedAt={connectedAt}
          onLogout={async () => {
            esRef.current?.close();
            await botLogout();
            router.replace("/connect");
          }}
        />
        <SendForm />
      </div>
    </div>
  );
}
