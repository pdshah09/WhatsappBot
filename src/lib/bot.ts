// lib/bot.ts

export const BOT = process.env.NEXT_PUBLIC_BOT_URL ?? "http://localhost:3001";

export const botConnect = (): Promise<Response> => fetch(`${BOT}/connect`, { method: "POST" });
export const botLogout  = (): Promise<Response> => fetch(`${BOT}/logout`,  { method: "POST" });

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
  return fetch(`${BOT}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}