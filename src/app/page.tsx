// app/page.tsx — smart root redirect

// app/page.tsx — smart root redirect with session resume
import { redirect } from "next/navigation";

const BOT = process.env.NEXT_PUBLIC_BOT_URL ?? "http://localhost:3001";

async function fetchStatus() {
  const res = await fetch(`${BOT}/status`, {
    cache: "no-store",
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(800),
  });
  if (!res.ok) return null;
  return res.json() as Promise<{ status: string }>;
}

async function tryResume() {
  await fetch(`${BOT}/connect`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(1200),
  }).catch(() => null); // fire & forget — bot may already be initializing
}

export default async function Home() {
  try {
    const initial = await fetchStatus();

    // Bot is up — route based on live status
    if (initial) {
      if (initial.status === "connected") redirect("/session");
      if (["qr", "authenticated", "initializing"].includes(initial.status))
        redirect("/qr");

      // Bot is up but disconnected → trigger resume from MongoDB, then re-check
      await tryResume();

      // Give RemoteAuth ~1.5s to restore session from MongoDB before re-reading
      await new Promise((r) => setTimeout(r, 1500));

      const resumed = await fetchStatus().catch(() => null);
      if (resumed?.status === "connected") redirect("/session");
      if (resumed && resumed.status !== "disconnected") redirect("/qr");
    }
  } catch {
    // Bot not reachable — fall through
  }

  redirect("/connect");
}

// import { redirect } from "next/navigation";

// export default async function Home() {
//   try {
//     const res = await fetch("http://localhost:3001/status", {
//       cache: "no-store",
//       signal: AbortSignal.timeout(800), // don't block page load if bot is down
//     });
//     if (res.ok) {
//       const { status } = await res.json();
//       if (status === "connected") redirect("/session");
//       if (status === "qr" || status === "initializing" || status === "authenticated")
//         redirect("/qr");
//     }
//   } catch {
//     // bot not up yet — fall through to /connect
//   }
//   redirect("/connect");
// }
