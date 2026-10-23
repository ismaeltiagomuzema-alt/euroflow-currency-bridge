import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { checkPassword } from "@/lib/bank";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Nova palavra-passe — Triple Bank" },
      { name: "description", content: "Define uma nova palavra-passe para a tua conta Triple Bank." },
      { property: "og:title", content: "Nova palavra-passe — Triple Bank" },
      { property: "og:description", content: "Recuperação segura de palavra-passe do Triple Bank." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const [ok, setOk] = useState(false);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") setOk(true); });
    if (window.location.hash.includes("type=recovery")) setOk(true);
    supabase.auth.getSession().then(({ data: s }) => { if (s.session) setOk(true); });
    return () => data.subscription.unsubscribe();
  }, []);
  const strength = checkPassword(pw);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    if (strength) return setMsg(strength);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return setMsg("Link expirado ou já usado. Pede um novo.");
    await supabase.auth.signOut({ scope: "global" });
    setDone(true);
  };
  return (
    <div className="mx-auto min-h-screen max-w-md space-y-5 px-6 py-12">
      <h1 className="font-display text-2xl font-semibold">Nova palavra-passe</h1>
      {done ? (
        <p className="rounded-xl bg-success/10 px-4 py-3 text-sm text-success">Palavra-passe alterada. Todas as sessões foram terminadas — entra de novo.</p>
      ) : !ok ? (
        <p className="rounded-xl bg-secondary px-4 py-3 text-sm">Abre esta página a partir do link enviado por email. Os links são de uso único e expiram rapidamente.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <input type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Nova palavra-passe"
            className="h-12 w-full rounded-xl border border-input bg-card px-4 outline-none focus:ring-2 focus:ring-ring" />
          {pw && <p className={`text-xs ${strength ? "text-destructive" : "text-success"}`}>{strength ?? "Palavra-passe forte ✓"}</p>}
          {msg && <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{msg}</p>}
          <button className="h-12 w-full rounded-xl bg-primary font-semibold text-primary-foreground">Guardar</button>
        </form>
      )}
      <Link to="/" className="block text-center text-sm font-medium text-primary">Voltar ao início</Link>
    </div>
  );
}
