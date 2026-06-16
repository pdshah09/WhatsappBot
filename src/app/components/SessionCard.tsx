// components/SessionCard.tsx

"use client";

interface Props { connectedAt: string | null; onLogout: () => void; }

export default function SessionCard({ connectedAt, onLogout }: Props) {
  return (
    <div className="bg-[#111] border border-[#25d366]/30 rounded-2xl p-4 flex items-center justify-between">
      <div>
        <p className="text-[#25d366] text-sm font-medium">Session Connected</p>
        {connectedAt && (
          <p className="text-white/40 text-xs mt-0.5">
            at {new Date(connectedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
      </div>
      <button
        onClick={onLogout}
        className="text-xs text-white/40 hover:text-red-400 border border-white/10 hover:border-red-500/30 px-3 py-1.5 rounded-lg transition"
      >
        Logout
      </button>
    </div>
  );
}