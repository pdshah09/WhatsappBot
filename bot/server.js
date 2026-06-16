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

// ─── Session Metadata Schema ──────────────────────────────────────────────────
// Persists display name + phone across server restarts.
const sessionMetaSchema = new mongoose.Schema({
  clientId:    { type: String, required: true, unique: true }, // e.g. "RemoteAuth" | "work"
  label:       { type: String, default: '' },                  // user-visible name
  phone:       { type: String, default: null },
  name:        { type: String, default: null },                // WA pushname
  connectedAt: { type: String, default: null },
  createdAt:   { type: Date,   default: Date.now },
});
const SessionMeta = mongoose.model('SessionMeta', sessionMetaSchema);

// ─── helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function clearBrowserLock(clientId) {
  const base = path.join(process.cwd(), '.wwebjs_auth');
  const sessionName = clientId === 'RemoteAuth' ? 'RemoteAuth' : `RemoteAuth-${clientId}`;
  const candidates  = [
    path.join(base, sessionName, 'SingletonLock'),
    path.join(base, 'RemoteAuth', 'SingletonLock'),
  ];
  candidates.forEach((p) => { try { fs.rmSync(p, { force: true }); } catch {} });
}

// ─── SSE broadcast ────────────────────────────────────────────────────────────
let sseClients = [];

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  sseClients = sseClients.filter((c) => {
    try { c.res.write(payload); return true; } catch { return false; }
  });
}

// ─── ClientManager ────────────────────────────────────────────────────────────
//
// Key invariant: Map key is ALWAYS the raw wwebjs clientId string:
//   default session  → "RemoteAuth"
//   named sessions   → "work", "personal", etc. (NOT "RemoteAuth-work")
//
// wwebjs internally converts clientId → sessionName:
//   clientId = undefined  → sessionName = "RemoteAuth"
//   clientId = "work"     → sessionName = "RemoteAuth-work"
//
// The MongoDB wwebjs-mongo collection stores docs with id = sessionName.

const clients = new Map(); // clientId → { client, state }
let   activeClientId = null;

function makeState(overrides = {}) {
  return {
    status:      'disconnected',
    qr:          null,
    connectedAt: null,
    phone:       null,
    name:        null,
    label:       null,
    ...overrides,
  };
}

function getActive() {
  return activeClientId ? clients.get(activeClientId) : null;
}

function frontendState() {
  const entry = getActive();
  if (!entry) return { ...makeState(), activeSession: activeClientId };
  return { ...entry.state, activeSession: activeClientId };
}

// Persist name/phone/label to MongoDB so they survive restarts
async function upsertMeta(clientId, fields) {
  try {
    await SessionMeta.findOneAndUpdate(
      { clientId },
      { $set: fields },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.warn(`[meta] upsert failed for ${clientId}:`, err.message);
  }
}

async function saveSessionSafe(clientId, tag = '') {
  const entry = clients.get(clientId);
  if (!entry) return;
  for (let i = 1; i <= 2; i++) {
    try {
      await entry.client.authStrategy.storeRemoteSession();
      console.log(`[${clientId}] ${tag} session saved (attempt ${i})`);
      return;
    } catch (err) {
      console.error(`[${clientId}] ${tag} save attempt ${i} failed:`, err.message);
      if (i < 2) await sleep(3000);
    }
  }
}

// ─── createClient ─────────────────────────────────────────────────────────────
async function createClient(clientId) {
  if (clients.has(clientId)) await destroyClient(clientId);

  const store = new MongoStore({ mongoose });

  // wwebjs rule: default session passes clientId=undefined; named passes the string
  const wwjsClientId = clientId === 'RemoteAuth' ? undefined : clientId;

  const client = new Client({
    authStrategy: new OptimizedRemoteAuth({
      clientId: wwjsClientId,
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

  // Restore persisted label/phone/name so UI shows them during initializing
  const meta  = await SessionMeta.findOne({ clientId }).lean();
  const state = makeState({
    status: 'initializing',
    label:  meta?.label || clientId,
    phone:  meta?.phone || null,
    name:   meta?.name  || null,
  });

  clients.set(clientId, { client, state });
  bindEvents(clientId);
  return { client, state };
}

async function destroyClient(clientId) {
  const entry = clients.get(clientId);
  if (!entry) return;
  try {
    if (entry.state.status === 'connected') await saveSessionSafe(clientId, 'destroy');
    await entry.client.logout().catch(() => {});
    await entry.client.destroy().catch(() => {});
  } catch {}
  clients.delete(clientId);
  if (activeClientId === clientId) {
    activeClientId = clients.size > 0 ? [...clients.keys()][0] : null;
  }
}

// ─── Event binding ────────────────────────────────────────────────────────────
function bindEvents(clientId) {
  const entry = clients.get(clientId);
  if (!entry) return;
  const { client, state } = entry;

  // Only broadcast if this is the session the frontend is watching
  const emit = (event) => {
    if (clientId === activeClientId) broadcast({ ...event, activeSession: clientId });
  };

  const patch = (changes, event) => {
    Object.assign(state, changes);
    emit(event);
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
    const info        = client.info;
    const phone       = info?.wid?.user ?? null;
    const name        = info?.pushname   ?? null;
    const connectedAt = new Date().toISOString();
    // Use WA name as label if we have no custom one yet
    const label = state.label && state.label !== clientId ? state.label : (name || clientId);

    patch(
      { status: 'connected', qr: null, connectedAt, phone, name, label },
      { type: 'ready', connectedAt, phone, name, label }
    );

    // Persist to MongoDB so it survives restarts
    await upsertMeta(clientId, { phone, name, label, connectedAt });

    await sleep(4000);
    await saveSessionSafe(clientId, 'ready');
  });

  client.on('disconnected', () => {
    patch(
      { status: 'disconnected', qr: null, connectedAt: null },
      { type: 'disconnected' }
    );
    clients.delete(clientId);
    // Switch active to next available session
    if (activeClientId === clientId) {
      activeClientId = clients.size > 0 ? [...clients.keys()][0] : null;
      broadcast({ type: 'state', ...frontendState() });
    }
  });
}

// ─── SSE ─────────────────────────────────────────────────────────────────────
app.get('/events', (req, res) => {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  // Immediate snapshot so the frontend never waits for the first event
  res.write(`data: ${JSON.stringify({ type: 'state', ...frontendState() })}\n\n`);
  sseClients.push({ res });
  req.on('close', () => { sseClients = sseClients.filter((c) => c.res !== res); });
});

// ─── REST ────────────────────────────────────────────────────────────────────

// GET /status — lightweight poll for page.tsx boot redirect
app.get('/status', (_, res) => res.json(frontendState()));

/**
 * GET /sessions
 * Returns ALL sessions: saved in MongoDB + currently running in memory.
 * Shape: { clientId, sessionName, label, phone, name, status }
 */
app.get('/sessions', async (_, res) => {
  try {
    const db   = mongoose.connection.db;
    // wwebjs-mongo stores docs in the collection named by the MongoStore option
    // (defaults to 'whatsapp-RemoteAuth').  Each doc has { id: sessionName }.
    const docs = await db
      .collection('whatsapp-RemoteAuth')
      .find({}, { projection: { _id: 0, id: 1 } })
      .toArray();

    // Load all metadata from our own collection for display names
    const allMeta = await SessionMeta.find({}).lean();
    const metaMap = Object.fromEntries(allMeta.map((m) => [m.clientId, m]));

    const result = [];
    const seen   = new Set();

    // From MongoDB wwebjs docs
    for (const doc of docs) {
      const sessionName = doc.id ?? '';
      // sessionName = "RemoteAuth" | "RemoteAuth-work"
      const clientId = sessionName === 'RemoteAuth'
        ? 'RemoteAuth'
        : sessionName.replace(/^RemoteAuth-/, '');

      if (seen.has(clientId)) continue;
      seen.add(clientId);

      const meta   = metaMap[clientId];
      const entry  = clients.get(clientId);
      const status = entry?.state?.status ?? 'saved';

      result.push({
        clientId,
        sessionName,
        label:  entry?.state?.label || meta?.label || clientId,
        phone:  entry?.state?.phone || meta?.phone || null,
        name:   entry?.state?.name  || meta?.name  || null,
        status,
      });
    }

    // Add in-memory clients not yet saved (brand-new sessions still scanning QR)
    for (const [cid, entry] of clients.entries()) {
      if (seen.has(cid)) continue;
      const meta = metaMap[cid];
      result.push({
        clientId:    cid,
        sessionName: cid === 'RemoteAuth' ? 'RemoteAuth' : `RemoteAuth-${cid}`,
        label:  entry.state.label || meta?.label || cid,
        phone:  entry.state.phone || meta?.phone || null,
        name:   entry.state.name  || meta?.name  || null,
        status: entry.state.status,
      });
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /session-exists — quick boot check (does the default session exist?)
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
 * Body: { sessionId?: string, label?: string }
 *   sessionId = clientId from GET /sessions (e.g. "RemoteAuth" | "work")
 *   label     = custom display name for new sessions
 *
 * Lifecycle:
 *   1. sessionId given + already connected  → switch active, return immediately
 *   2. sessionId given + in progress        → switch active, return current status
 *   3. sessionId given + saved in Mongo     → restore session, go to /session
 *   4. no sessionId                         → new QR session, go to /qr
 */
app.post('/connect', async (req, res) => {
  const { sessionId, label } = req.body ?? {};

  // Determine clientId — default session always uses 'RemoteAuth' as the key
  const clientId = sessionId || `session-${Date.now()}`;

  // Case 1 & 2: already in memory
  const existing = clients.get(clientId);
  if (existing) {
    activeClientId = clientId;
    const s = existing.state.status;
    if (s === 'connected') {
      broadcast({ type: 'state', ...frontendState() });
      return res.json({ ok: true, status: 'connected', activeSession: clientId });
    }
    if (['initializing', 'qr', 'authenticated'].includes(s)) {
      return res.json({ ok: true, status: s, activeSession: clientId });
    }
  }

  // Case 3 & 4: create (or recreate) client
  await createClient(clientId);
  if (label) {
    clients.get(clientId).state.label = label;
    await upsertMeta(clientId, { label });
  }
  clearBrowserLock(clientId);
  activeClientId = clientId;

  // Fire and forget — events arrive via SSE
  clients.get(clientId).client.initialize();

  const isRestore = !!sessionId;
  res.json({ ok: true, status: 'initializing', activeSession: clientId, isRestore });
});

/**
 * POST /switch
 * Switch active session to an already-running one.
 */
app.post('/switch', (req, res) => {
  const { sessionId } = req.body ?? {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const entry = clients.get(sessionId);
  if (!entry) return res.status(404).json({ error: 'Session not loaded' });
  activeClientId = sessionId;
  broadcast({ type: 'state', ...frontendState() });
  res.json({ ok: true, ...frontendState() });
});

/**
 * POST /logout
 * Body: { sessionId?: string } — logout target or active session.
 * Deletes wwebjs session from MongoDB and our metadata.
 */
app.post('/logout', async (req, res) => {
  const clientId = req.body?.sessionId || activeClientId;
  if (!clientId) return res.json({ ok: true });

  await destroyClient(clientId);

  // Remove from wwebjs-mongo collection
  try {
    const s           = new MongoStore({ mongoose });
    const sessionName = clientId === 'RemoteAuth' ? 'RemoteAuth' : `RemoteAuth-${clientId}`;
    await s.delete({ session: sessionName }).catch(() => {});
    await SessionMeta.deleteOne({ clientId }).catch(() => {});
  } catch {}

  broadcast({ type: 'state', ...frontendState() });
  res.json({ ok: true });
});

// GET /chats
app.get('/chats', async (_, res) => {
  const entry = getActive();
  if (!entry || entry.state.status !== 'connected')
    return res.status(503).json({ error: 'Not connected' });
  try {
    const chats = await entry.client.getChats();
    res.json(chats.slice(0, 30).map((c) => ({
      id:          c.id._serialized,
      name:        c.name,
      isGroup:     c.isGroup,
      unreadCount: c.unreadCount,
      timestamp:   c.timestamp,
      lastMessage: c.lastMessage
        ? { body: c.lastMessage.body?.slice(0, 60) ?? '', fromMe: c.lastMessage.fromMe,
            timestamp: c.lastMessage.timestamp, hasMedia: c.lastMessage.hasMedia }
        : null,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /chats/:id/messages
app.get('/chats/:id/messages', async (req, res) => {
  const entry = getActive();
  if (!entry || entry.state.status !== 'connected')
    return res.status(503).json({ error: 'Not connected' });
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  try {
    const chat    = await entry.client.getChatById(req.params.id);
    const msgs    = await chat.fetchMessages({ limit });
    res.json(msgs.map((m) => ({
      id: m.id._serialized, body: m.body, fromMe: m.fromMe,
      author: m.author ?? null, timestamp: m.timestamp, hasMedia: m.hasMedia, type: m.type,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /send
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

// ─── Boot ─────────────────────────────────────────────────────────────────────
// On startup: restore ALL saved sessions automatically.
async function autoRestoreSessions() {
  const db   = mongoose.connection.db;
  let   docs = [];
  try {
    docs = await db
      .collection('whatsapp-RemoteAuth')
      .find({}, { projection: { _id: 0, id: 1 } })
      .toArray();
  } catch {
    console.log('Bot → No sessions in MongoDB yet.');
  }

  if (docs.length === 0) {
    console.log('Bot → No saved sessions. Waiting for first connect.');
    return;
  }

  console.log(`Bot → Restoring ${docs.length} saved session(s)…`);
  for (const doc of docs) {
    const sessionName = doc.id ?? '';
    const clientId = sessionName === 'RemoteAuth'
      ? 'RemoteAuth'
      : sessionName.replace(/^RemoteAuth-/, '');

    console.log(`Bot → Restoring [${clientId}]…`);
    await createClient(clientId);
    clearBrowserLock(clientId);
    if (!activeClientId) activeClientId = clientId;
    clients.get(clientId).client.initialize();

    // Stagger initializations to avoid Puppeteer resource contention
    if (docs.length > 1) await sleep(3000);
  }
}

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log('Bot → Connected to MongoDB');
    await autoRestoreSessions();
    app.listen(3001, () => console.log('Bot → http://localhost:3001'));
  })
  .catch((err) => {
    console.error('Bot → MongoDB connection error:', err);
    process.exit(1);
  });
