// src/app/page.tsx
import { redirect } from "next/navigation";

export default async function Home() {
  try {
    const res = await fetch(
      `${process.env.BOT_URL ?? "http://localhost:3001"}/status`,
      { cache: "no-store", signal: AbortSignal.timeout(1000) }
    );
    if (res.ok) {
      const { status } = await res.json() as { status: string };
      if (status === "connected")                                    redirect("/session");
      if (["qr", "authenticated", "initializing"].includes(status)) redirect("/qr");
      // status === "disconnected" → fall through to /connect
    }
  } catch { /* bot not up */ }
  redirect("/connect");
}