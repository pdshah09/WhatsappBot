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

// ─── Session Metadata ─────────────────────────────────────────────────────────
const sessionMetaSchema = new mongoose.Schema({
  clientId:    { type: String, required: true, unique: true },
  label:       { type: String, default: '' },
  phone:       { type: String, default: null },
  name:        { type: String, default: null },
  connectedAt: { type: String, default: null },
  createdAt:   { type: Date,   default: Date.now },
});
const SessionMeta = mongoose.model('SessionMeta', sessionMetaSchema);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function clearBrowserLock(clientId) {
  const base = path.join(process.cwd(), '.wwebjs_auth');
  const sn   = clientId === 'RemoteAuth' ? 'RemoteAuth' : `RemoteAuth-${clientId}`;
  [path.join(base, sn, 'SingletonLock'), path.join(base, 'RemoteAuth', 'SingletonLock')]
    .forEach((p) => { try { fs.rmSync(p, { force: true }); } catch {} });
}

/**
 * Discover all saved sessions from wwebjs-mongo GridFS.
 *
 * wwebjs-mongo stores each session as a ZIP in GridFS:
 *   bucket name  : "whatsapp-RemoteAuth"   (configurable via storeName)
 *   collections  : whatsapp-RemoteAuth.files  +  whatsapp-RemoteAuth.chunks
 *   filename     : "RemoteAuth.zip"  (default)  |  "RemoteAuth-work.zip"  (named)
 *
 * NOTE: The screenshot shows collections like whatsapp-RemoteAuth-session-0 etc.
 * Those are legacy / broken attempts. The canonical GridFS bucket is
 * "whatsapp-RemoteAuth" and we read .files to discover valid sessions.
 */
async function discoverSavedSessions() {
  const db = mongoose.connection.db;
  let files = [];
  try {
    files = await db
      .collection('whatsapp-RemoteAuth.files')
      .find({}, { projection: { _id: 0, filename: 1 } })
      .toArray();
  } catch { return []; }

  const clientIds = [];
  const seen = new Set();
  for (const f of files) {
    const fn = f.filename ?? '';
    // "RemoteAuth.zip"       → clientId "RemoteAuth"
    // "RemoteAuth-work.zip"  → clientId "work"
    if (!fn.endsWith('.zip')) continue;
    const base     = fn.replace(/\.zip$/, '');
    const clientId = base === 'RemoteAuth' ? 'RemoteAuth' : base.replace(/^RemoteAuth-/, '');
    if (!seen.has(clientId)) { seen.add(clientId); clientIds.push(clientId); }
  }
  return clientIds;
}

// ─── SSE ──────────────────────────────────────────────────────────────────────
let sseClients = [];

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  sseClients = sseClients.filter((c) => {
    try { c.res.write(payload); return true; } catch { return false; }
  });
}

// ─── ClientManager ────────────────────────────────────────────────────────────
const clients      = new Map();
let   activeClientId = null;

function makeState(o = {}) {
  return { status: 'disconnected', qr: null, connectedAt: null, phone: null, name: null, label: null, ...o };
}
function getActive()      { return activeClientId ? clients.get(activeClientId) : null; }
function frontendState()  {
  const e = getActive();
  return e ? { ...e.state, activeSession: activeClientId } : { ...makeState(), activeSession: activeClientId };
}

async function upsertMeta(clientId, fields) {
  try {
    await SessionMeta.findOneAndUpdate({ clientId }, { $set: fields }, { upsert: true, new: true });
  } catch (err) { console.warn(`[meta] ${clientId}:`, err.message); }
}

async function saveSessionSafe(clientId, tag = '') {
  const entry = clients.get(clientId);
  if (!entry) return;
  for (let i = 1; i <= 2; i++) {
    try {
      await entry.client.authStrategy.storeRemoteSession();
      console.log(`[${clientId}] ${tag} saved (attempt ${i})`);
      return;
    } catch (err) {
      console.error(`[${clientId}] ${tag} save #${i} failed:`, err.message);
      if (i < 2) await sleep(3000);
    }
  }
}

async function createClient(clientId) {
  if (clients.has(clientId)) await destroyClient(clientId);

  const store        = new MongoStore({ mongoose });
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
        '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu',
      ],
      protocolTimeout: 300_000,
    },
  });

  const meta  = await SessionMeta.findOne({ clientId }).lean();
  const state = makeState({ status: 'initializing', label: meta?.label || clientId, phone: meta?.phone || null, name: meta?.name || null });

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
  if (activeClientId === clientId)
    activeClientId = clients.size > 0 ? [...clients.keys()][0] : null;
}

function bindEvents(clientId) {
  const entry = clients.get(clientId);
  if (!entry) return;
  const { client, state } = entry;

  const emit  = (ev) => { if (clientId === activeClientId) broadcast({ ...ev, activeSession: clientId }); };
  const patch = (ch, ev) => { Object.assign(state, ch); emit(ev); };

  client.on('qr',           (qr)  => patch({ status: 'qr', qr },             { type: 'qr', qr }));
  client.on('authenticated', ()   => patch({ status: 'authenticated' },       { type: 'authenticated' }));
  client.on('auth_failure',  (msg) => patch({ status: 'disconnected', qr: null }, { type: 'auth_failure', msg }));

  client.on('ready', async () => {
    const info        = client.info;
    const phone       = info?.wid?.user ?? null;
    const name        = info?.pushname   ?? null;
    const connectedAt = new Date().toISOString();
    const label       = (state.label && state.label !== clientId) ? state.label : (name || clientId);

    patch(
      { status: 'connected', qr: null, connectedAt, phone, name, label },
      { type: 'ready', connectedAt, phone, name, label }
    );
    await upsertMeta(clientId, { phone, name, label, connectedAt });
    await sleep(4000);
    await saveSessionSafe(clientId, 'ready');
  });

  client.on('disconnected', () => {
    patch({ status: 'disconnected', qr: null, connectedAt: null }, { type: 'disconnected' });
    clients.delete(clientId);
    if (activeClientId === clientId) {
      activeClientId = clients.size > 0 ? [...clients.keys()][0] : null;
      broadcast({ type: 'state', ...frontendState() });
    }
  });
}

// ─── SSE endpoint ─────────────────────────────────────────────────────────────
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'state', ...frontendState() })}\n\n`);
  sseClients.push({ res });
  req.on('close', () => { sseClients = sseClients.filter((c) => c.res !== res); });
});

// ─── REST endpoints ───────────────────────────────────────────────────────────

app.get('/status', (_, res) => res.json(frontendState()));

/**
 * GET /sessions
 * Discovers sessions from GridFS (.files collection), enriches with
 * SessionMeta (display name/phone) and in-memory live state.
 */
app.get('/sessions', async (_, res) => {
  try {
    const savedClientIds = await discoverSavedSessions();
    const allMeta        = await SessionMeta.find({}).lean();
    const metaMap        = Object.fromEntries(allMeta.map((m) => [m.clientId, m]));

    const result = [];
    const seen   = new Set();

    for (const clientId of savedClientIds) {
      seen.add(clientId);
      const meta   = metaMap[clientId];
      const entry  = clients.get(clientId);
      result.push({
        clientId,
        sessionName: clientId === 'RemoteAuth' ? 'RemoteAuth' : `RemoteAuth-${clientId}`,
        label:  entry?.state?.label || meta?.label || clientId,
        phone:  entry?.state?.phone || meta?.phone || null,
        name:   entry?.state?.name  || meta?.name  || null,
        status: entry?.state?.status ?? 'saved',
      });
    }

    // In-memory clients not yet saved (new QR sessions)
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /connect
 * Body: { sessionId?: string, label?: string }
 */
app.post('/connect', async (req, res) => {
  const { sessionId, label } = req.body ?? {};
  const clientId = sessionId || `session-${Date.now()}`;

  const existing = clients.get(clientId);
  if (existing) {
    activeClientId = clientId;
    const s = existing.state.status;
    if (s === 'connected') {
      broadcast({ type: 'state', ...frontendState() });
      return res.json({ ok: true, status: 'connected', activeSession: clientId });
    }
    if (['initializing', 'qr', 'authenticated'].includes(s))
      return res.json({ ok: true, status: s, activeSession: clientId });
  }

  await createClient(clientId);
  if (label) { clients.get(clientId).state.label = label; await upsertMeta(clientId, { label }); }
  clearBrowserLock(clientId);
  activeClientId = clientId;
  clients.get(clientId).client.initialize();

  res.json({ ok: true, status: 'initializing', activeSession: clientId, isRestore: !!sessionId });
});

/** POST /switch */
app.post('/switch', (req, res) => {
  const { sessionId } = req.body ?? {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const entry = clients.get(sessionId);
  if (!entry) return res.status(404).json({ error: 'Session not loaded' });
  activeClientId = sessionId;
  broadcast({ type: 'state', ...frontendState() });
  res.json({ ok: true, ...frontendState() });
});

/** POST /logout */
app.post('/logout', async (req, res) => {
  const clientId = req.body?.sessionId || activeClientId;
  if (!clientId) return res.json({ ok: true });

  await destroyClient(clientId);

  try {
    const sessionName = clientId === 'RemoteAuth' ? 'RemoteAuth' : `RemoteAuth-${clientId}`;
    const store = new MongoStore({ mongoose });
    await store.delete({ session: sessionName }).catch(() => {});
    await SessionMeta.deleteOne({ clientId }).catch(() => {});
  } catch {}

  broadcast({ type: 'state', ...frontendState() });
  res.json({ ok: true });
});

/** GET /chats — returns chats WITH profilePicUrl */
app.get('/chats', async (_, res) => {
  const entry = getActive();
  if (!entry || entry.state.status !== 'connected')
    return res.status(503).json({ error: 'Not connected' });
  try {
    const chats = await entry.client.getChats();
    const slice = chats.slice(0, 40);

    // Fetch profile pics in parallel (failures are silently null)
    const pics = await Promise.allSettled(
      slice.map((c) => entry.client.getProfilePicUrl(c.id._serialized))
    );

    res.json(slice.map((c, i) => ({
      id:            c.id._serialized,
      name:          c.name,
      isGroup:       c.isGroup,
      unreadCount:   c.unreadCount,
      timestamp:     c.timestamp,
      profilePicUrl: pics[i].status === 'fulfilled' ? (pics[i].value ?? null) : null,
      lastMessage:   c.lastMessage
        ? { body: c.lastMessage.body?.slice(0, 80) ?? '', fromMe: c.lastMessage.fromMe,
            timestamp: c.lastMessage.timestamp, hasMedia: c.lastMessage.hasMedia }
        : null,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** GET /chats/:id/messages */
app.get('/chats/:id/messages', async (req, res) => {
  const entry = getActive();
  if (!entry || entry.state.status !== 'connected')
    return res.status(503).json({ error: 'Not connected' });
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  try {
    const chat = await entry.client.getChatById(req.params.id);
    const msgs = await chat.fetchMessages({ limit });
    res.json(msgs.map((m) => ({
      id: m.id._serialized, body: m.body, fromMe: m.fromMe,
      author: m.author ?? null, timestamp: m.timestamp, hasMedia: m.hasMedia, type: m.type,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** POST /send */
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

// ─── Boot: auto-restore all saved sessions ───────────────────────────────────
async function autoRestoreSessions() {
  const savedClientIds = await discoverSavedSessions();

  if (savedClientIds.length === 0) {
    console.log('Bot → No saved sessions. Waiting for first connect.');
    return;
  }

  console.log(`Bot → Restoring ${savedClientIds.length} session(s):`, savedClientIds);

  for (const clientId of savedClientIds) {
    console.log(`Bot → Initializing [${clientId}]…`);
    await createClient(clientId);
    clearBrowserLock(clientId);
    if (!activeClientId) activeClientId = clientId;
    clients.get(clientId).client.initialize();
    if (savedClientIds.length > 1) await sleep(3000);
  }
}

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log('Bot → MongoDB connected');
    await autoRestoreSessions();
    app.listen(3001, () => console.log('Bot → http://localhost:3001'));
  })
  .catch((err) => { console.error('Bot → MongoDB error:', err); process.exit(1); });
