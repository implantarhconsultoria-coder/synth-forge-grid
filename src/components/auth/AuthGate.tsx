import { useEffect, useState } from "react";
import { KeyRound, Loader2, LogIn, Mail, ShieldCheck, UserPlus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup" | "reset" | "update";

const SUPPORT_EMAIL = import.meta.env.VITE_IMPLANTA_SUPPORT_EMAIL || "suporte@implantarh.com";

function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/85 p-6 shadow-[0_14px_40px_rgba(2,8,23,0.32)]">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">
          <ShieldCheck className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-border/70 bg-background/80 px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary";

function ActionButton({
  busy,
  icon: Icon,
  label,
}: {
  busy: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground hover:opacity-95 disabled:opacity-60"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
      {label}
    </button>
  );
}

export function AuthGate() {
  const {
    loading,
    bootError,
    requiresPasswordUpdate,
    signIn,
    signUp,
    sendPasswordReset,
    updatePassword,
  } = useAuth();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const authMode = params.get("auth");
    if (authMode === "reset" || authMode === "recovery") {
      setMode("reset");
      const prefillEmail = params.get("email");
      if (prefillEmail) setEmail(prefillEmail);
    }
  }, []);

  useEffect(() => {
    if (requiresPasswordUpdate) setMode("update");
  }, [requiresPasswordUpdate]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-4 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Inicializando autenticacao...
        </div>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <AuthCard
          title="Conexao de autenticacao indisponivel"
          subtitle="Valide as variaveis SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY."
        >
          <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
            {bootError}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Suporte: <span className="font-medium text-foreground">{SUPPORT_EMAIL}</span>
          </p>
        </AuthCard>
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
      } else if (mode === "signup") {
        if (password.length < 8) throw new Error("Use no minimo 8 caracteres para a senha.");
        await signUp(email.trim(), password);
        setMessage(
          "Cadastro enviado. Verifique seu e-mail para confirmar a conta e ativar o acesso.",
        );
      } else if (mode === "reset") {
        await sendPasswordReset(email.trim());
        setMessage("Link de recuperacao enviado para o e-mail informado.");
      } else {
        if (password.length < 8) throw new Error("Use no minimo 8 caracteres para a nova senha.");
        if (password !== confirmPassword) throw new Error("As senhas nao conferem.");
        await updatePassword(password);
        setMessage("Senha atualizada com sucesso. Acesso liberado.");
        setMode("signin");
        setPassword("");
        setConfirmPassword("");
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Falha ao autenticar.");
    } finally {
      setBusy(false);
    }
  }

  const showEmail = mode !== "update";
  const title =
    mode === "signup"
      ? "Criar acesso"
      : mode === "reset"
        ? "Recuperar senha"
        : mode === "update"
          ? "Definir nova senha"
          : "Entrar no AI Factory";
  const subtitle =
    mode === "signup"
      ? "Use seu e-mail corporativo para ativar o workspace."
      : mode === "reset"
        ? "Receba um link seguro para redefinir a senha."
        : mode === "update"
          ? "Atualize a senha para concluir a recuperacao."
          : "Autenticacao real via Supabase com sessao persistente.";

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <AuthCard title={title} subtitle={subtitle}>
        <form className="space-y-3" onSubmit={onSubmit}>
          {showEmail && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
                placeholder="nome@implantarh.com"
                autoComplete="email"
                required
              />
            </div>
          )}

          {mode !== "reset" && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                {mode === "update" ? "Nova senha" : "Senha"}
              </label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClass}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
              />
            </div>
          )}

          {mode === "signin" && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setMode("reset");
                  setError(null);
                  setMessage(null);
                }}
                className="text-xs font-medium text-primary hover:opacity-90"
              >
                Esqueci a senha
              </button>
            </div>
          )}

          {mode === "update" && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Confirmar nova senha</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className={inputClass}
                autoComplete="new-password"
                required
              />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          {message && (
            <div className="rounded-lg border border-success/35 bg-success/10 px-3 py-2 text-xs text-success">
              {message}
            </div>
          )}

          {mode === "signin" && <ActionButton busy={busy} icon={LogIn} label="Entrar" />}
          {mode === "signup" && <ActionButton busy={busy} icon={UserPlus} label="Criar conta" />}
          {mode === "reset" && <ActionButton busy={busy} icon={Mail} label="Enviar link" />}
          {mode === "update" && (
            <ActionButton busy={busy} icon={KeyRound} label="Atualizar senha" />
          )}
        </form>

        {mode !== "update" && (
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg border border-border/60 p-1">
            {[
              { key: "signin", label: "Entrar" },
              { key: "signup", label: "Cadastro" },
              { key: "reset", label: "Recuperar" },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setMode(item.key as Mode);
                  setError(null);
                  setMessage(null);
                }}
                className={cn(
                  "rounded-md px-2 py-1.5 text-xs transition",
                  mode === item.key
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Suporte ImplantaRH: <span className="font-medium text-foreground">{SUPPORT_EMAIL}</span>
        </p>
      </AuthCard>
    </div>
  );
}
