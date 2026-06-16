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
let state = { status: 'disconnected', qr: null, connectedAt: null, activeSession: null };
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

async function createClient(sessionId = 'RemoteAuth') {
  store  = new MongoStore({ mongoose });
  client = new Client({
    authStrategy: new OptimizedRemoteAuth({
      clientId: sessionId === 'RemoteAuth' ? undefined : sessionId,
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
  bindEvents(sessionId);
}

// ── events ─────────────────────────────────────────────────────────────────
function bindEvents(sessionId) {
  client.on('qr',            (qr)  => push({ type: 'qr', qr },           { status: 'qr', qr }));
  client.on('authenticated', ()    => push({ type: 'authenticated' },     { status: 'authenticated' }));
  client.on('auth_failure',  (msg) => push({ type: 'auth_failure', msg }, { status: 'disconnected', qr: null, activeSession: null }));

  client.on('ready', async () => {
    const connectedAt = new Date().toISOString();
    push(
      { type: 'ready', connectedAt, activeSession: sessionId },
      { status: 'connected', qr: null, connectedAt, activeSession: sessionId }
    );
    await sleep(4000);
    await saveSessionSafe('ready');
  });

  client.on('disconnected', () =>
    push({ type: 'disconnected' }, { status: 'disconnected', qr: null, connectedAt: null, activeSession: null })
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
 * GET /sessions
 * Lists all saved session IDs from MongoDB.
 * Reads the wwebjs-mongo collection directly.
 */
app.get('/sessions', async (_, res) => {
  try {
    // wwebjs-mongo stores docs with { id: "RemoteAuth-<clientId>" }
    // Access via the underlying mongoose model if available, else raw collection
    const db   = mongoose.connection.db;
    const docs  = await db.collection('whatsapp-RemoteAuth').find({}, { projection: { _id: 0, id: 1 } }).toArray();
    const sessions = docs.map((d) => {
      const raw = d.id ?? '';
      // Strip "RemoteAuth-" prefix added by wwebjs
      const id    = raw.replace(/^RemoteAuth-?/, '') || 'default';
      const label = id === 'default' ? 'Default Session' : id;
      return { id: raw, label };
    });
    res.json(sessions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/session-exists', async (_, res) => {
  try {
    const s = new MongoStore({ mongoose });
    const exists = await s.sessionExists({ session: 'RemoteAuth' });
    res.json({ exists: !!exists });
  } catch {
    res.json({ exists: false });
  }
});

/**
 * GET /chats
 */
app.get('/chats', async (_, res) => {
  if (state.status !== 'connected') return res.status(503).json({ error: 'Not connected' });
  try {
    const chats = await client.getChats();
    const payload = chats.slice(0, 30).map((c) => ({
      id:          c.id._serialized,
      name:        c.name,
      isGroup:     c.isGroup,
      unreadCount: c.unreadCount,
      timestamp:   c.timestamp,
      lastMessage: c.lastMessage
        ? {
            body:      c.lastMessage.body?.slice(0, 60) ?? '',
            fromMe:    c.lastMessage.fromMe,
            timestamp: c.lastMessage.timestamp,
            hasMedia:  c.lastMessage.hasMedia,
          }
        : null,
    }));
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /chats/:id/messages?limit=20
 */
app.get('/chats/:id/messages', async (req, res) => {
  if (state.status !== 'connected') return res.status(503).json({ error: 'Not connected' });
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  try {
    const chat = await client.getChatById(req.params.id);
    const msgs = await chat.fetchMessages({ limit });
    const payload = msgs.map((m) => ({
      id:        m.id._serialized,
      body:      m.body,
      fromMe:    m.fromMe,
      author:    m.author ?? null,
      timestamp: m.timestamp,
      hasMedia:  m.hasMedia,
      type:      m.type,
    }));
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /connect
 * Body: { sessionId?: string }
 * sessionId is the raw doc id from /sessions (e.g. "RemoteAuth-work") or
 * undefined / "new" to start a fresh QR session.
 */
app.post('/connect', async (req, res) => {
  if (state.status !== 'disconnected') return res.json({ ok: true, status: state.status });

  const rawId     = req.body?.sessionId;
  // Derive the clientId that OptimizedRemoteAuth expects (strip prefix)
  const clientId  = rawId && rawId !== 'new'
    ? rawId.replace(/^RemoteAuth-?/, '') || undefined
    : undefined;

  await createClient(clientId || 'RemoteAuth');
  clearBrowserLock();
  Object.assign(state, { status: 'initializing', activeSession: clientId || null });
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
  Object.assign(state, { status: 'disconnected', qr: null, connectedAt: null, activeSession: null });
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
    Object.assign(state, { status: 'initializing' });
    client.initialize();
    app.listen(3001, () => console.log('Bot → http://localhost:3001'));
  })
  .catch((err) => {
    console.error('Bot → MongoDB connection error:', err);
    process.exit(1);
  });
