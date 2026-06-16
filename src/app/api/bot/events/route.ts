// src/app/api/bot/events/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const upstream = await fetch(
    `${process.env.BOT_URL ?? "http://localhost:3001"}/events`,
    { headers: { Accept: "text/event-stream" }, cache: "no-store" }
  ).catch(() => null);

  if (!upstream?.ok || !upstream.body)
    return NextResponse.json({ error: "Bot unreachable" }, { status: 503 });

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache",
      "Connection":        "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}