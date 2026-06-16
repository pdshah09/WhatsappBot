// components/SendForm.tsx

"use client";
import { useRef, useState } from "react";
import { botSend } from "@/lib/bot";

export default function SendForm() {
  const [phone, setPhone]           = useState("");
  const [message, setMessage]       = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending]       = useState(false);
  const [toast, setToast]           = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const notify = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const send = async () => {
    if (!phone || !message) return;
    setSending(true);
    try {
      const res = await botSend(phone, message, attachment ?? undefined);
      if (res.ok) { notify("Message Sent !"); setMessage(""); setAttachment(null); }
      else { const e = await res.json(); notify(`Error: ${e.error}`); }
    } catch {
      notify("Error: Bot server unreachable. Is it running on port 3001?");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-[#111] border border-white/10 rounded-2xl p-5 flex flex-col gap-4">
      {toast && (
        <div className="bg-[#25d366] text-black text-sm font-medium px-4 py-2 rounded-lg text-center">
          {toast}
        </div>
      )}
      <h3 className="font-semibold text-xs text-white/50 uppercase tracking-widest">Send Message</h3>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-white/40">Phone Number</label>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 9876543210" maxLength={10}
          inputMode="numeric" onInput={
            (e) => {
                  e.currentTarget.value = e.currentTarget.value
                      .replace(/\D/g, '')
                      .slice(0, 10);
                }
            }
          className="bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#25d366]/50 placeholder:text-white/20" />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-white/40">Message</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="Type your message…"
          className="bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-[#25d366]/50 placeholder:text-white/20" />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 text-xs text-white/50 hover:text-white border border-white/10 hover:border-white/30 px-3 py-2 rounded-xl transition">
          ＋ Attachment
        </button>
        {attachment && <span className="text-xs text-white/40 truncate max-w-[140px]">{attachment.name}</span>}
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => setAttachment(e.target.files?.[0] ?? null)} />
      </div>

      <button onClick={send} disabled={sending || !phone || !message}
        className="w-full bg-[#25d366] hover:bg-[#1ebe5d] disabled:opacity-40 text-black font-semibold py-2.5 rounded-xl transition text-sm">
        {sending ? "Sending…" : "Send"}
      </button>
    </div>
  );
}