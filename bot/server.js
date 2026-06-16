// bot/server.js
import fs from 'fs';
import path from 'path';
import pkg from 'whatsapp-web.js';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import pkgMongo from 'wwebjs-mongo';
import { OptimizedRemoteAuth } from './OptimizedRemoteAuth.js';

const { Client, MessageMedia } = pkg;
const { MongoStore } = pkgMongo;

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '50mb' }));

const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/whatsapp_bot';

// ── state ──────────────────────────────────────────────────────────────────
// 'initializing' = Chromium is booting / restoring session from MongoDB.
// The frontend treats this the same as 'qr' (go to /qr, wait for SSE ready).
let state = { status: 'disconnected', qr: null, connectedAt: null };
let sse   = [];

// ── helpers ────────────────────────────────────────────────────────────────
function clearBrowserLock() {
  const lockFile = path.join(process.cwd(), '.wwebjs_auth', 'RemoteAuth', 'SingletonLock');
  try { fs.rmSync(lockFile, { force: true }); } catch {}
}

function push(event, patch = {}) {
  Object.assign(state, patch);
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  sse = sse.filter((r) => {
    try { r.write(payload); return true; } catch { return false; }
  });
}

async function saveSessionSafe(label = '') {
  const tag = label ? `[${label}] ` : '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await client.authStrategy.storeRemoteSession();
      console.log(`Bot → ${tag}Session saved to MongoDB (attempt ${attempt})`);
      return;
    } catch (err) {
      console.error(`Bot → ${tag}Session save attempt ${attempt} failed:`, err.message);
      if (attempt < 2) await sleep(3000);
    }
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── client ─────────────────────────────────────────────────────────────────
let store, client;

async function createClient() {
  store  = new MongoStore({ mongoose });
  client = new Client({
    authStrategy: new OptimizedRemoteAuth({
      store,
      backupSyncIntervalMs: 120_000,
    }),
    qrMaxRetries: 5,
    puppeteer: {
      executablePath:
        process.env.CHROME_PATH ||
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
      protocolTimeout: 300_000,
    },
  });
  bindEvents();
}

// ── events ─────────────────────────────────────────────────────────────────
function bindEvents() {
  client.on('qr',            (qr)  => push({ type: 'qr', qr },           { status: 'qr', qr }));
  client.on('authenticated', ()    => push({ type: 'authenticated' },     { status: 'authenticated' }));
  client.on('auth_failure',  (msg) => push({ type: 'auth_failure', msg }, { status: 'disconnected', qr: null }));

  client.on('ready', async () => {
    const connectedAt = new Date().toISOString();
    push({ type: 'ready', connectedAt }, { status: 'connected', qr: null, connectedAt });
    await sleep(4000);
    await saveSessionSafe('ready');
  });

  client.on('disconnected', () =>
    push({ type: 'disconnected' }, { status: 'disconnected', qr: null, connectedAt: null })
  );
}

// ── SSE ────────────────────────────────────────────────────────────────────
app.get('/events', (req, res) => {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'state', ...state })}\n\n`);
  sse.push(res);
  req.on('close', () => { sse = sse.filter((r) => r !== res); });
});

// ── REST ───────────────────────────────────────────────────────────────────
app.get('/status', (_, res) => res.json(state));

/**
 * GET /session-exists
 * Queries MongoDB directly — no Chromium needed, responds in <50 ms.
 * Used by the Next.js root page to decide where to redirect on cold boot
 * before client.initialize() has finished restoring the session.
 */
app.get('/session-exists', async (_, res) => {
  try {
    const s = new MongoStore({ mongoose });
    const exists = await s.sessionExists({ session: 'RemoteAuth' });
    res.json({ exists: !!exists });
  } catch {
    res.json({ exists: false });
  }
});

app.post('/connect', async (_, res) => {
  if (state.status !== 'disconnected') return res.json({ ok: true, status: state.status });
  await createClient();
  clearBrowserLock();
  // Mark as initializing immediately so the frontend can route to /qr
  Object.assign(state, { status: 'initializing' });
  client.initialize();
  res.json({ ok: true, status: state.status });
});

app.post('/logout', async (_, res) => {
  if (client && state.status === 'connected') {
    await saveSessionSafe('logout').catch(() => {});
  }
  await client?.logout().catch(() => {});
  await client?.destroy().catch(() => {});
  client = null;
  Object.assign(state, { status: 'disconnected', qr: null, connectedAt: null });
  push({ type: 'disconnected' });
  res.json({ ok: true });
});

app.post('/send', async (req, res) => {
  if (state.status !== 'connected') return res.status(400).json({ error: 'Not connected' });
  const { phone, message, attachment } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });
  try {
    const numberId = await client.getNumberId(phone.replace(/\D/g, ''));
    if (!numberId) return res.status(404).json({ error: 'Number not on WhatsApp' });
    const chatId = numberId._serialized;
    if (attachment) {
      const media = new MessageMedia(attachment.mimetype, attachment.data, attachment.filename);
      await client.sendMessage(chatId, media, { caption: message });
    } else {
      await client.sendMessage(chatId, message);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── boot ───────────────────────────────────────────────────────────────────
mongoose.connect(mongoUri)
  .then(async () => {
    console.log('Bot → Connected to MongoDB');
    await createClient();
    clearBrowserLock();
    // Set initializing BEFORE Chromium starts so /status reflects reality
    Object.assign(state, { status: 'initializing' });
    client.initialize();
    app.listen(3001, () => console.log('Bot → http://localhost:3001'));
  })
  .catch((err) => {
    console.error('Bot → MongoDB connection error:', err);
    process.exit(1);
  });
