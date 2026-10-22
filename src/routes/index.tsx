import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownLeft, ArrowUpRight, CreditCard, Eye, EyeOff, History, Home, Lock, LogOut,
  Plus, Send, ArrowLeftRight, Shield, ShieldCheck, User as UserIcon, ChevronLeft, AlertTriangle,
} from "lucide-react";
import {
  IDLE_MS, LIMITS, RATES, CURRENCIES, COUNTRIES, FEE, convert, money, LOGIN, checkPassword, checkTransfer, eur, hash, load, save, sentToday,
  type User,
} from "@/lib/bank";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Triple Bank — O teu dinheiro, mais simples" },
      { name: "description", content: "Banco digital de demonstração com transferências protegidas por PIN, limites diários e registo de atividade." },
      { property: "og:title", content: "Triple Bank — O teu dinheiro, mais simples" },
      { property: "og:description", content: "Banco digital de demonstração com transferências protegidas por PIN e limites." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: App,
});

type Screen = "landing" | "login" | "signup" | "home" | "send" | "add" | "card" | "moves" | "profile" | "security" | "pin" | "fx";

const uid = () => crypto.randomUUID();
const fmtDate = (t: number) =>
  new Date(t).toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function App() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [email, setEmail] = useState<string | null>(null);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setUsers(load()), []);
  const user = email ? users[email] : undefined;

  const update = (e: string, fn: (u: User) => User) => {
    setUsers((prev) => {
      const next = { ...prev, [e]: fn(prev[e]) };
      save(next);
      return next;
    });
  };
  const log = (u: User, action: string, detail = ""): User => ({
    ...u, logs: [{ at: Date.now(), action, detail }, ...u.logs].slice(0, 200),
  });

  // Inactivity timeout
  useEffect(() => {
    if (!email) return;
    let t: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        update(email, (u) => log(u, "Sessão expirada", "Inatividade"));
        setEmail(null);
        setScreen("login");
        setNotice("Sessão terminada por inatividade.");
      }, IDLE_MS);
    };
    const evs = ["click", "keydown", "touchstart"];
    evs.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, reset)); };
  }, [email]);

  const go = (s: Screen) => { setNotice(null); setScreen(s); };
  const logout = () => { if (email) update(email, (u) => log(u, "Fim de sessão")); setEmail(null); go("landing"); };

  if (!user || ["landing", "login", "signup"].includes(screen)) {
    if (screen === "login")
      return <LoginScreen users={users} notice={notice} go={go} update={update} log={log}
        onOk={(e, hasPin) => { setEmail(e); go(hasPin ? "home" : "pin"); }} />;
    if (screen === "signup")
      return <SignupScreen users={users} go={go}
        onCreate={(u) => { const next = { ...users, [u.email]: u }; save(next); setUsers(next); setEmail(u.email); go("pin"); }} />;
    return <Landing go={go} />;
  }

  const body: Record<string, ReactNode> = {
    home: <HomeScreen user={user} go={go} />,
    send: <SendScreen user={user} go={go} update={update} log={log} />,
    add: <AddScreen user={user} go={go} update={update} log={log} />,
    card: <CardScreen user={user} />,
    fx: <FxScreen user={user} go={go} update={update} log={log} />,
    moves: <MovesScreen user={user} />,
    profile: <ProfileScreen user={user} go={go} logout={logout} />,
    security: <SecurityScreen user={user} go={go} />,
    pin: <PinSetup user={user} go={go} update={update} log={log} />,
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-background">
      <main className="flex-1 px-5 pb-28 pt-6">{body[screen]}</main>
      {screen !== "pin" && <TabBar screen={screen} go={go} />}
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
type Upd = (e: string, fn: (u: User) => User) => void;
type LogFn = (u: User, a: string, d?: string) => User;

/* ---------- public ---------- */
function Landing({ go }: { go: Go }) {
  const feats = [
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
        <h1 className="font-display text-4xl font-semibold leading-tight">O teu dinheiro,<br /><span className="text-primary">mais simples.</span></h1>
        <p className="mt-4 text-muted-foreground">Uma plataforma digital moderna para gerir a tua experiência financeira.</p>
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

function LoginScreen({ users, notice, go, onOk, update, log }: {
  users: Record<string, User>; notice: string | null; go: Go; onOk: (e: string, hasPin: boolean) => void; update: Upd; log: LogFn;
}) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(null);
    const e = email.trim().toLowerCase(); const u = users[e];
    const generic = "Email ou palavra-passe incorretos.";
    if (!u) return setErr(generic);
    if (u.lockedUntil > Date.now()) {
      const m = Math.ceil((u.lockedUntil - Date.now()) / 60000);
      return setErr(`Conta bloqueada temporariamente. Tenta daqui a ${m} min.`);
    }
    setBusy(true);
    const ok = (await hash(pw, u.salt)) === u.pwHash;
    setBusy(false);
    if (!ok) {
      const attempts = u.attempts + 1;
      const lock = attempts >= LOGIN.maxAttempts;
      update(e, (x) => log({ ...x, attempts: lock ? 0 : attempts, lockedUntil: lock ? Date.now() + LOGIN.lockMs : 0 }, "Login falhado", lock ? "Conta bloqueada 5 min" : `Tentativa ${attempts}`));
      return setErr(lock ? "Demasiadas tentativas. Conta bloqueada por 5 minutos." : `${generic} (${LOGIN.maxAttempts - attempts} tentativas restantes)`);
    }
    update(e, (x) => log({ ...x, attempts: 0, lockedUntil: 0 }, "Início de sessão"));
    onOk(e, !!u.pinHash);
  };
  return (
    <div className="mx-auto min-h-screen max-w-md px-6 py-8">
      <Back onClick={() => go("landing")} />
      <Title sub="Acede à tua conta de demonstração.">Entrar</Title>
      <form onSubmit={submit} className="space-y-4">
        {notice && <Msg kind="info">{notice}</Msg>}
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Palavra-passe" type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <Msg>{err}</Msg>}
        <Btn disabled={busy}>{busy ? "A verificar…" : "Entrar"}</Btn>
        <button type="button" onClick={() => go("signup")} className="w-full text-center text-sm font-medium text-primary">Ainda não tenho conta</button>
      </form>
    </div>
  );
}

function SignupScreen({ users, go, onCreate }: { users: Record<string, User>; go: Go; onCreate: (u: User) => void }) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const strength = checkPassword(pw);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(null);
    const e = email.trim().toLowerCase();
    if (name.trim().length < 2 || name.length > 60) return setErr("Indica o teu nome.");
    if (users[e]) return setErr("Já existe uma conta com este email.");
    if (strength) return setErr(strength);
    const salt = uid();
    onCreate({
      name: name.trim(), email: e, salt, pwHash: await hash(pw, salt), balance: 0, txs: [],
      logs: [{ at: Date.now(), action: "Conta criada", detail: "" }], attempts: 0, lockedUntil: 0,
    });
  };
  return (
    <div className="mx-auto min-h-screen max-w-md px-6 py-8">
      <Back onClick={() => go("landing")} />
      <Title sub="Cria uma conta de demonstração no Triple Bank.">Criar conta</Title>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Email" type="email" required maxLength={120} value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Palavra-passe" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
        {pw && <p className={`text-xs ${strength ? "text-destructive" : "text-success"}`}>{strength ?? "Palavra-passe forte ✓"}</p>}
        {err && <Msg>{err}</Msg>}
        <Btn>Criar conta</Btn>
        <button type="button" onClick={() => go("login")} className="w-full text-center text-sm font-medium text-primary">Já tenho conta</button>
      </form>
    </div>
  );
}

/* ---------- app ---------- */
function PinSetup({ user, go, update, log }: { user: User; go: Go; update: Upd; log: LogFn }) {
  const [pin, setPin] = useState(""); const [err, setErr] = useState<string | null>(null);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!/^\d{4,6}$/.test(pin) || /^(\d)\1+$/.test(pin) || "0123456789".includes(pin)) return setErr("Escolhe 4 a 6 dígitos, não sequenciais nem repetidos.");
    const h = await hash(pin, user.salt + "pin");
    update(user.email, (u) => log({ ...u, pinHash: h }, "PIN definido"));
    go("home");
  };
  return (
    <form onSubmit={submit} className="space-y-5">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-primary"><Lock className="h-7 w-7" /></span>
      <Title sub="Será pedido sempre que enviares dinheiro.">Define o teu PIN</Title>
      <PinInput value={pin} onChange={setPin} />
      {err && <Msg>{err}</Msg>}
      <Btn>Guardar PIN</Btn>
    </form>
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
          <p className={`font-semibold ${t.type === "in" ? "text-success" : ""}`}>{t.type === "in" ? "+" : "−"}{eur(t.amount)}</p>
        </li>
      ))}
    </ul>
  );
}

function SendScreen({ user, go, update, log }: { user: User; go: Go; update: Upd; log: LogFn }) {
  const [to, setTo] = useState(""); const [amount, setAmount] = useState("");
  const [country, setCountry] = useState("Portugal"); const cur = COUNTRIES[country];
  const [step, setStep] = useState<"form" | "pin" | "done">("form");
  const [pin, setPin] = useState(""); const [err, setErr] = useState<string | null>(null);
  const [pinTries, setPinTries] = useState(0);
  const opKey = useRef<string | null>(null); // idempotency key per operation
  const done = useRef(new Set<string>());
  const amt = parseFloat(amount.replace(",", "."));
  // EUR debited from the account (includes exchange fee when currency differs)
  const n = amt > 0 ? Math.round(amt * RATES[cur] * (cur === "EUR" ? 1 : 1 + FEE) * 100) / 100 : NaN;
  const dest = `${to.trim()} (${country})`;

  const next = (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(null);
    if (to.trim().length < 2) return setErr("Indica o destinatário.");
    const e = checkTransfer(user, n); if (e) return setErr(e);
    opKey.current = uid(); setStep("pin");
  };
  const confirm = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(null);
    const key = opKey.current;
    if (!key || done.current.has(key)) return; // double click guard
    done.current.add(key);
    if ((await hash(pin, user.salt + "pin")) !== user.pinHash) {
      done.current.delete(key);
      const t = pinTries + 1; setPinTries(t); setPin("");
      update(user.email, (u) => log(u, "PIN incorreto", "Transferência"));
      if (t >= 3) { setErr("PIN errado 3 vezes. Operação cancelada."); setStep("form"); setPinTries(0); return; }
      return setErr(`PIN incorreto. ${3 - t} tentativas restantes.`);
    }
    update(user.email, (u) => {
      let x: User = { ...u, balance: u.balance - n, txs: [{ id: key, type: "out", amount: n, label: `Para ${dest} · ${money(amt, cur)}`, at: Date.now() }, ...u.txs] };
      x = log(x, "Transferência enviada", `${money(amt, cur)} (${eur(n)}) para ${dest}`);
      if (n >= LIMITS.unusual) x = log(x, "⚠ Alerta", `Valor elevado: ${eur(n)}`);
      return x;
    });
    setStep("done");
  };

  if (step === "done") return (
    <div className="space-y-6 pt-10 text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success/10 text-success"><ShieldCheck className="h-8 w-8" /></span>
      <Title sub={`Para ${dest} · debitado ${eur(n)}`}>{money(amt, cur)} enviados</Title>
      {n >= LIMITS.unusual && <Msg kind="info">Enviámos um alerta de segurança por se tratar de um valor elevado.</Msg>}
      <Btn onClick={() => go("home")}>Voltar ao início</Btn>
    </div>
  );
  if (step === "pin") return (
    <form onSubmit={confirm} className="space-y-5">
      <Back onClick={() => { setStep("form"); setPin(""); }} />
      <Title sub={`Enviar ${money(amt, cur)} para ${dest} · debitado ${eur(n)}`}>Confirma com o PIN</Title>
      <PinInput value={pin} onChange={setPin} />
      {err && <Msg>{err}</Msg>}
      <Btn disabled={pin.length < 4}>Confirmar envio</Btn>
    </form>
  );
  return (
    <form onSubmit={next} className="space-y-4">
      <Back onClick={() => go("home")} />
      <Title sub={`Disponível: ${eur(user.balance)}`}>Enviar dinheiro</Title>
      <Field label="Destinatário (nome ou IBAN)" maxLength={60} value={to} onChange={(e) => setTo(e.target.value)} />
      <label className="block space-y-1.5"><span className="text-sm font-medium text-muted-foreground">País de destino</span>
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="h-12 w-full rounded-xl border border-input bg-card px-4">
          {Object.keys(COUNTRIES).map((c) => <option key={c}>{c} — {COUNTRIES[c]}</option>).map((o, i) => ({ ...o, props: { ...o.props, value: Object.keys(COUNTRIES)[i] } }))}
        </select></label>
      <Field label={`Valor a receber (${cur})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      {amt > 0 && cur !== "EUR" && <Msg kind="info">1 {cur} = {eur(RATES[cur])} · taxa {FEE * 100}% · será debitado {eur(n)}</Msg>}
      <p className="text-xs text-muted-foreground">Limites: {eur(LIMITS.perTransfer)} por envio · {eur(LIMITS.perDay)} por dia · usado hoje {eur(sentToday(user))}</p>
      {err && <Msg>{err}</Msg>}
      <Btn>Continuar</Btn>
    </form>
  );
}

function AddScreen({ user, go, update, log }: { user: User; go: Go; update: Upd; log: LogFn }) {
  const [amount, setAmount] = useState(""); const [err, setErr] = useState<string | null>(null);
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const n = parseFloat(amount.replace(",", "."));
    if (!(n > 0) || n > 5000) return setErr("Valor entre 0,01 € e 5 000 €.");
    update(user.email, (u) => log({ ...u, balance: u.balance + n, txs: [{ id: uid(), type: "in", amount: n, label: "Carregamento demo", at: Date.now() }, ...u.txs] }, "Carregamento", eur(n)));
    go("home");
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Back onClick={() => go("home")} />
      <Title sub="Adiciona saldo fictício à tua conta.">Adicionar dinheiro</Title>
      <div className="grid grid-cols-3 gap-2">{[50, 100, 500].map((v) => <Btn type="button" variant="ghost" key={v} onClick={() => setAmount(String(v))}>{eur(v)}</Btn>)}</div>
      <Field label="Valor (€)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      {err && <Msg>{err}</Msg>}
      <Btn variant="accent">Adicionar</Btn>
    </form>
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

function ProfileScreen({ user, go, logout }: { user: User; go: Go; logout: () => void }) {
  const items = [
    { i: ShieldCheck, l: "Segurança e atividade", f: () => go("security") },
    { i: Lock, l: "Alterar PIN", f: () => go("pin") },
    { i: AlertTriangle, l: "Limpar dados da demo", f: () => { if (confirm("Apagar todos os dados da demonstração?")) { localStorage.removeItem("tb_users_v2"); location.reload(); } } },
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
      <p className="text-center text-xs text-muted-foreground">Triple Bank · demonstração. Dados guardados apenas neste navegador.</p>
    </div>
  );
}

function SecurityScreen({ user, go }: { user: User; go: Go }) {
  return (
    <div className="space-y-5">
      <Back onClick={() => go("profile")} />
      <Title sub="Todas as ações na tua conta.">Segurança e atividade</Title>
      <ul className="grid grid-cols-2 gap-3 text-sm">
        {["PIN em cada envio", "Bloqueio após 5 tentativas", "Sessão expira em 5 min", `Limite diário ${eur(LIMITS.perDay)}`].map((t) =>
          <li key={t} className="flex items-center gap-2 rounded-xl bg-card p-3"><ShieldCheck className="h-4 w-4 shrink-0 text-success" />{t}</li>)}
      </ul>
      <ul className="divide-y divide-border rounded-2xl bg-card">
        {user.logs.map((l, i) => (
          <li key={i} className="p-4"><div className="flex justify-between gap-2"><p className="font-medium">{l.action}</p><p className="shrink-0 text-xs text-muted-foreground">{fmtDate(l.at)}</p></div>
            {l.detail && <p className="text-sm text-muted-foreground">{l.detail}</p>}</li>
        ))}
      </ul>
    </div>
  );
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

function FxScreen({ user, go, update, log }: { user: User; go: Go; update: Upd; log: LogFn }) {
  const [from, setFrom] = useState("EUR"); const [to, setTo] = useState("GBP");
  const [amount, setAmount] = useState(""); const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const bal = (c: string) => (c === "EUR" ? user.balance : user.wallets?.[c] ?? 0);
  const n = parseFloat(amount.replace(",", "."));
  const out = n > 0 ? convert(n, from, to) : 0;
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(null); setOk(null);
    if (from === to) return setErr("Escolhe moedas diferentes.");
    if (!(n > 0)) return setErr("Valor inválido.");
    if (n > bal(from)) return setErr("Saldo insuficiente nessa moeda.");
    update(user.email, (u) => {
      const w = { ...(u.wallets ?? {}) }; let b = u.balance;
      if (from === "EUR") b -= n; else w[from] = Math.round(((w[from] ?? 0) - n) * 100) / 100;
      if (to === "EUR") b += out; else w[to] = Math.round(((w[to] ?? 0) + out) * 100) / 100;
      return log({ ...u, balance: Math.round(b * 100) / 100, wallets: w }, "Câmbio", `${money(n, from)} → ${money(out, to)}`);
    });
    setOk(`Trocaste ${money(n, from)} por ${money(out, to)}.`); setAmount("");
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
      <Btn>Trocar</Btn>
    </form>
  );
}
