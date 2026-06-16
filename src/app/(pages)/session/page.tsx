// src/app/(pages)/session/page.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { botLogout, type BotState } from "@/lib/bot";
import SessionCard from "@/app/components/SessionCard";
import SendForm from "@/app/components/SendForm";
import ChatPanel from "@/app/components/ChatPanel";

const INITIAL: BotState = {
  status: "connecting",
  qr: null,
  connectedAt: null,
  activeSession: null,
  phone: null,
  name: null,
};

export default function SessionPage() {
  const [botState, setBotState] = useState<BotState>(INITIAL);
  const router   = useRouter();
  const esRef    = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let retryDelay = 1000;

    function connectSSE() {
      const es = new EventSource("/api/bot/events");
      esRef.current = es;

      es.onmessage = ({ data }) => {
        retryDelay = 1000; // reset backoff on success
        try {
          const d: BotState & { type: string } = JSON.parse(data);

          if (d.type === "state") {
            // If bot is disconnected and we're on /session, send to /connect
            if (d.status === "disconnected") {
              es.close();
              router.replace("/connect");
              return;
            }
            setBotState(d);
          }

          if (d.type === "ready") {
            setBotState((prev) => ({
              ...prev,
              status: "connected",
              connectedAt: d.connectedAt,
              activeSession: d.activeSession ?? prev.activeSession,
              phone: d.phone ?? prev.phone,
              name: d.name ?? prev.name,
            }));
          }

          if (d.type === "disconnected") {
            // Check if any session is still connected
            // The next SSE 'state' event from the server will cover this;
            // only redirect if no active session remains
            setBotState((prev) => {
              if (!d.activeSession) {
                es.close();
                router.replace("/connect");
              }
              return prev;
            });
          }
        } catch { /* malformed JSON — ignore */ }
      };

      es.onerror = () => {
        es.close();
        retryDelay = Math.min(retryDelay * 2, 16_000);
        retryRef.current = setTimeout(connectSSE, retryDelay);
      };
    }

    connectSSE();
    return () => {
      esRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [router]);

  const handleLogout = async () => {
    esRef.current?.close();
    await botLogout(botState.activeSession ?? undefined);
    router.replace("/connect");
  };

  const handleSwitch = (newSessionId: string) => {
    // State will be updated via the SSE 'state' broadcast from the server
    // Optimistically mark as loading
    setBotState((prev) => ({ ...prev, activeSession: newSessionId, connectedAt: null }));
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-4 md:p-6">
      {/* Top bar */}
      <div className="max-w-6xl mx-auto mb-4">
        <SessionCard
          connectedAt={botState.connectedAt}
          activeSession={botState.activeSession}
          phone={botState.phone}
          name={botState.name}
          onLogout={handleLogout}
          onSwitch={handleSwitch}
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
