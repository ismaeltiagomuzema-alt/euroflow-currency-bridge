import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LIMITS, RATES, FEE, convert } from "@/lib/bank";

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
    const out = convert(data.amount, data.from, data.to);
    const eurValue = convert(data.amount, data.from, "EUR", false);
    const { error } = await (await admin()).rpc("tb_exchange", {
      p_user: context.userId, p_from: data.from, p_to: data.to, p_amount: data.amount, p_out: out, p_eur: eurValue, p_key: data.key, p_ip: ip() as string,
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
  .inputValidator((d: { action: "login" | "logout" | "idle" | "mfa_on" | "mfa_off" }) => d)
  .handler(async ({ data, context }) => {
    const labels = { login: "Início de sessão", logout: "Fim de sessão", idle: "Sessão expirada", mfa_on: "2FA ativada", mfa_off: "2FA desativada" };
    const action = labels[data.action];
    if (!action) return { ok: false };
    await (await admin()).rpc("tb_log", { p_user: context.userId, p_action: action, p_detail: "", p_ip: ip() as string });
    return { ok: true };
  });
