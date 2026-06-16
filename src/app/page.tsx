// src/app/page.tsx
import { redirect } from "next/navigation";
import type { BotState } from "@/lib/bot";

const BOT = process.env.BOT_URL ?? "http://localhost:3001";

export default async function Home() {
  try {
    const res = await fetch(`${BOT}/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });

    if (res.ok) {
      const data = (await res.json()) as BotState & { status: string };

      // Already live → go to session
      if (data.status === "connected") redirect("/session");

      // Bot is booting or showing QR
      if (["qr", "authenticated", "initializing"].includes(data.status)) redirect("/qr");

      // Bot is disconnected — check for saved MongoDB session
      if (data.status === "disconnected") {
        try {
          const sr = await fetch(`${BOT}/session-exists`, {
            cache: "no-store",
            signal: AbortSignal.timeout(1500),
          });
          if (sr.ok) {
            const { exists } = (await sr.json()) as { exists: boolean };
            if (exists) {
              // Auto-boot and send to /session (SSE will handle loading state)
              await fetch(`${BOT}/connect`, {
                method: "POST",
                cache: "no-store",
                signal: AbortSignal.timeout(2000),
              }).catch(() => {});
              redirect("/session");
            }
          }
        } catch { /* MongoDB unavailable — fall through */ }
      }
    }
  } catch { /* bot not reachable */ }

  redirect("/connect");
}
