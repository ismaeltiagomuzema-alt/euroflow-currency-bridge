// Demo-only banking logic. Everything is stored in this browser (localStorage).
export const LIMITS = { perTransfer: 1000, perDay: 3000, unusual: 500 };
export const LOGIN = { maxAttempts: 5, lockMs: 5 * 60 * 1000 };
export const IDLE_MS = 5 * 60 * 1000;
export const MIN_PASSWORD = 10;

const COMMON = new Set([
  "123456", "1234567890", "password", "password123", "qwerty", "qwerty123",
  "abc123", "111111", "123123", "iloveyou", "admin123", "palavrapasse", "benfica123",
  "1234567891", "0123456789", "triplebank", "senha12345",
]);

export function checkPassword(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Mínimo de ${MIN_PASSWORD} caracteres.`;
  if (COMMON.has(pw.toLowerCase())) return "Palavra-passe demasiado comum.";
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return "Use letras e números.";
  return null;
}

export async function hash(text: string, salt: string) {
  const data = new TextEncoder().encode(salt + ":" + text);
  let buf = await crypto.subtle.digest("SHA-256", data);
  for (let i = 0; i < 999; i++) buf = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type Tx = { id: string; type: "in" | "out"; amount: number; label: string; at: number };
export type Log = { at: number; action: string; detail: string };
export type User = {
  name: string; email: string; salt: string; pwHash: string; pinHash?: string;
  balance: number; wallets?: Record<string, number>; txs: Tx[]; logs: Log[]; attempts: number; lockedUntil: number;
};

const KEY = "tb_users_v2";
export const load = (): Record<string, User> => {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
};
export const save = (u: Record<string, User>) => localStorage.setItem(KEY, JSON.stringify(u));

export function sentToday(u: User, now = Date.now()) {
  const d = new Date(now).toDateString();
  return u.txs.filter((t) => t.type === "out" && new Date(t.at).toDateString() === d)
    .reduce((s, t) => s + t.amount, 0);
}

export function checkTransfer(u: User, amount: number): string | null {
  if (!(amount > 0)) return "Valor inválido.";
  if (amount > LIMITS.perTransfer) return `Limite por transferência: ${eur(LIMITS.perTransfer)}.`;
  if (sentToday(u) + amount > LIMITS.perDay) return `Limite diário de ${eur(LIMITS.perDay)} excedido.`;
  if (amount > u.balance) return "Saldo insuficiente.";
  return null;
}

export const eur = (n: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);

// Demo exchange rates: value of 1 unit in EUR.
export const RATES: Record<string, number> = { EUR: 1, USD: 0.92, GBP: 1.17, CHF: 1.05, PLN: 0.23, SEK: 0.088, NOK: 0.086, DKK: 0.134 };
export const CURRENCIES = Object.keys(RATES);
export const FEE = 0.005; // 0.5% exchange fee
export const COUNTRIES: Record<string, string> = {
  "Portugal": "EUR", "Espanha": "EUR", "França": "EUR", "Alemanha": "EUR", "Itália": "EUR",
  "Países Baixos": "EUR", "Bélgica": "EUR", "Irlanda": "EUR", "Reino Unido": "GBP",
  "Suíça": "CHF", "Polónia": "PLN", "Suécia": "SEK", "Noruega": "NOK", "Dinamarca": "DKK",
};
export function convert(amount: number, from: string, to: string, withFee = true) {
  const v = (amount * (RATES[from] ?? 1)) / (RATES[to] ?? 1);
  return Math.round(v * (withFee && from !== to ? 1 - FEE : 1) * 100) / 100;
}
export const money = (n: number, cur: string) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: cur }).format(n);
