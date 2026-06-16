// src/app/components/SendForm.tsx
"use client";
import { useRef, useState } from "react";
import { botSend } from "@/lib/bot";

type ToastState = { msg: string; ok: boolean } | null;

interface HistoryEntry {
  phone: string;
  preview: string;
  ok: boolean;
  at: Date;
}

export default function SendForm() {
  const [phone, setPhone]           = useState("");
  const [message, setMessage]       = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending]       = useState(false);
  const [toast, setToast]           = useState<ToastState>(null);
  const [history, setHistory]       = useState<HistoryEntry[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const notify = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const send = async () => {
    const trimPhone = phone.replace(/\D/g, "");
    if (!trimPhone || !message.trim()) return;
    setSending(true);
    try {
      const res  = await botSend(trimPhone, message.trim(), attachment ?? undefined);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        notify("Message sent!", true);
        setHistory(h => [
          { phone: trimPhone, preview: message.trim().slice(0, 40), ok: true, at: new Date() },
          ...h.slice(0, 4),
        ]);
        setMessage("");
        setAttachment(null);
      } else {
        notify(data.error ?? "Send failed", false);
        setHistory(h => [
          { phone: trimPhone, preview: message.trim().slice(0, 40), ok: false, at: new Date() },
          ...h.slice(0, 4),
        ]);
      }
    } catch {
      notify("Bot server unreachable", false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-[#111] border border-white/10 rounded-2xl p-5 flex flex-col gap-4">

      {/* Toast */}
      {toast && (
        <div className={`text-sm font-medium px-4 py-2 rounded-lg text-center transition-all ${
          toast.ok
            ? "bg-[#25d366]/15 text-[#25d366] border border-[#25d366]/20"
            : "bg-red-500/10 text-red-400 border border-red-500/20"
        }`}>
          {toast.msg}
        </div>
      )}

      <h3 className="font-semibold text-xs text-white/50 uppercase tracking-widest">Send Message</h3>

      {/* Phone */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-white/40">
          Phone Number <span className="text-white/20">(with country code)</span>
        </label>
        <input
          type="tel"
          maxLength={10}
          onInput={
              (e) => {
                  e.currentTarget.value = e.currentTarget.value
                      .replace(/\D/g, '')
                      .slice(0, 10);
              }
          }
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/[^\d+\-\s()]/g, ""))}
          placeholder="919876543210"
          className="bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#25d366]/50 placeholder:text-white/20"
          required
        />
      </div>

      {/* Message */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-white/40">Message</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="Type your message…"
          className="bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-[#25d366]/50 placeholder:text-white/20"
        />
        <p className="text-xs text-white/20 text-right">{message.length} chars</p>
      </div>

      {/* Attachment */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 text-xs text-white/50 hover:text-white border border-white/10 hover:border-white/30 px-3 py-2 rounded-xl transition"
        >
          ＋ Attachment
        </button>
        {attachment && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-white/40 truncate max-w-[120px]">{attachment.name}</span>
            <button
              onClick={() => setAttachment(null)}
              className="text-white/20 hover:text-red-400 text-xs transition"
            >✕</button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
        />
      </div>

      {/* Send */}
      <button
        onClick={send}
        disabled={sending || !phone.replace(/\D/g, "") || !message.trim()}
        className="w-full bg-[#25d366] hover:bg-[#1ebe5d] disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold py-2.5 rounded-xl transition text-sm"
      >
        {sending ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            Sending…
          </span>
        ) : "Send"}
      </button>

      {/* History */}
      {history.length > 0 && (
        <div className="border-t border-white/5 pt-3 flex flex-col gap-2">
          <p className="text-xs text-white/30 uppercase tracking-widest">Recent</p>
          {history.map((h, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                h.ok ? "bg-[#25d366]" : "bg-red-400"
              }`} />
              <span className="text-white/50 font-mono flex-shrink-0">+{h.phone}</span>
              <span className="text-white/30 truncate">{h.preview}</span>
              <span className="text-white/20 flex-shrink-0 ml-auto tabular-nums">
                {h.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
