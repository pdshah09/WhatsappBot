// bot/server.js
import fs from "fs";
import path from "path";

// add this function
function clearBrowserLock() {
  const lockFile = path.join(process.cwd(), ".wwebjs_auth", "RemoteAuth", "SingletonLock");
  try { fs.rmSync(lockFile, { force: true }); } catch {}
}
import pkg from "whatsapp-web.js";
const { Client, MessageMedia } = pkg;

import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import pkgMongo from "wwebjs-mongo";
const { MongoStore } = pkgMongo;
import { OptimizedRemoteAuth } from "./OptimizedRemoteAuth.js";

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000" }));
app.use(express.json({ limit: "50mb" }));

const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/whatsapp_bot";

// ── state ──────────────────────────────────────────────
let state = { status: "disconnected", qr: null, connectedAt: null };
let sse   = [];
let freshAuth = false;

// ── client ─────────────────────────────────────────────
let store, client;

async function createClient() {
  store = new MongoStore({ mongoose });
  client = new Client({
    authStrategy: new OptimizedRemoteAuth({
      store,
      backupSyncIntervalMs: 60000,
    }),
    qrMaxRetries: 5,
    puppeteer: {
      executablePath: process.env.CHROME_PATH
        || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      headless: true,
      args: [
        "--no-sandbox", "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", "--disable-accelerated-2d-canvas",
        "--no-first-run", "--no-zygote", "--disable-gpu",
      ],
      protocolTimeout: 300000,
    },
  });
  bindEvents();
}

// ── events ─────────────────────────────────────────────
function bindEvents() {
  client.on("qr",            (qr)  => { freshAuth = false; push({ type: "qr", qr }, { status: "qr", qr }); });
  client.on("authenticated", ()    => { freshAuth = true;  push({ type: "authenticated" }, { status: "authenticated" }); });
  client.on("auth_failure",  (msg) => { freshAuth = false; push({ type: "auth_failure", msg }, { status: "disconnected", qr: null }); });

  client.on("ready", async () => {
  const connectedAt = new Date().toISOString();
  push({ type: "ready", connectedAt }, { status: "connected", qr: null, connectedAt });
  // Always backup — idempotent, safe to run every time
  await client.authStrategy.storeRemoteSession({ emit: false })
    .catch((err) => console.error("Bot → Session backup failed:", err.message));
});

  client.on("disconnected", () => {
    freshAuth = false;
    push({ type: "disconnected" }, { status: "disconnected", qr: null, connectedAt: null });
  });
}

function push(event, patch = {}) {
  Object.assign(state, patch);
  sse.forEach((r) => r.write(`data: ${JSON.stringify(event)}\n\n`));
}

// ── SSE ────────────────────────────────────────────────
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "state", ...state })}\n\n`);
  sse.push(res);
  req.on("close", () => { sse = sse.filter((r) => r !== res); });
});

// ── REST ───────────────────────────────────────────────
app.get("/status", (_, res) => res.json(state));

app.post("/connect", async (_, res) => {
  // Guard: only act when truly disconnected — prevents double-initialize
  if (state.status !== "disconnected") {
    return res.json({ ok: true, status: state.status });
  }
  // Recreate client after a previous logout/destroy
  await createClient();
  clearBrowserLock();
  client.initialize();
  res.json({ ok: true, status: state.status });
});

app.post("/logout", async (_, res) => {
  await client.logout().catch(() => {});
  await client.destroy().catch(() => {});
  client = null; // ← mark as dead so /connect recreates it
  Object.assign(state, { status: "disconnected", qr: null, connectedAt: null });
  push({ type: "disconnected" });
  res.json({ ok: true });
});

app.post("/send", async (req, res) => {
  if (state.status !== "connected") return res.status(400).json({ error: "Not connected" });
  const { phone, message, attachment } = req.body;
  if (!phone || !message) return res.status(400).json({ error: "phone and message required" });
  try {
    const numberId = await client.getNumberId(phone.replace(/\D/g, ""));
    if (!numberId) return res.status(404).json({ error: "Number is not registered on WhatsApp" });
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

// ── boot ───────────────────────────────────────────────
mongoose.connect(mongoUri)
  .then(async () => {
    console.log("Bot → Connected to MongoDB");
    await createClient();
    clearBrowserLock();
    client.initialize(); // auto-restore session from MongoDB on every server start
    app.listen(3001, () => console.log("Bot → http://localhost:3001"));
  })
  .catch((err) => {
    console.error("Bot → MongoDB connection error:", err);
    process.exit(1);
  });
