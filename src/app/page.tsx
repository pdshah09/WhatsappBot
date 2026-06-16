// src/app/page.tsx — Server Component boot router
import { redirect } from 'next/navigation';
import type { BotState } from '@/lib/bot';

const BOT = process.env.BOT_URL ?? 'http://localhost:3001';

export default async function Home() {
  try {
    const res = await fetch(`${BOT}/status`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });

    if (res.ok) {
      const data = (await res.json()) as BotState & { status: string };

      if (data.status === 'connected')                                   redirect('/session');
      if (['qr', 'authenticated', 'initializing'].includes(data.status)) redirect('/qr');

      // Disconnected — check if any sessions are saved in MongoDB
      if (data.status === 'disconnected') {
        const sr = await fetch(`${BOT}/sessions`, {
          cache:  'no-store',
          signal: AbortSignal.timeout(2000),
        }).catch(() => null);

        if (sr?.ok) {
          const sessions = (await sr.json().catch(() => [])) as BotState[];
          if (sessions.length > 0) {
            // Saved sessions exist — show connect page to let user choose
            redirect('/connect');
          }
        }
      }
    }
  } catch { /* bot unreachable */ }

  redirect('/connect');
}
