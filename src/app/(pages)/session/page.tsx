// src/app/(pages)/session/page.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { botLogout } from "@/lib/bot";
import SessionCard from "@/app/components/SessionCard";
import SendForm from "@/app/components/SendForm";
import ChatPanel from "@/app/components/ChatPanel";

export default function SessionPage() {
  const [connectedAt,   setConnectedAt]   = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<string | null>(null);
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
          setActiveSession(d.activeSession ?? null);
        }
        if (d.type === "ready") {
          setConnectedAt(d.connectedAt);
          setActiveSession(d.activeSession ?? null);
        }
        if (d.type === "disconnected") { es.close(); router.replace("/connect"); }
      };

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
    <div className="min-h-screen bg-[#0a0a0a] text-white p-4 md:p-6">
      {/* Top bar — full width */}
      <div className="max-w-6xl mx-auto mb-4">
        <SessionCard
          connectedAt={connectedAt}
          activeSession={activeSession}
          onLogout={async () => {
            esRef.current?.close();
            await botLogout();
            router.replace("/connect");
          }}
        />
      </div>

      {/* Two-column layout */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-[380px_1fr] gap-4 h-[calc(100vh-140px)]">
        <SendForm />
        <ChatPanel />
      </div>
    </div>
  );
}
