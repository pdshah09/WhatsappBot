// src/app/page.tsx
import { redirect } from "next/navigation";

const BOT = process.env.BOT_URL ?? "http://localhost:3001";

export default async function Home() {
  try {
    const res = await fetch(`${BOT}/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });

    if (res.ok) {
      const { status } = (await res.json()) as { status: string };

      // Already live — go straight to session
      if (status === "connected") redirect("/session");

      // Bot is booting or showing QR
      if (["qr", "authenticated", "initializing"].includes(status)) redirect("/qr");

      // Bot is disconnected — check if a saved session exists in MongoDB
      if (status === "disconnected") {
        try {
          const sr = await fetch(`${BOT}/session-exists`, {
            cache: "no-store",
            signal: AbortSignal.timeout(1500),
          });
          if (sr.ok) {
            const { exists } = (await sr.json()) as { exists: boolean };
            if (exists) {
              // Kick the bot to start restoring the session in the background,
              // then send the user to /session which listens via SSE and
              // will show a loading state until 'ready' fires.
              await fetch(`${BOT}/connect`, {
                method: "POST",
                cache: "no-store",
                signal: AbortSignal.timeout(2000),
              }).catch(() => {});
              redirect("/session");
            }
          }
        } catch { /* MongoDB query failed — fall through to /connect */ }
      }
    }
  } catch { /* bot not reachable yet */ }

  redirect("/connect");
}
