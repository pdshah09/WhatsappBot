// app/page.tsx — smart root redirect
import { redirect } from "next/navigation";

export default async function Home() {
  try {
    const res = await fetch("http://localhost:3001/status", {
      cache: "no-store",
      signal: AbortSignal.timeout(800), // don't block page load if bot is down
    });
    if (res.ok) {
      const { status } = await res.json();
      if (status === "connected") redirect("/session");
      if (status === "qr" || status === "initializing" || status === "authenticated")
        redirect("/qr");
    }
  } catch {
    // bot not up yet — fall through to /connect
  }
  redirect("/connect");
}
