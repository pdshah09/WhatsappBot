// src/lib/bot.ts
const BASE = "/api/bot";

export const botConnect = () => fetch(`${BASE}/connect`, { method: "POST" });
export const botLogout  = () => fetch(`${BASE}/logout`,  { method: "POST" });

export async function botSend(phone: string, message: string, attachment?: File) {
  const body: Record<string, unknown> = { phone, message };
  if (attachment) {
    const data = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res((r.result as string).split(",")[1]);
      r.readAsDataURL(attachment);
    });
    body.attachment = { data, mimetype: attachment.type, filename: attachment.name };
  }
  return fetch(`${BASE}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}