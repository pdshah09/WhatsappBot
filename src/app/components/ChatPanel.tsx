// src/app/components/ChatPanel.tsx
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { botGetChats, botGetMessages, type BotChat, type BotMessage } from "@/lib/bot";

function fmt(ts: number) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  return isToday
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function Avatar({ name, isGroup }: { name: string; isGroup: boolean }) {
  const initials = isGroup
    ? "#"
    : name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  return (
    <div className="w-9 h-9 rounded-full bg-[#25d366]/15 border border-[#25d366]/20 flex items-center justify-center flex-shrink-0">
      <span className="text-[#25d366] text-xs font-semibold">{initials}</span>
    </div>
  );
}

function MessageBubble({ msg }: { msg: BotMessage }) {
  const time = new Date(msg.timestamp * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className={`flex ${ msg.fromMe ? "justify-end" : "justify-start" }`}>
      <div
        className={`max-w-[78%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
          msg.fromMe
            ? "bg-[#25d366]/20 text-white rounded-br-sm"
            : "bg-white/8 text-white/80 rounded-bl-sm"
        }`}
      >
        {msg.hasMedia && !msg.body && (
          <span className="text-white/40 italic text-xs">📎 Media</span>
        )}
        {msg.body && <p className="whitespace-pre-wrap break-words">{msg.body}</p>}
        <p className={`text-[10px] mt-1 ${ msg.fromMe ? "text-white/40 text-right" : "text-white/30" }`}>
          {time}
        </p>
      </div>
    </div>
  );
}

export default function ChatPanel() {
  const [chats, setChats]           = useState<BotChat[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [selected, setSelected]     = useState<BotChat | null>(null);
  const [messages, setMessages]     = useState<BotMessage[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [msgsError, setMsgsError]   = useState<string | null>(null);
  const [search, setSearch]         = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadChats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await botGetChats();
      setChats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load chats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadChats(); }, [loadChats]);

  const openChat = useCallback(async (chat: BotChat) => {
    setSelected(chat);
    setMessages([]);
    setMsgsError(null);
    setMsgsLoading(true);
    try {
      const msgs = await botGetMessages(chat.id, 30);
      setMessages(msgs);
    } catch (e) {
      setMsgsError(e instanceof Error ? e.message : "Failed to load messages");
    } finally {
      setMsgsLoading(false);
    }
  }, []);

  // Scroll to bottom when messages load
  useEffect(() => {
    if (!msgsLoading) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, msgsLoading]);

  const filtered = chats.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="bg-[#111] border border-white/10 rounded-2xl flex flex-col overflow-hidden h-full min-h-0">

      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3 border-b border-white/5">
        <h3 className="text-xs font-semibold text-white/50 uppercase tracking-widest">
          {selected ? (
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-1.5 text-white/40 hover:text-white transition"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 5l-7 7 7 7"/>
              </svg>
              Back
            </button>
          ) : "Chats"}
        </h3>
        <div className="flex items-center gap-2">
          {selected && (
            <span className="text-xs text-white/50 font-normal truncate max-w-[140px]">
              {selected.name}
            </span>
          )}
          {!selected && (
            <button
              onClick={loadChats}
              disabled={loading}
              title="Refresh chats"
              className="text-white/30 hover:text-white transition disabled:opacity-30"
            >
              <svg
                width="13" height="13" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={loading ? "animate-spin" : ""}
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Chat list */}
      {!selected && (
        <>
          {/* Search */}
          <div className="px-3 py-2 border-b border-white/5">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats…"
              className="w-full bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#25d366]/40 placeholder:text-white/20"
            />
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {loading && (
              <div className="flex flex-col gap-2 p-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-2">
                    <div className="w-9 h-9 rounded-full bg-white/5 animate-pulse flex-shrink-0" />
                    <div className="flex-1 flex flex-col gap-1.5">
                      <div className="h-3 bg-white/5 rounded animate-pulse w-2/3" />
                      <div className="h-2.5 bg-white/5 rounded animate-pulse w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="p-4 text-center">
                <p className="text-red-400 text-xs mb-3">{error}</p>
                <button
                  onClick={loadChats}
                  className="text-xs text-white/40 hover:text-white border border-white/10 px-3 py-1.5 rounded-lg transition"
                >
                  Retry
                </button>
              </div>
            )}

            {!loading && !error && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-white/20">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span className="text-xs">{search ? "No matches" : "No chats yet"}</span>
              </div>
            )}

            {!loading && !error && filtered.map((chat) => (
              <button
                key={chat.id}
                onClick={() => openChat(chat)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/4 transition text-left group"
              >
                <Avatar name={chat.name} isGroup={chat.isGroup} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm text-white/80 font-medium truncate group-hover:text-white transition">
                      {chat.name}
                    </span>
                    {chat.timestamp && (
                      <span className="text-[10px] text-white/25 flex-shrink-0 tabular-nums">
                        {fmt(chat.timestamp)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <p className="text-xs text-white/30 truncate">
                      {chat.lastMessage
                        ? (chat.lastMessage.fromMe ? "You: " : "") +
                          (chat.lastMessage.hasMedia && !chat.lastMessage.body
                            ? "📎 Media"
                            : chat.lastMessage.body || "—")
                        : "—"}
                    </p>
                    {chat.unreadCount > 0 && (
                      <span className="flex-shrink-0 min-w-[18px] h-[18px] bg-[#25d366] text-black text-[10px] font-bold rounded-full flex items-center justify-center px-1 tabular-nums">
                        {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Message thread */}
      {selected && (
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-2 p-3">
          {msgsLoading && (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className={`flex ${ i % 2 === 0 ? "justify-start" : "justify-end" }`}>
                  <div className="h-8 w-40 bg-white/5 rounded-2xl animate-pulse" />
                </div>
              ))}
            </div>
          )}
          {msgsError && (
            <p className="text-red-400 text-xs text-center mt-4">{msgsError}</p>
          )}
          {!msgsLoading && !msgsError && messages.length === 0 && (
            <p className="text-white/20 text-xs text-center mt-8">No messages</p>
          )}
          {!msgsLoading && messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
