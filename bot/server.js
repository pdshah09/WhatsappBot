// bot/server.js

import pkg from "whatsapp-web.js";
const { Client, MessageMedia } = pkg;

import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import pkgMongo from "wwebjs-mongo";
const { MongoStore } = pkgMongo;
import { OptimizedRemoteAuth } from "./OptimizedRemoteAuth.js";

const app = express();
app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json({ limit: "50mb" }));

// Connect to MongoDB for session storage
const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/whatsapp_bot";
mongoose.connect(mongoUri)
  .then(() => console.log("Bot → Connected to MongoDB for session storage"))
  .catch((err) => console.error("Bot → MongoDB connection error:", err));

// ── state ──────────────────────────────────────────────
let state = { status: "disconnected", qr: null, connectedAt: null };
let sse = [];

const store = new MongoStore({ mongoose });

const client = new Client({
  authStrategy: new OptimizedRemoteAuth({
    store: store,
    backupSyncIntervalMs: 60000, // Backup every 2 minutes
  }),
  qrMaxRetries: 5,
  puppeteer: {
    executablePath: process.env.CHROME_PATH
      || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ],
    protocolTimeout: 300000
  },
});

// ── events ─────────────────────────────────────────────
let freshAuth = false;

client.on("qr", (qr) => { freshAuth = false; push({ type: "qr", qr }, { status: "qr", qr }); });
client.on("authenticated", () => { freshAuth = true; push({ type: "authenticated" }, { status: "authenticated" }); });
client.on("auth_failure", (msg) => { freshAuth = false; push({ type: "auth_failure", msg }, { status: "disconnected", qr: null }); });

// client.on("ready", () => {
//   const connectedAt = new Date().toISOString();
//   push({ type: "ready", connectedAt }, { status: "connected", qr: null, connectedAt });
// });

// client.on("ready", () => {
//   const connectedAt = new Date().toISOString();
//   client.authStrategy.storeRemoteSession({ emit: false }); // ← add this
//   push({ type: "ready", connectedAt }, { status: "connected", qr: null, connectedAt });
// });

// client.on("disconnected", () => push({ type: "disconnected" }, { status: "disconnected", qr: null, connectedAt: null }));

client.on("ready", async () => {
  const connectedAt = new Date().toISOString();
  push({ type: "ready", connectedAt }, { status: "connected", qr: null, connectedAt });
  if (freshAuth) {
    freshAuth = false;
    await client.authStrategy.storeRemoteSession({ emit: false })
      .catch((err) => console.error("Bot → Session backup failed:", err.message));
  }
});

client.on("disconnected", () => { freshAuth = false; push({ type: "disconnected" }, { status: "disconnected", qr: null, connectedAt: null }); });

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
  // send current state immediately on connect
  res.write(`data: ${JSON.stringify({ type: "state", ...state })}\n\n`);
  sse.push(res);
  req.on("close", () => { sse = sse.filter((r) => r !== res); });
});

// ── REST ───────────────────────────────────────────────
app.get("/status", (_, res) => res.json(state));

app.post("/connect", (_, res) => {
  if (state.status === "disconnected") client.initialize();
  res.json({ ok: true, status: state.status });
});

app.post("/logout", async (_, res) => {
  await client.logout().catch(() => { });
  await client.destroy().catch(() => { });
  Object.assign(state, { status: "disconnected", qr: null, connectedAt: null });
  push({ type: "disconnected" });
  res.json({ ok: true });
});

// app.post("/send", async (req, res) => {
//   if (state.status !== "connected") return res.status(400).json({ error: "Not connected" });
//   const { phone, message, attachment } = req.body;
//   if (!phone || !message) return res.status(400).json({ error: "phone and message required" });
//   try {
//     const chatId = phone.replace(/\D/g, "") + "@c.us";
//     if (attachment) {
//       const media = new MessageMedia(attachment.mimetype, attachment.data, attachment.filename);
//       await client.sendMessage(chatId, media, { caption: message });
//     } else {
//       await client.sendMessage(chatId, message);
//     }
//     res.json({ ok: true });
//   } catch (e) {
//     res.status(500).json({ error: e.message });
//   }
// });

app.post("/send", async (req, res) => {
  if (state.status !== "connected") return res.status(400).json({ error: "Not connected" });
  const { phone, message, attachment } = req.body;
  if (!phone || !message) return res.status(400).json({ error: "phone and message required" });
  try {
    const numberId = await client.getNumberId(phone.replace(/\D/g, ""));
    if (!numberId) return res.status(404).json({ error: "Number is not registered on WhatsApp" });
    const chatId = numberId._serialized; // correct WID, LID-aware
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

app.listen(3001, () => console.log("Bot → http://localhost:3001"));