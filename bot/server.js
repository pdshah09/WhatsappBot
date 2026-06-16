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
const { MongoStore }           = pkgMongo;

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '50mb' }));

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/whatsapp_bot';

// ─── helpers ────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function clearBrowserLock(clientId) {
  // lock path differs per clientId when using RemoteAuth
  const base = path.join(process.cwd(), '.wwebjs_auth');
  const candidates = [
    path.join(base, 'RemoteAuth', 'SingletonLock'),
    path.join(base, `RemoteAuth-${clientId}`, 'SingletonLock'),
  ];
  candidates.forEach((p) => { try { fs.rmSync(p, { force: true }); } catch {} });
}

// ─── SSE broadcast ──────────────────────────────────────────────────────────
let sseClients = []; // { res, sessionId: string | null }

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  sseClients = sseClients.filter((c) => {
    try { c.res.write(payload); return true; } catch { return false; }
  });
}

// ─── ClientManager ──────────────────────────────────────────────────────────
// Manages multiple simultaneous WhatsApp clients.
// state shape: { status, qr, connectedAt, activeSession, phone, name }

const clients = new Map(); // clientId → { client, state }

function makeState(overrides = {}) {
  return {
    status: 'disconnected',
    qr: null,
    connectedAt: null,
    activeSession: null,
    phone: null,
    name: null,
    ...overrides,
  };
}

// The "active" session the frontend is currently watching
let activeClientId = null;

function getActive() {
  return activeClientId ? clients.get(activeClientId) : null;
}

// Aggregate state for the active session (what the frontend sees)
function frontendState() {
  const entry = getActive();
  if (!entry) return makeState();
  return { ...entry.state, activeSession: activeClientId };
}

async function saveSessionSafe(clientId, label = '') {
  const entry = clients.get(clientId);
  if (!entry) return;
  const tag = label ? `[${label}] ` : '';
  for (let i = 1; i <= 2; i++) {
    try {
      await entry.client.authStrategy.storeRemoteSession();
      console.log(`Bot → [${clientId}] ${tag}Session saved (attempt ${i})`);
      return;
    } catch (err) {
      console.error(`Bot → [${clientId}] ${tag}Save attempt ${i} failed:`, err.message);
      if (i < 2) await sleep(3000);
    }
  }
}

async function createClient(clientId) {
  // Destroy any existing client for this id
  if (clients.has(clientId)) {
    await destroyClient(clientId);
  }

  const store  = new MongoStore({ mongoose });
  const isDefault = clientId === 'RemoteAuth';

  const client = new Client({
    authStrategy: new OptimizedRemoteAuth({
      clientId: isDefault ? undefined : clientId,
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
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas', '--no-first-run',
        '--no-zygote', '--disable-gpu',
      ],
      protocolTimeout: 300_000,
    },
  });

  const state = makeState({ activeSession: clientId });
  clients.set(clientId, { client, state });
  bindEvents(clientId);
  return { client, state };
}

async function destroyClient(clientId) {
  const entry = clients.get(clientId);
  if (!entry) return;
  try {
    if (entry.state.status === 'connected') {
      await saveSessionSafe(clientId, 'destroy');
    }
    await entry.client.logout().catch(() => {});
    await entry.client.destroy().catch(() => {});
  } catch {}
  clients.delete(clientId);
  if (activeClientId === clientId) {
    activeClientId = clients.size > 0 ? [...clients.keys()][0] : null;
  }
}

// ─── events ─────────────────────────────────────────────────────────────────
function bindEvents(clientId) {
  const entry = clients.get(clientId);
  if (!entry) return;
  const { client, state } = entry;

  const patch = (changes, event) => {
    Object.assign(state, changes);
    if (clientId === activeClientId) {
      broadcast({ ...event, activeSession: clientId });
    }
  };

  client.on('qr', (qr) =>
    patch({ status: 'qr', qr }, { type: 'qr', qr })
  );

  client.on('authenticated', () =>
    patch({ status: 'authenticated' }, { type: 'authenticated' })
  );

  client.on('auth_failure', (msg) =>
    patch({ status: 'disconnected', qr: null }, { type: 'auth_failure', msg })
  );

  client.on('ready', async () => {
    const connectedAt = new Date().toISOString();
    // Grab phone/name from the client's own info if available
    const info = client.info;
    const phone = info?.wid?.user ?? null;
    const name  = info?.pushname ?? null;
    patch(
      { status: 'connected', qr: null, connectedAt, phone, name },
      { type: 'ready', connectedAt, phone, name }
    );
    await sleep(4000);
    await saveSessionSafe(clientId, 'ready');
  });

  client.on('disconnected', () => {
    patch(
      { status: 'disconnected', qr: null, connectedAt: null, phone: null, name: null },
      { type: 'disconnected' }
    );
    clients.delete(clientId);
    if (activeClientId === clientId) {
      activeClientId = clients.size > 0 ? [...clients.keys()][0] : null;
      // If another session is available, emit its state
      if (activeClientId) {
        broadcast({ type: 'state', ...frontendState() });
      }
    }
  });
}

// ─── SSE ────────────────────────────────────────────────────────────────────
app.get('/events', (req, res) => {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  // Send current state snapshot immediately
  res.write(`data: ${JSON.stringify({ type: 'state', ...frontendState() })}\n\n`);
  sseClients.push({ res });
  req.on('close', () => { sseClients = sseClients.filter((c) => c.res !== res); });
});

// ─── REST ────────────────────────────────────────────────────────────────────
app.get('/status', (_, res) => res.json(frontendState()));

/**
 * GET /sessions
 * Returns all saved session docs from MongoDB.
 * wwebjs-mongo stores docs in the collection "whatsapp-RemoteAuth".
 * Doc shape: { _id, id: "RemoteAuth" | "RemoteAuth-{clientId}" }
 */
app.get('/sessions', async (_, res) => {
  try {
    const db   = mongoose.connection.db;
    const docs = await db
      .collection('whatsapp-RemoteAuth')
      .find({}, { projection: { _id: 0, id: 1 } })
      .toArray();

    const sessions = docs.map((d) => {
      const raw   = d.id ?? '';
      const clientId = raw.replace(/^RemoteAuth-?/, '') || 'default';
      const label    = clientId === 'default' ? 'Default' : clientId;
      // Is this session currently active/connected?
      const entry  = clients.get(raw) || clients.get(clientId);
      const status = entry?.state?.status ?? 'saved';
      return { id: raw, clientId, label, status };
    });
    // Also include in-memory clients that may not yet be saved
    for (const [cid, entry] of clients.entries()) {
      if (!sessions.find((s) => s.id === cid || s.clientId === cid)) {
        sessions.push({ id: cid, clientId: cid, label: cid, status: entry.state.status });
      }
    }
    res.json(sessions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/session-exists', async (_, res) => {
  try {
    const s      = new MongoStore({ mongoose });
    const exists = await s.sessionExists({ session: 'RemoteAuth' });
    res.json({ exists: !!exists });
  } catch {
    res.json({ exists: false });
  }
});

/**
 * POST /connect
 * Body: { sessionId?: string }  — raw doc id e.g. "RemoteAuth-work" or undefined for new QR
 * Behaviour:
 *   1. If sessionId provided → restore existing session, skip QR
 *   2. If sessionId omitted  → new QR session (clientId = uuid-ish timestamp)
 *   3. If target session already connected → just switch active, return immediately
 */
app.post('/connect', async (req, res) => {
  const rawId    = req.body?.sessionId;
  // Derive simple clientId from raw doc id
  const clientId = rawId
    ? (rawId.replace(/^RemoteAuth-?/, '') || 'default')
    : `session-${Date.now()}`;

  // Already connected for this clientId → switch active and return
  const existing = clients.get(clientId) || clients.get(rawId);
  if (existing?.state?.status === 'connected') {
    activeClientId = clientId;
    broadcast({ type: 'state', ...frontendState() });
    return res.json({ ok: true, status: 'connected', activeSession: clientId });
  }

  // If client exists but isn't connected yet → return its current status
  if (existing && ['initializing', 'qr', 'authenticated'].includes(existing.state.status)) {
    activeClientId = clientId;
    return res.json({ ok: true, status: existing.state.status, activeSession: clientId });
  }

  await createClient(clientId);
  clearBrowserLock(clientId);
  activeClientId = clientId;
  clients.get(clientId).state.status = 'initializing';
  clients.get(clientId).client.initialize();
  res.json({ ok: true, status: 'initializing', activeSession: clientId });
});

/**
 * POST /switch
 * Body: { sessionId: string }  — switch active session without destroying others
 */
app.post('/switch', (req, res) => {
  const rawId    = req.body?.sessionId;
  const clientId = rawId?.replace(/^RemoteAuth-?/, '') || rawId;
  const entry    = clients.get(clientId);
  if (!entry) return res.status(404).json({ error: 'Session not found or not running' });
  activeClientId = clientId;
  broadcast({ type: 'state', ...frontendState() });
  res.json({ ok: true, ...frontendState() });
});

/**
 * POST /logout
 * Body: { sessionId?: string }  — logout specific session or active one
 */
app.post('/logout', async (req, res) => {
  const rawId    = req.body?.sessionId;
  const clientId = rawId
    ? (rawId.replace(/^RemoteAuth-?/, '') || 'default')
    : activeClientId;

  if (!clientId) return res.json({ ok: true });
  await destroyClient(clientId);
  broadcast({ type: 'disconnected', activeSession: activeClientId });
  // Send updated state so frontend knows which session is now active
  broadcast({ type: 'state', ...frontendState() });
  res.json({ ok: true });
});

/**
 * GET /chats — for active session
 */
app.get('/chats', async (_, res) => {
  const entry = getActive();
  if (!entry || entry.state.status !== 'connected')
    return res.status(503).json({ error: 'Not connected' });
  try {
    const chats   = await entry.client.getChats();
    const payload = chats.slice(0, 30).map((c) => ({
      id:          c.id._serialized,
      name:        c.name,
      isGroup:     c.isGroup,
      unreadCount: c.unreadCount,
      timestamp:   c.timestamp,
      lastMessage: c.lastMessage
        ? { body: c.lastMessage.body?.slice(0, 60) ?? '', fromMe: c.lastMessage.fromMe,
            timestamp: c.lastMessage.timestamp, hasMedia: c.lastMessage.hasMedia }
        : null,
    }));
    res.json(payload);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * GET /chats/:id/messages
 */
app.get('/chats/:id/messages', async (req, res) => {
  const entry = getActive();
  if (!entry || entry.state.status !== 'connected')
    return res.status(503).json({ error: 'Not connected' });
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  try {
    const chat    = await entry.client.getChatById(req.params.id);
    const msgs    = await chat.fetchMessages({ limit });
    const payload = msgs.map((m) => ({
      id: m.id._serialized, body: m.body, fromMe: m.fromMe,
      author: m.author ?? null, timestamp: m.timestamp, hasMedia: m.hasMedia, type: m.type,
    }));
    res.json(payload);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /send — for active session
 */
app.post('/send', async (req, res) => {
  const entry = getActive();
  if (!entry || entry.state.status !== 'connected')
    return res.status(400).json({ error: 'Not connected' });
  const { phone, message, attachment } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });
  try {
    const numberId = await entry.client.getNumberId(phone.replace(/\D/g, ''));
    if (!numberId) return res.status(404).json({ error: 'Number not on WhatsApp' });
    const chatId = numberId._serialized;
    if (attachment) {
      const media = new MessageMedia(attachment.mimetype, attachment.data, attachment.filename);
      await entry.client.sendMessage(chatId, media, { caption: message });
    } else {
      await entry.client.sendMessage(chatId, message);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── boot ────────────────────────────────────────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Bot → Connected to MongoDB');
    // Auto-start the default session on boot (existing behaviour preserved)
    await createClient('RemoteAuth');
    clearBrowserLock('RemoteAuth');
    activeClientId = 'RemoteAuth';
    clients.get('RemoteAuth').state.status = 'initializing';
    clients.get('RemoteAuth').client.initialize();
    app.listen(3001, () => console.log('Bot → http://localhost:3001'));
  })
  .catch((err) => {
    console.error('Bot → MongoDB connection error:', err);
    process.exit(1);
  });
