import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownLeft, ArrowUpRight, CreditCard, Eye, EyeOff, History, Home, Lock, LogOut, KeyRound,
  Plus, Send, ArrowLeftRight, Shield, ShieldCheck, User as UserIcon, ChevronLeft, Smartphone, Mail,
} from "lucide-react";
import {
  IDLE_MS, LIMITS, RATES, CURRENCIES, COUNTRIES, FEE, convert, money, checkPassword, checkTransfer, eur, sentToday,
  type User, type Tx,
} from "@/lib/bank";
import { supabase } from "@/integrations/supabase/client";
import { deposit, exchange, logEvent, setPin, transfer } from "@/lib/bank.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Triple Bank — Câmbio e envios na Europa" },
      { name: "description", content: "Troca moedas e envia dinheiro para toda a Europa com 2FA, PIN em cada envio e registo de atividade." },
      { property: "og:title", content: "Triple Bank — Câmbio e envios na Europa" },
      { property: "og:description", content: "Câmbio em 8 moedas e transferências protegidas por 2FA e PIN." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: App,
});

type Screen = "landing" | "login" | "signup" | "forgot" | "mfa" | "home" | "send" | "add" | "card" | "moves" | "profile" | "security" | "pin" | "fx";

const uid = () => crypto.randomUUID();
const fmtDate = (t: number) =>
  new Date(t).toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Ocorreu um erro.");

async function fetchUser(): Promise<User | null> {
  const { data: { user: au } } = await supabase.auth.getUser();
  if (!au) return null;
  const [p, w, t, l, f] = await Promise.all([
    supabase.from("profiles").select("name, pin_hash").eq("id", au.id).maybeSingle(),
    supabase.from("wallets").select("currency, balance"),
    supabase.from("transactions").select("id, type, amount_eur, label, created_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("audit_logs").select("action, detail, ip, created_at").order("created_at", { ascending: false }).limit(100),
    supabase.auth.mfa.listFactors(),
  ]);
  const wallets: Record<string, number> = {};
  for (const r of w.data ?? []) wallets[r.currency] = Number(r.balance);
  const balance = wallets["EUR"] ?? 0; delete wallets["EUR"];
  return {
    id: au.id, email: au.email ?? "", name: p.data?.name || (au.email ?? "").split("@")[0] || "Cliente",
    hasPin: !!p.data?.pin_hash, balance, wallets,
    mfa: (f.data?.totp ?? []).some((x) => x.status === "verified"),
    txs: (t.data ?? []).map((r) => ({ id: r.id, type: r.type as Tx["type"], amount: Number(r.amount_eur), label: r.label, at: Date.parse(r.created_at) })),
    logs: (l.data ?? []).map((r) => ({ action: r.action, detail: r.detail, ip: r.ip, at: Date.parse(r.created_at) })),
  };
}

function App() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [user, setUser] = useState<User | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const log = useServerFn(logEvent);

  const refresh = useCallback(async () => setUser(await fetchUser()), []);

  // Decide where a session goes: 2FA challenge if needed, then PIN setup or home.
  const route = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setUser(null); setReady(true); return; }
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") { setScreen("mfa"); setReady(true); return; }
    const u = await fetchUser(); setUser(u); setReady(true);
    if (u) setScreen((s) => (["landing", "login", "signup", "forgot", "mfa"].includes(s) ? (u.hasPin ? "home" : "pin") : s));
  }, []);

  useEffect(() => {
    route();
    const { data: sub } = supabase.auth.onAuthStateChange((ev) => {
      if (ev === "SIGNED_IN" || ev === "MFA_CHALLENGE_VERIFIED") setTimeout(route, 0);
      if (ev === "SIGNED_OUT") { setUser(null); setScreen((s) => (s === "login" ? s : "landing")); }
    });
    return () => sub.subscription.unsubscribe();
  }, [route]);

  const go = (s: Screen) => { setNotice(null); setScreen(s); };
  const logout = async (reason?: "idle") => {
    try { await log({ data: { action: reason ?? "logout" } }); } catch { /* ignore */ }
    await supabase.auth.signOut();
    setUser(null);
    if (reason) { setScreen("login"); setNotice("Sessão terminada por inatividade."); } else go("landing");
  };

  // Inactivity timeout
  useEffect(() => {
    if (!user) return;
    let t: ReturnType<typeof setTimeout>;
    const reset = () => { clearTimeout(t); t = setTimeout(() => logout("idle"), IDLE_MS); };
    const evs = ["click", "keydown", "touchstart"];
    evs.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, reset)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!ready) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">A carregar…</div>;
  if (screen === "mfa") return <MfaChallenge onCancel={() => logout()} />;
  if (!user || ["landing", "login", "signup", "forgot"].includes(screen)) {
    if (screen === "login") return <LoginScreen notice={notice} go={go} onOk={() => log({ data: { action: "login" } }).catch(() => {})} />;
    if (screen === "signup") return <SignupScreen go={go} />;
    if (screen === "forgot") return <ForgotScreen go={go} />;
    return <Landing go={go} />;
  }

  const body: Record<string, ReactNode> = {
    home: <HomeScreen user={user} go={go} />,
    send: <SendScreen user={user} go={go} refresh={refresh} />,
    add: <AddScreen go={go} refresh={refresh} />,
    card: <CardScreen user={user} />,
    fx: <FxScreen user={user} go={go} refresh={refresh} />,
    moves: <MovesScreen user={user} />,
    profile: <ProfileScreen user={user} go={go} logout={() => logout()} />,
    security: <SecurityScreen user={user} go={go} refresh={refresh} />,
    pin: <PinSetup go={go} refresh={refresh} />,
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-background">
      <main className="flex-1 px-5 pb-28 pt-6">{body[screen]}</main>
      {screen !== "pin" && <TabBar screen={screen} go={go} />}
    </div>
  );
}

/* ---------- auth ---------- */
function LoginScreen({ notice, go, onOk }: { notice: string | null; go: Go; onOk: () => void }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(null); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pw });
    setBusy(false);
    if (error) {
      if (/confirm/i.test(error.message)) return setErr("Confirma primeiro o teu email — enviámos-te um link.");
      if (error.status === 429) return setErr("Demasiadas tentativas. Aguarda alguns minutos e tenta de novo.");
      return setErr("Email ou palavra-passe incorretos.");
    }
    onOk();
  };
  return (
    <div className="mx-auto min-h-screen max-w-md px-6 py-8">
      <Back onClick={() => go("landing")} />
      <Title sub="Acede à tua conta Triple Bank.">Entrar</Title>
      <form onSubmit={submit} className="space-y-4">
        {notice && <Msg kind="info">{notice}</Msg>}
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Palavra-passe" type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <Msg>{err}</Msg>}
        <Btn disabled={busy}>{busy ? "A verificar…" : "Entrar"}</Btn>
        <button type="button" onClick={() => go("forgot")} className="w-full text-center text-sm font-medium text-muted-foreground">Esqueci-me da palavra-passe</button>
        <button type="button" onClick={() => go("signup")} className="w-full text-center text-sm font-medium text-primary">Ainda não tenho conta</button>
      </form>
    </div>
  );
}

function SignupScreen({ go }: { go: Go }) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  const strength = checkPassword(pw);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(null);
    if (name.trim().length < 2 || name.length > 60) return setErr("Indica o teu nome.");
    if (strength) return setErr(strength);
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(), password: pw,
      options: { emailRedirectTo: window.location.origin, data: { name: name.trim() } },
    });
    setBusy(false);
    if (error) return setErr(/pwned|leaked|weak/i.test(error.message) ? "Esta palavra-passe apareceu em fugas de dados. Escolhe outra." : "Não foi possível criar a conta.");
    setSent(true);
  };
  if (sent) return (
    <div className="mx-auto min-h-screen max-w-md space-y-6 px-6 py-16 text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-secondary text-primary"><Mail className="h-8 w-8" /></span>
      <Title sub={`Enviámos um link de confirmação para ${email}. Abre-o para ativar a conta.`}>Verifica o teu email</Title>
      <Btn variant="ghost" onClick={() => go("login")}>Ir para entrar</Btn>
    </div>
  );
  return (
    <div className="mx-auto min-h-screen max-w-md px-6 py-8">
      <Back onClick={() => go("landing")} />
      <Title sub="Cria a tua conta no Triple Bank.">Criar conta</Title>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Email" type="email" required maxLength={120} value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Palavra-passe" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
        {pw && <p className={`text-xs ${strength ? "text-destructive" : "text-success"}`}>{strength ?? "Palavra-passe forte ✓"}</p>}
        {err && <Msg>{err}</Msg>}
        <Btn disabled={busy}>{busy ? "A criar…" : "Criar conta"}</Btn>
        <button type="button" onClick={() => go("login")} className="w-full text-center text-sm font-medium text-primary">Já tenho conta</button>
      </form>
    </div>
  );
}

function ForgotScreen({ go }: { go: Go }) {
  const [email, setEmail] = useState(""); const [sent, setSent] = useState(false);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${window.location.origin}/reset-password` });
    setSent(true); // same answer whether the account exists or not
  };
  return (
    <div className="mx-auto min-h-screen max-w-md px-6 py-8">
      <Back onClick={() => go("login")} />
      <Title sub="Enviamos um link de uso único, válido por pouco tempo.">Recuperar palavra-passe</Title>
      {sent ? <Msg kind="ok">Se existir uma conta com este email, vais receber um link em breve.</Msg> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Btn>Enviar link</Btn>
        </form>)}
    </div>
  );
}

function MfaChallenge({ onCancel }: { onCancel: () => void }) {
  const [code, setCode] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(null); setBusy(true);
    const { data } = await supabase.auth.mfa.listFactors();
    const f = data?.totp.find((x) => x.status === "verified");
    if (!f) { setBusy(false); return setErr("Nenhuma app autenticadora encontrada."); }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code });
    setBusy(false);
    if (error) { setCode(""); return setErr("Código inválido ou expirado."); }
  };
  return (
    <div className="mx-auto min-h-screen max-w-md space-y-5 px-6 py-12">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-primary"><Smartphone className="h-7 w-7" /></span>
      <Title sub="Abre a tua app autenticadora e escreve o código de 6 dígitos.">Verificação em dois passos</Title>
      <form onSubmit={submit} className="space-y-4">
        <PinInput value={code} onChange={setCode} />
        {err && <Msg>{err}</Msg>}
        <Btn disabled={code.length !== 6 || busy}>{busy ? "A verificar…" : "Confirmar"}</Btn>
        <Btn type="button" variant="ghost" onClick={onCancel}>Cancelar</Btn>
      </form>
    </div>
  );
}

/* ---------- app ---------- */
type Refresh = () => Promise<void>;

function PinSetup({ go, refresh }: { go: Go; refresh: Refresh }) {
  const [pin, setPinV] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const save = useServerFn(setPin);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(null);
    if (!/^\d{4,6}$/.test(pin) || /^(\d)\1+$/.test(pin) || "0123456789".includes(pin)) return setErr("Escolhe 4 a 6 dígitos, não sequenciais nem repetidos.");
    setBusy(true);
    try { await save({ data: { pin } }); await refresh(); go("home"); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-5">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-primary"><Lock className="h-7 w-7" /></span>
      <Title sub="Será pedido sempre que enviares dinheiro.">Define o teu PIN</Title>
      <PinInput value={pin} onChange={setPinV} />
      {err && <Msg>{err}</Msg>}
      <Btn disabled={busy}>Guardar PIN</Btn>
    </form>
  );
}

function SendScreen({ user, go, refresh }: { user: User; go: Go; refresh: Refresh }) {
  const [to, setTo] = useState(""); const [amount, setAmount] = useState("");
  const [country, setCountry] = useState("Portugal"); const cur = COUNTRIES[country] ?? "EUR";
  const [step, setStep] = useState<"form" | "pin" | "done">("form");
  const [pin, setPinV] = useState(""); const [err, setErr] = useState<string | null>(null);
  const [alert, setAlert] = useState(false); const [busy, setBusy] = useState(false);
  const opKey = useRef<string | null>(null); // idempotency key per operation
  const send = useServerFn(transfer);
  const amt = parseFloat(amount.replace(",", "."));
  const n = amt > 0 ? Math.round(amt * (RATES[cur] ?? 1) * (cur === "EUR" ? 1 : 1 + FEE) * 100) / 100 : NaN;
  const dest = `${to.trim()} (${country})`;

  const next = (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(null);
    if (to.trim().length < 2) return setErr("Indica o destinatário.");
    const e = checkTransfer(user, n); if (e) return setErr(e);
    opKey.current = uid(); setStep("pin");
  };
  const confirm = async (ev: React.FormEvent) => {
    ev.preventDefault(); if (busy || !opKey.current) return;
    setErr(null); setBusy(true);
    try {
      const r = await send({ data: { to: to.trim(), country, currency: cur, amount: amt, pin, key: opKey.current } });
      if (!r.ok) { setPinV(""); setErr(r.error ?? "Erro."); if (/bloqueado|limite|Saldo/i.test(r.error ?? "")) { opKey.current = uid(); } return; }
      setAlert(!!r.alert); await refresh(); setStep("done");
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  if (step === "done") return (
    <div className="space-y-6 pt-10 text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success/10 text-success"><ShieldCheck className="h-8 w-8" /></span>
      <Title sub={`Para ${dest} · debitado ${eur(n)}`}>{money(amt, cur)} enviados</Title>
      {alert && <Msg kind="info">Registámos um alerta de segurança por se tratar de um valor elevado.</Msg>}
      <Btn onClick={() => go("home")}>Voltar ao início</Btn>
    </div>
  );
  if (step === "pin") return (
    <form onSubmit={confirm} className="space-y-5">
      <Back onClick={() => { setStep("form"); setPinV(""); }} />
      <Title sub={`Enviar ${money(amt, cur)} para ${dest} · debitado ${eur(n)}`}>Confirma com o PIN</Title>
      <PinInput value={pin} onChange={setPinV} />
      {err && <Msg>{err}</Msg>}
      <Btn disabled={pin.length < 4 || busy}>{busy ? "A enviar…" : "Confirmar envio"}</Btn>
    </form>
  );
  return (
    <form onSubmit={next} className="space-y-4">
      <Back onClick={() => go("home")} />
      <Title sub={`Disponível: ${eur(user.balance)}`}>Enviar dinheiro</Title>
      <Field label="Destinatário (nome e IBAN)" maxLength={60} value={to} onChange={(e) => setTo(e.target.value)} />
      <label className="block space-y-1.5"><span className="text-sm font-medium text-muted-foreground">País de destino</span>
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="h-12 w-full rounded-xl border border-input bg-card px-4">
          {Object.keys(COUNTRIES).map((c) => <option key={c} value={c}>{`${c} — ${COUNTRIES[c]}`}</option>)}
        </select></label>
      <Field label={`Valor a receber (${cur})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      {amt > 0 && cur !== "EUR" && <Msg kind="info">1 {cur} = {eur((RATES[cur] ?? 1))} · taxa {FEE * 100}% · será debitado {eur(n)}</Msg>}
      <p className="text-xs text-muted-foreground">Limites: {eur(LIMITS.perTransfer)} por envio · {eur(LIMITS.perDay)} por dia · usado hoje {eur(sentToday(user))}</p>
      {err && <Msg>{err}</Msg>}
      <Btn>Continuar</Btn>
    </form>
  );
}

function AddScreen({ go, refresh }: { go: Go; refresh: Refresh }) {
  const [amount, setAmount] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const add = useServerFn(deposit);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); if (busy) return;
    const n = parseFloat(amount.replace(",", "."));
    if (!(n > 0) || n > 5000) return setErr("Valor entre 0,01 € e 5 000 €.");
    setBusy(true);
    try { await add({ data: { amount: n, key: uid() } }); await refresh(); go("home"); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Back onClick={() => go("home")} />
      <Title sub="Adiciona saldo fictício à tua conta.">Adicionar dinheiro</Title>
      <div className="grid grid-cols-3 gap-2">{[50, 100, 500].map((v) => <Btn type="button" variant="ghost" key={v} onClick={() => setAmount(String(v))}>{eur(v)}</Btn>)}</div>
      <Field label="Valor (€)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      {err && <Msg>{err}</Msg>}
      <Btn variant="accent" disabled={busy}>Adicionar</Btn>
    </form>
  );
}

function FxScreen({ user, go, refresh }: { user: User; go: Go; refresh: Refresh }) {
  const [from, setFrom] = useState("EUR"); const [to, setTo] = useState("GBP");
  const [amount, setAmount] = useState(""); const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const fx = useServerFn(exchange);
  const bal = (c: string) => (c === "EUR" ? user.balance : user.wallets?.[c] ?? 0);
  const n = parseFloat(amount.replace(",", "."));
  const out = n > 0 ? convert(n, from, to) : 0;
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); if (busy) return; setErr(null); setOk(null);
    if (from === to) return setErr("Escolhe moedas diferentes.");
    if (!(n > 0)) return setErr("Valor inválido.");
    if (n > bal(from)) return setErr("Saldo insuficiente nessa moeda.");
    setBusy(true);
    try {
      const r = await fx({ data: { from, to, amount: n, key: uid() } });
      await refresh(); setOk(`Trocaste ${money(n, from)} por ${money(r.out, to)}.`); setAmount("");
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const Sel = ({ v, set }: { v: string; set: (c: string) => void }) => (
    <select value={v} onChange={(e) => set(e.target.value)} className="h-12 rounded-xl border border-input bg-card px-3 font-semibold">
      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>);
  return (
    <form onSubmit={submit} className="space-y-4">
      <Back onClick={() => go("home")} />
      <Title sub="Taxas de demonstração · comissão de 0,5%">Câmbio</Title>
      <div className="rounded-2xl bg-card p-4 shadow-soft">
        <p className="text-xs text-muted-foreground">Tens {money(bal(from), from)}</p>
        <div className="mt-2 flex gap-2"><Sel v={from} set={setFrom} />
          <input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-background px-4 text-right font-display text-lg outline-none focus:ring-2 focus:ring-ring" /></div>
      </div>
      <button type="button" aria-label="Inverter" onClick={() => { setFrom(to); setTo(from); }} className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-accent text-accent-foreground"><ArrowLeftRight className="h-4 w-4 rotate-90" /></button>
      <div className="rounded-2xl bg-card p-4 shadow-soft">
        <p className="text-xs text-muted-foreground">Recebes</p>
        <div className="mt-2 flex items-center gap-2"><Sel v={to} set={setTo} /><p className="flex-1 text-right font-display text-lg font-semibold">{money(out, to)}</p></div>
      </div>
      <p className="text-center text-xs text-muted-foreground">1 {from} = {convert(1, from, to, false).toFixed(4)} {to}</p>
      {err && <Msg>{err}</Msg>}{ok && <Msg kind="ok">{ok}</Msg>}
      <Btn disabled={busy}>Trocar</Btn>
    </form>
  );
}

function ProfileScreen({ user, go, logout }: { user: User; go: Go; logout: () => void }) {
  const items = [
    { i: ShieldCheck, l: "Segurança e atividade", f: () => go("security") },
    { i: Lock, l: user.hasPin ? "Alterar PIN" : "Definir PIN", f: () => go("pin") },
    { i: LogOut, l: "Terminar sessão", f: logout },
  ];
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-primary font-display text-xl text-primary-foreground">{user.name.slice(0, 2).toUpperCase()}</span>
        <div><h1 className="font-display text-xl font-semibold">{user.name}</h1><p className="text-sm text-muted-foreground">{user.email}</p></div>
      </div>
      <ul className="divide-y divide-border rounded-2xl bg-card">
        {items.map(({ i: I, l, f }) => <li key={l}><button onClick={f} className="flex w-full items-center gap-3 p-4 text-left font-medium"><I className="h-5 w-5 text-primary" />{l}</button></li>)}
      </ul>
      <p className="text-center text-xs text-muted-foreground">Triple Bank · demonstração, sem dinheiro real.</p>
    </div>
  );
}

function MfaSetup({ refresh, onDone }: { refresh: Refresh; onDone: () => void }) {
  const [f, setF] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState(""); const [err, setErr] = useState<string | null>(null);
  const log = useServerFn(logEvent);
  useEffect(() => {
    (async () => {
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const x of list?.all ?? []) if (x.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: x.id });
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Triple Bank ${Date.now()}` });
      if (error || !data) return setErr("Não foi possível iniciar a configuração.");
      setF({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, []);
  const verify = async (ev: React.FormEvent) => {
    ev.preventDefault(); if (!f) return;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code });
    if (error) { setCode(""); return setErr("Código inválido."); }
    await log({ data: { action: "mfa_on" } }).catch(() => {}); await refresh(); onDone();
  };
  return (
    <form onSubmit={verify} className="space-y-4 rounded-2xl bg-card p-5">
      <p className="text-sm">1. Lê este código QR com o Google Authenticator, Microsoft Authenticator ou similar.</p>
      {f ? <img src={f.qr} alt="Código QR para a app autenticadora" className="mx-auto h-44 w-44 rounded-xl bg-background p-2" /> : <p className="text-center text-sm text-muted-foreground">A gerar…</p>}
      {f && <p className="break-all text-center text-xs text-muted-foreground">Chave manual: {f.secret}</p>}
      <p className="text-sm">2. Escreve o código de 6 dígitos que aparece na app.</p>
      <PinInput value={code} onChange={setCode} />
      {err && <Msg>{err}</Msg>}
      <Btn disabled={code.length !== 6}>Ativar</Btn>
    </form>
  );
}

function SecurityScreen({ user, go, refresh }: { user: User; go: Go; refresh: Refresh }) {
  const [setup, setSetup] = useState(false); const [err, setErr] = useState<string | null>(null);
  const log = useServerFn(logEvent);
  const disable = async () => {
    if (!confirm("Desativar a verificação em dois passos?")) return;
    const { data } = await supabase.auth.mfa.listFactors();
    for (const x of data?.totp ?? []) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: x.id });
      if (error) return setErr("Para desativar, termina sessão e volta a entrar com o código.");
    }
    await log({ data: { action: "mfa_off" } }).catch(() => {}); await supabase.auth.refreshSession(); await refresh();
  };
  return (
    <div className="space-y-5">
      <Back onClick={() => go("profile")} />
      <Title sub="Proteções da tua conta e registo de atividade.">Segurança e atividade</Title>
      <div className="rounded-2xl bg-card p-4">
        <div className="flex items-center gap-3">
          <KeyRound className="h-5 w-5 text-primary" />
          <div className="flex-1"><p className="font-medium">Verificação em dois passos</p><p className="text-xs text-muted-foreground">{user.mfa ? "Ativa — pedida a cada início de sessão." : "Recomendado: usa uma app autenticadora."}</p></div>
          {user.mfa
            ? <button onClick={disable} className="text-sm font-medium text-destructive">Desativar</button>
            : !setup && <button onClick={() => setSetup(true)} className="text-sm font-medium text-primary">Ativar</button>}
        </div>
        {err && <div className="mt-3"><Msg>{err}</Msg></div>}
      </div>
      {setup && !user.mfa && <MfaSetup refresh={refresh} onDone={() => setSetup(false)} />}
      <ul className="grid grid-cols-2 gap-3 text-sm">
        {["PIN em cada envio", "Email verificado", "Sessão expira em 5 min", `Limite diário ${eur(LIMITS.perDay)}`].map((t) =>
          <li key={t} className="flex items-center gap-2 rounded-xl bg-card p-3"><ShieldCheck className="h-4 w-4 shrink-0 text-success" />{t}</li>)}
      </ul>
      <ul className="divide-y divide-border rounded-2xl bg-card">
        {user.logs.map((l, i) => (
          <li key={i} className="p-4"><div className="flex justify-between gap-2"><p className="font-medium">{l.action}</p><p className="shrink-0 text-xs text-muted-foreground">{fmtDate(l.at)}</p></div>
            {(l.detail || l.ip) && <p className="text-sm text-muted-foreground">{[l.detail, l.ip && `IP ${l.ip}`].filter(Boolean).join(" · ")}</p>}</li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- shared UI ---------- */
function Btn({ children, variant = "primary", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "accent" | "ghost" }) {
  const v = {
    primary: "bg-primary text-primary-foreground",
    accent: "bg-accent text-accent-foreground",
    ghost: "bg-secondary text-secondary-foreground",
  }[variant];
  return <button {...p} className={`h-12 w-full rounded-xl font-semibold transition active:scale-[0.98] disabled:opacity-50 ${v} ${p.className ?? ""}`}>{children}</button>;
}
function Field({ label, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <input {...p} className="h-12 w-full rounded-xl border border-input bg-card px-4 text-foreground outline-none focus:ring-2 focus:ring-ring" />
    </label>
  );
}
function Back({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground"><ChevronLeft className="h-4 w-4" />Voltar</button>;
}
function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  return <div className="mb-6"><h1 className="font-display text-2xl font-semibold">{children}</h1>{sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}</div>;
}
function Msg({ kind = "err", children }: { kind?: "err" | "ok" | "info"; children: ReactNode }) {
  const c = { err: "bg-destructive/10 text-destructive", ok: "bg-success/10 text-success", info: "bg-secondary text-secondary-foreground" }[kind];
  return <p className={`rounded-xl px-4 py-3 text-sm ${c}`}>{children}</p>;
}
function DemoBadge() {
  return <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold tracking-wider text-accent-foreground">DEMO</span>;
}

type Go = (s: Screen) => void;

function Landing({ go }: { go: Go }) {
  const feats = [
    { i: ArrowLeftRight, t: "Câmbio em 8 moedas", d: "EUR, GBP, CHF, USD, PLN, SEK, NOK e DKK com comissão de 0,5%." },
    { i: Send, t: "Envios para toda a Europa", d: "Transfere para 14 países na moeda local de quem recebe." },
    { i: Lock, t: "PIN em cada envio", d: "Nenhuma transferência sai sem confirmação." },
    { i: Shield, t: "Limites inteligentes", d: `Até ${eur(LIMITS.perTransfer)} por envio e ${eur(LIMITS.perDay)} por dia.` },
    { i: History, t: "Registo de atividade", d: "Cada operação fica registada com data e hora." },
  ];
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
      <div className="flex items-center gap-2 font-display text-lg font-semibold">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">TB</span>Triple Bank
      </div>
      <div className="mt-12">
        <h1 className="font-display text-4xl font-semibold leading-tight">O teu dinheiro,<br /><span className="text-primary">sem fronteiras.</span></h1>
        <p className="mt-4 text-muted-foreground">Troca moedas e envia dinheiro para qualquer parte da Europa, de forma simples e segura.</p>
      </div>
      <div className="mt-8 rounded-3xl bg-card-gradient p-6 text-primary-foreground shadow-soft">
        <div className="flex justify-between text-sm opacity-80"><span>Saldo disponível</span><DemoBadge /></div>
        <p className="mt-2 font-display text-3xl font-semibold">€ 2 450,00</p>
        <p className="mt-6 tracking-[0.3em] opacity-70">•••• 4821</p>
      </div>
      <ul className="mt-8 space-y-4">
        {feats.map(({ i: I, t, d }) => (
          <li key={t} className="flex gap-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><I className="h-5 w-5" /></span>
            <div><p className="font-semibold">{t}</p><p className="text-sm text-muted-foreground">{d}</p></div>
          </li>
        ))}
      </ul>
      <div className="mt-auto space-y-3 pt-10">
        <Btn onClick={() => go("signup")}>Criar conta</Btn>
        <Btn variant="ghost" onClick={() => go("login")}>Entrar na conta</Btn>
        <p className="pt-2 text-center text-xs text-muted-foreground">Versão de demonstração — não movimenta dinheiro real.</p>
      </div>
    </div>
  );
}

function PinInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input inputMode="numeric" autoFocus type="password" maxLength={6} value={value}
    onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
    className="h-14 w-full rounded-xl border border-input bg-card text-center font-display text-2xl tracking-[0.6em] outline-none focus:ring-2 focus:ring-ring" />;
}

function HomeScreen({ user, go }: { user: User; go: Go }) {
  const [hide, setHide] = useState(false);
  const actions = [
    { i: Plus, l: "Adicionar", s: "add" as Screen },
    { i: Send, l: "Enviar", s: "send" as Screen },
    { i: CreditCard, l: "Cartão", s: "card" as Screen },
    { i: ArrowLeftRight, l: "Câmbio", s: "fx" as Screen },
  ];
  const wallets = Object.entries(user.wallets ?? {}).filter(([, v]) => v > 0);
  const used = sentToday(user);
  return (
    <div className="space-y-6">
      <div><p className="text-sm text-muted-foreground">Bem-vindo de volta</p><h1 className="font-display text-2xl font-semibold">Olá, {user.name.split(" ")[0]}</h1></div>
      <div className="rounded-3xl bg-card-gradient p-6 text-primary-foreground shadow-soft">
        <div className="flex items-center justify-between text-sm opacity-80"><span>Saldo disponível</span><DemoBadge /></div>
        <div className="mt-2 flex items-center gap-3">
          <p className="font-display text-3xl font-semibold">{hide ? "••••••" : eur(user.balance)}</p>
          <button aria-label="Mostrar/ocultar saldo" onClick={() => setHide(!hide)} className="opacity-80">{hide ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}</button>
        </div>
        <div className="mt-5">
          <div className="flex justify-between text-xs opacity-80"><span>Enviado hoje</span><span>{eur(used)} / {eur(LIMITS.perDay)}</span></div>
          <div className="mt-1.5 h-1.5 rounded-full bg-primary-foreground/20"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (used / LIMITS.perDay) * 100)}%` }} /></div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {actions.map(({ i: I, l, s }) => (
          <button key={l} onClick={() => go(s)} className="flex flex-col items-center gap-2 text-xs font-medium">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-card text-primary shadow-soft"><I className="h-5 w-5" /></span>{l}
          </button>
        ))}
      </div>
      {wallets.length > 0 && (
        <section><h2 className="mb-3 font-display font-semibold">Outras moedas</h2>
          <div className="flex gap-3 overflow-x-auto">{wallets.map(([c, v]) => (
            <div key={c} className="min-w-28 rounded-2xl bg-card p-4 shadow-soft"><p className="text-xs font-bold text-muted-foreground">{c}</p><p className="font-display font-semibold">{money(v, c)}</p></div>))}</div>
        </section>)}
      <section>
        <div className="mb-3 flex justify-between"><h2 className="font-display font-semibold">Movimentos recentes</h2><button onClick={() => go("moves")} className="text-sm font-medium text-primary">Ver todos</button></div>
        <TxList user={user} limit={4} />
      </section>
    </div>
  );
}

function TxList({ user, limit }: { user: User; limit?: number }) {
  const txs = limit ? user.txs.slice(0, limit) : user.txs;
  if (!txs.length) return <p className="rounded-2xl bg-card p-6 text-center text-sm text-muted-foreground">Ainda sem movimentos.</p>;
  return (
    <ul className="divide-y divide-border rounded-2xl bg-card">
      {txs.map((t) => (
        <li key={t.id} className="flex items-center gap-3 p-4">
          <span className={`grid h-10 w-10 place-items-center rounded-xl ${t.type === "in" ? "bg-success/10 text-success" : "bg-secondary text-primary"}`}>
            {t.type === "in" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1"><p className="truncate font-medium">{t.label}</p><p className="text-xs text-muted-foreground">{fmtDate(t.at)}</p></div>
          <p className={`font-semibold ${t.type === "in" ? "text-success" : ""}`}>{t.type === "in" ? "+" : t.type === "fx" ? "" : "−"}{eur(t.amount)}</p>
        </li>
      ))}
    </ul>
  );
}

function CardScreen({ user }: { user: User }) {
  return (
    <div className="space-y-6">
      <Title>Cartão</Title>
      <div className="aspect-[1.6] rounded-3xl bg-card-gradient p-6 text-primary-foreground shadow-soft">
        <div className="flex h-full flex-col justify-between">
          <div className="flex justify-between font-display font-semibold"><span>Triple Bank</span><DemoBadge /></div>
          <div><p className="font-display text-xl tracking-[0.25em]">•••• •••• •••• 4821</p>
            <div className="mt-3 flex justify-between text-sm opacity-80"><span>{user.name.toUpperCase()}</span><span>12/30</span></div></div>
        </div>
      </div>
      <Msg kind="info">Este cartão é apenas visual e não permite pagamentos reais.</Msg>
    </div>
  );
}
function MovesScreen({ user }: { user: User }) {
  return <div><Title sub={`${user.txs.length} movimentos`}>Movimentos</Title><TxList user={user} /></div>;
}

function TabBar({ screen, go }: { screen: Screen; go: Go }) {
  const tabs = [
    { i: Home, l: "Início", s: "home" as Screen },
    { i: Send, l: "Enviar", s: "send" as Screen },
    { i: History, l: "Movimentos", s: "moves" as Screen },
    { i: UserIcon, l: "Perfil", s: "profile" as Screen },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 mx-auto max-w-md border-t border-border bg-card/95 px-4 pb-5 pt-3 backdrop-blur">
      <ul className="grid grid-cols-4">
        {tabs.map(({ i: I, l, s }) => (
          <li key={l}><button onClick={() => go(s)} className={`flex w-full flex-col items-center gap-1 text-xs font-medium ${screen === s ? "text-primary" : "text-muted-foreground"}`}><I className="h-5 w-5" />{l}</button></li>
        ))}
      </ul>
    </nav>
  );
}

