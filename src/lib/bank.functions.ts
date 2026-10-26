import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LIMITS, RATES, FEE, convert, quote, validIban, maskIban, withdrawFee, WITHDRAW_MIN } from "@/lib/bank";

const ip = () =>
  getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

// If the user enrolled 2FA, sensitive actions require a session verified with the code (aal2).
async function requireAal(ctx: { supabase: any; claims: any }) {
  const { data } = await ctx.supabase.auth.mfa.listFactors();
  const has = (data?.totp ?? []).some((f: any) => f.status === "verified");
  if (has && ctx.claims?.aal !== "aal2") throw new Error("Confirma o código de verificação em dois passos.");
}

const key = (k: unknown) => {
  if (typeof k !== "string" || !/^[\w-]{8,64}$/.test(k)) throw new Error("Pedido inválido.");
  return k;
};

export const setPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { pin: string }) => ({ pin: String(d.pin).slice(0, 6) }))
  .handler(async ({ data, context }) => {
    await requireAal(context);
    const { error } = await (await admin()).rpc("tb_set_pin", { p_user: context.userId, p_pin: data.pin, p_ip: ip() as string });
    if (error) throw new Error(error.message.includes("PIN") ? error.message : "Não foi possível guardar o PIN.");
    return { ok: true };
  });

export const deposit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { amount: number; key: string }) => ({ amount: Number(d.amount), key: key(d.key) }))
  .handler(async ({ data, context }) => {
    await requireAal(context);
    const { error } = await (await admin()).rpc("tb_deposit", { p_user: context.userId, p_amount: data.amount, p_key: data.key, p_ip: ip() as string });
    if (error) throw new Error("Valor entre 0,01 € e 5 000 €.");
    return { ok: true };
  });

export const exchange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { from: string; to: string; amount: number; key: string }) => {
    if (!(d.from in RATES) || !(d.to in RATES)) throw new Error("Moeda inválida.");
    return { from: d.from, to: d.to, amount: Math.round(Number(d.amount) * 100) / 100, key: key(d.key) };
  })
  .handler(async ({ data, context }) => {
    await requireAal(context);
    const q = quote(data.amount, data.from, data.to);
    const out = q.out;
    const eurValue = convert(data.amount, data.from, "EUR", false);
    const { error } = await (await admin()).rpc("tb_fx", {
      p_user: context.userId, p_from: data.from, p_to: data.to, p_amount: data.amount, p_out: out, p_rate: q.rate, p_fee: q.fee, p_eur: eurValue, p_key: data.key, p_ip: ip() as string,
    });
    if (error) throw new Error(error.message.includes("Saldo") ? error.message : "Operação inválida.");
    return { out };
  });

const MSG: Record<string, string> = {
  no_pin: "Define primeiro o teu PIN.",
  pin_locked: "PIN bloqueado por 15 minutos após 3 tentativas erradas.",
  bad_pin: "PIN incorreto.",
  invalid: "Valor inválido.",
  limit_tx: "Excede o limite por transferência.",
  limit_day: "Excede o limite diário.",
  funds: "Saldo insuficiente.",
};

export const transfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { to: string; country: string; currency: string; amount: number; pin: string; key: string }) => {
    if (!(d.currency in RATES)) throw new Error("Moeda inválida.");
    const to = String(d.to).trim().slice(0, 60);
    if (to.length < 2) throw new Error("Indica o destinatário.");
    return { to, country: String(d.country).slice(0, 40), currency: d.currency, amount: Math.round(Number(d.amount) * 100) / 100, pin: String(d.pin).slice(0, 6), key: key(d.key) };
  })
  .handler(async ({ data, context }) => {
    await requireAal(context);
    const eurAmt = Math.round(data.amount * (RATES[data.currency] ?? 1) * (data.currency === "EUR" ? 1 : 1 + FEE) * 100) / 100;
    const label = `Para ${data.to} (${data.country}) · ${data.amount} ${data.currency}`;
    const { data: r, error } = await (await admin()).rpc("tb_transfer", {
      p_user: context.userId, p_pin: data.pin, p_eur: eurAmt, p_label: label, p_key: data.key, p_ip: ip() as string,
      p_per_tx: LIMITS.perTransfer, p_per_day: LIMITS.perDay, p_unusual: LIMITS.unusual,
    });
    if (error) throw new Error("Não foi possível concluir a transferência.");
    if (r === "ok" || r === "duplicate") return { ok: true, eur: eurAmt, alert: eurAmt >= LIMITS.unusual };
    return { ok: false, error: MSG[r as string] ?? "Erro." };
  });

export const logEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { action: "login" | "logout" | "idle" | "mfa_on" | "mfa_off" | "pw_change" | "sessions_out" | "prefs" }) => d)
  .handler(async ({ data, context }) => {
    const labels = { login: "Início de sessão", logout: "Fim de sessão", idle: "Sessão expirada", mfa_on: "2FA ativada", mfa_off: "2FA desativada", pw_change: "Palavra-passe alterada", sessions_out: "Outras sessões terminadas", prefs: "Notificações de segurança alteradas" } as Record<string, string>;
    const action = labels[data.action];
    if (!action) return { ok: false };
    await (await admin()).rpc("tb_log", { p_user: context.userId, p_action: action, p_detail: "", p_ip: ip() as string });
    return { ok: true };
  });

export const withdraw = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { currency: string; amount: number; holder: string; iban: string; pin: string; key: string }) => {
    if (!(d.currency in RATES)) throw new Error("Moeda inválida.");
    const amount = Math.round(Number(d.amount) * 100) / 100;
    if (!(amount >= WITHDRAW_MIN)) throw new Error(`Montante mínimo: ${WITHDRAW_MIN}.`);
    const holder = String(d.holder).trim().slice(0, 80);
    if (holder.length < 3) throw new Error("Indica o titular da conta.");
    if (!validIban(String(d.iban))) throw new Error("IBAN inválido.");
    return { currency: d.currency, amount, holder, iban: String(d.iban), pin: String(d.pin).slice(0, 6), key: key(d.key) };
  })
  .handler(async ({ data, context }) => {
    await requireAal(context);
    const fee = withdrawFee(data.amount, data.currency);
    const eurAmt = convert(data.amount, data.currency, "EUR", false);
    const { data: r, error } = await (await admin()).rpc("tb_withdraw", {
      p_user: context.userId, p_pin: data.pin, p_cur: data.currency, p_amount: data.amount, p_fee: fee, p_eur: eurAmt,
      p_method: "Transferência bancária (IBAN)", p_holder: data.holder, p_iban_masked: maskIban(data.iban), p_key: data.key, p_ip: ip() as string,
    });
    if (error) throw new Error("Não foi possível registar o pedido.");
    if (r === "ok" || r === "duplicate") return { ok: true };
    return { ok: false, error: MSG[r as string] ?? "Erro." };
  });

export const listSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (await admin()).rpc("tb_sessions", { p_user: context.userId });
    if (error) return { sessions: [], current: null, error: "Sessões indisponíveis." };
    const current = (context.claims as any)?.session_id ?? null;
    return {
      current,
      sessions: (data ?? []).map((s: any) => ({ id: s.id as string, createdAt: s.created_at as string, lastAt: (s.updated_at ?? null) as string | null, userAgent: (s.user_agent ?? "") as string, ip: (s.ip ?? null) as string | null })),
      error: null as string | null,
    };
  });
