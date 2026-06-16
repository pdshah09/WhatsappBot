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

      // Already live
      if (status === "connected") redirect("/session");

      // Chromium is booting or QR is on screen — go wait at /qr
      if (["qr", "authenticated", "initializing"].includes(status)) redirect("/qr");

      // status === "disconnected" — but maybe a saved session exists in MongoDB.
      // If so, skip /connect and go straight to /qr; the bot will auto-restore
      // and SSE will push the 'ready' event that advances the page to /session.
      if (status === "disconnected") {
        try {
          const sr = await fetch(`${BOT}/session-exists`, {
            cache: "no-store",
            signal: AbortSignal.timeout(1500),
          });
          if (sr.ok) {
            const { exists } = (await sr.json()) as { exists: boolean };
            if (exists) redirect("/qr");
          }
        } catch { /* MongoDB query failed — fall through to /connect */ }
      }
    }
  } catch { /* bot not up yet */ }

  redirect("/connect");
}
