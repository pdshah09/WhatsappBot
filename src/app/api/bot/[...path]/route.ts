// src/app/api/bot/[...path]/route.ts
// Transparent proxy → bot server.
// Streams binary responses (media) so images/files are viewable & downloadable.
import { NextRequest, NextResponse } from 'next/server';

const BOT = process.env.BOT_URL ?? 'http://localhost:3001';

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { path } = await params;
  return proxy(req, path, 'GET');
}
export async function POST(req: NextRequest, { params }: Ctx) {
  const { path } = await params;
  return proxy(req, path, 'POST', await req.arrayBuffer());
}

async function proxy(
  req: NextRequest,
  segments: string[],
  method: string,
  body?: ArrayBuffer,
) {
  const url  = `${BOT}/${segments.join('/')}${req.nextUrl.search}`;
  const last = segments.at(-1) ?? '';
  // generous timeout for slow operations
  const timeout = ['send', 'chats'].includes(last) ? 60_000
    : last === 'media'   ? 30_000
    : 8_000;

  const upstreamCT = body?.byteLength
    ? req.headers.get('Content-Type') ?? 'application/json'
    : undefined;

  try {
    const upstream = await fetch(url, {
      method,
      headers: upstreamCT ? { 'Content-Type': upstreamCT } : {},
      body: body?.byteLength ? body : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
    });

    const ct = upstream.headers.get('Content-Type') ?? 'application/octet-stream';
    const cd = upstream.headers.get('Content-Disposition');
    const isMedia = ct.startsWith('image/') || ct.startsWith('video/')
      || ct.startsWith('audio/') || ct.startsWith('application/');

    if (isMedia && upstream.body) {
      // Stream binary directly — enables <img src> and download links
      const headers: Record<string, string> = { 'Content-Type': ct };
      if (cd) headers['Content-Disposition'] = cd;
      return new NextResponse(upstream.body, { status: upstream.status, headers });
    }

    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: { 'Content-Type': ct },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Bot unreachable' },
      { status: 503 },
    );
  }
}
