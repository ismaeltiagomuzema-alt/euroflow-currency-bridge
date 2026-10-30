// Banking rules shared by the app UI and the server functions.
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

export type Tx = { id: string; type: "in" | "out" | "fx"; amount: number; label: string; at: number };
export type Log = { at: number; action: string; detail: string; ip?: string | null };
// Account view built from server data (Lovable Cloud).
export type User = {
  id: string; name: string; email: string; balance: number; wallets?: Record<string, number>;
  txs: Tx[]; logs: Log[]; hasPin: boolean; mfa: boolean;
};

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

// Demo exchange quote: rate without fee, fee charged in the source currency, final amount received.
export function quote(amount: number, from: string, to: string) {
  const rate = Math.round(((RATES[from] ?? 1) / (RATES[to] ?? 1)) * 1e6) / 1e6;
  const fee = from === to ? 0 : Math.round(amount * FEE * 100) / 100;
  return { rate, fee, out: convert(amount, from, to) };
}

// IBAN check (ISO 13616 mod-97).
export function validIban(raw: string) {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0;
  for (const d of r) m = (m * 10 + Number(d)) % 97;
  return m === 1;
}
export const maskIban = (raw: string) => {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  return `${s.slice(0, 4)} •••• ${s.slice(-4)}`;
};

// Withdrawals: SEPA in EUR has no fee; other currencies pay the exchange fee.
export const WITHDRAW_MIN = 10;
export const withdrawFee = (amount: number, cur: string) => (cur === "EUR" ? 0 : Math.round(amount * FEE * 100) / 100);

export type TransferFeeBand = { min: number; max: number | null; fee: number; label: string };
export const TRANSFER_FEE_BANDS: TransferFeeBand[] = [
  { min: 1, max: 100, fee: 2, label: "1 a 100 EUR" },
  { min: 100.01, max: 500, fee: 3, label: "100,01 a 500 EUR" },
  { min: 500.01, max: 1000, fee: 5, label: "500,01 a 1.000 EUR" },
  { min: 1000.01, max: null, fee: 5, label: "Acima de 1.000 EUR" },
];

export function getConfiguredExchangeFee(rate = FEE) {
  if (typeof window === "undefined") return rate;
  const raw = Number(window.localStorage.getItem("triplebank.exchange-fee") ?? "");
  if (!Number.isFinite(raw) || raw < 0 || raw > 0.2) return rate;
  return raw;
}

export function setConfiguredExchangeFee(value: number) {
  const safe = Number(value);
  const final = Number.isFinite(safe) ? Math.min(Math.max(safe, 0), 0.2) : FEE;
  if (typeof window !== "undefined") localStorage.setItem("triplebank.exchange-fee", String(final));
  return final;
}

export function calculateTransferFee(amount: number) {
  const safeAmount = Number(amount) || 0;
  const match = TRANSFER_FEE_BANDS.find((band) => {
    if (safeAmount >= band.min && (band.max === null || safeAmount <= band.max)) return true;
    return false;
  });
  return {
    fee: match?.fee ?? TRANSFER_FEE_BANDS[TRANSFER_FEE_BANDS.length - 1].fee,
    band: match ?? TRANSFER_FEE_BANDS[TRANSFER_FEE_BANDS.length - 1],
  };
}

export function calculateExchangeQuote(amount: number, from: string, to: string) {
  const safeAmount = Number(amount) || 0;
  const effectiveFee = getConfiguredExchangeFee(FEE);
  const rate = (RATES[from] ?? 1) / (RATES[to] ?? 1);
  const fee = from === to ? 0 : safeAmount * effectiveFee;
  const net = Math.max(safeAmount - fee, 0);
  const out = net * rate;
  return {
    rate,
    fee,
    net,
    out,
    commissionRate: effectiveFee,
    commissionPercent: effectiveFee * 100,
  };
}

export async function fetchLiveFxRates() {
  const currencyCodes = ["EUR", "USD", "GBP", "CHF", "PLN", "SEK", "NOK", "DKK"];

  try {
    const response = await fetch("https://api.frankfurter.app/latest?from=EUR");
    if (!response.ok) throw new Error("Rate source unavailable");
    const json = (await response.json()) as { rates?: Record<string, number> };
    const liveRates = Object.fromEntries(
      currencyCodes.map((code) => {
        const value = code === "EUR" ? 1 : Number(json.rates?.[code] ?? RATES[code] ?? 1);
        return [code, value];
      }),
    );
    return { rates: liveRates, source: "Frankfurter API", isLive: true };
  } catch {
    return { rates: { ...RATES }, source: "Demo fallback", isLive: false };
  }
}

export function getTransferTableSnapshot() {
  return TRANSFER_FEE_BANDS.map((band) => ({ ...band }));
}

export function setTransferFeeBands(bands: TransferFeeBand[]) {
  const safeBands = (bands ?? []).filter((band) => Number.isFinite(band.min) && band.fee >= 0).slice(0, 4);
  if (typeof window === "undefined") return safeBands;
  localStorage.setItem("triplebank.transfer-bands", JSON.stringify(safeBands));
  return safeBands;
}

export function getTransferFeeBands() {
  if (typeof window === "undefined") return TRANSFER_FEE_BANDS;
  try {
    const raw = localStorage.getItem("triplebank.transfer-bands");
    if (!raw) return TRANSFER_FEE_BANDS;
    const payload = JSON.parse(raw) as TransferFeeBand[];
    if (!Array.isArray(payload) || payload.length === 0) return TRANSFER_FEE_BANDS;
    return payload;
  } catch {
    return TRANSFER_FEE_BANDS;
  }
}

export function getTransferQuote(amount: number, currency = "EUR") {
  const safeAmount = Number(amount) || 0;
  const feeBandConfig = getTransferFeeBands();
  const match = feeBandConfig.find((band) => safeAmount >= band.min && (band.max === null || safeAmount <= band.max));
  const transferFee = match?.fee ?? feeBandConfig[feeBandConfig.length - 1]?.fee ?? 0;
  const exchangeFee = currency === "EUR" ? 0 : safeAmount * getConfiguredExchangeFee(FEE);
  const totalDebited = safeAmount + transferFee + exchangeFee;
  const rate = currency === "EUR" ? 1 : (RATES[currency] ?? 1);
  const finalReceived = totalDebited - transferFee - exchangeFee;
  return { transferFee, exchangeFee, totalDebited, finalReceived, rate, label: match?.label ?? "Regra administrativa" };
}

export function formatMoney(n: number, cur: string) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n);
}
