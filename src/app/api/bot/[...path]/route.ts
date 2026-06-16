// src/app/api/bot/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";

const BOT = process.env.BOT_URL ?? "http://localhost:3001";

type Context = { params: Promise<{ path: string[] }> };

export async function GET(_req: NextRequest, { params }: Context) {
  const { path } = await params;
  return proxy(path, "GET");
}

export async function POST(req: NextRequest, { params }: Context) {
  const { path } = await params;
  return proxy(path, "POST", await req.text());
}

async function proxy(segments: string[], method: string, body?: string) {
  try {
    const res = await fetch(`${BOT}/${segments.join("/")}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bot unreachable" },
      { status: 503 }
    );
  }
}
