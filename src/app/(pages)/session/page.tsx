// src/app/(pages)/session/page.tsx
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { botLogout, type BotState } from '@/lib/bot';
import SessionCard from '@/app/components/SessionCard';
import SendForm    from '@/app/components/SendForm';
import ChatPanel   from '@/app/components/ChatPanel';

const DISCONNECTED: BotState = {
  status:        'connecting',
  qr:            null,
  connectedAt:   null,
  activeSession: null,
  phone:         null,
  name:          null,
  label:         null,
};

export default function SessionPage() {
  const [botState,        setBotState]        = useState<BotState>(DISCONNECTED);
  // Incrementing this triggers SessionDropdown to refetch /sessions
  const [sessionsVersion, setSessionsVersion] = useState(0);
  const router   = useRouter();
  const esRef    = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpSessions = useCallback(() => setSessionsVersion((n) => n + 1), []);

  const applyEvent = useCallback(
    (raw: string) => {
      try {
        const d: BotState & { type: string } = JSON.parse(raw);

        // Server signals sessions list changed (ready, disconnect, logout)
        if (d.type === 'sessions_changed') {
          bumpSessions();
          return;
        }

        if (d.type === 'state') {
          if (d.status === 'disconnected' && !d.activeSession) {
            esRef.current?.close();
            router.replace('/connect');
            return;
          }
          setBotState(d);
          return;
        }

        if (d.type === 'ready') {
          setBotState((p) => ({
            ...p,
            status:        'connected',
            connectedAt:   d.connectedAt,
            activeSession: d.activeSession ?? p.activeSession,
            phone:         d.phone  ?? p.phone,
            name:          d.name   ?? p.name,
            label:         (d as unknown as { label?: string }).label ?? p.label,
          }));
          bumpSessions();
          return;
        }

        if (d.type === 'disconnected') {
          if (!d.activeSession) {
            esRef.current?.close();
            router.replace('/connect');
          }
          bumpSessions();
          return;
        }

        if (d.type === 'qr') {
          setBotState((p) => ({ ...p, status: 'qr', qr: d.qr }));
        }
      } catch { /* malformed — ignore */ }
    },
    [router, bumpSessions]
  );

  useEffect(() => {
    let retryDelay = 1000;

    function connectSSE() {
      const es = new EventSource('/api/bot/events');
      esRef.current = es;

      es.onmessage = ({ data }) => {
        retryDelay = 1000;
        applyEvent(data);
      };

      es.onerror = () => {
        es.close();
        retryDelay = Math.min(retryDelay * 2, 16_000);
        timerRef.current = setTimeout(connectSSE, retryDelay);
      };
    }

    connectSSE();
    return () => {
      esRef.current?.close();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [applyEvent]);

  const handleLogout = async () => {
    esRef.current?.close();
    await botLogout(botState.activeSession ?? undefined).catch(() => {});
    router.replace('/connect');
  };

  const handleSwitch = useCallback((newClientId: string) => {
    setBotState((p) => ({
      ...p,
      activeSession: newClientId,
      connectedAt:   null,
      phone:         null,
      name:          null,
      label:         null,
    }));
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-4 md:p-6">
      <div className="max-w-6xl mx-auto mb-4">
        <SessionCard
          connectedAt={botState.connectedAt}
          activeSession={botState.activeSession}
          phone={botState.phone}
          name={botState.name}
          label={botState.label}
          onLogout={handleLogout}
          onSwitch={handleSwitch}
          sessionsVersion={sessionsVersion}
        />
      </div>
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-[380px_1fr] gap-4 h-[calc(100vh-140px)]">
        <SendForm />
        <ChatPanel />
      </div>
    </div>
  );
}
