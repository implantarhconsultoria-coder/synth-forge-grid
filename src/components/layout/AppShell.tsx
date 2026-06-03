import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  Rocket,
  ListChecks,
  FolderKanban,
  Hammer,
  Settings,
  Activity,
  Bell,
  FileText,
  Sparkles,
  RefreshCw,
  Menu,
  Smartphone,
  Mail,
  LogOut,
} from "lucide-react";
import { useEffect, useState } from "react";
import { factoryData, useFactoryData } from "@/lib/factory-data";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { FactoryFab } from "@/components/FactoryFab";
import { useAuth } from "@/lib/auth";
import { AuthGate } from "@/components/auth/AuthGate";
import { useWorkerQueueNotifications } from "@/hooks/useWorkerQueueNotifications";
import { toast } from "sonner";
import { useFactorySettings } from "@/lib/factory-settings";
import { resolveWorkerBase } from "@/lib/worker-endpoint";

const NAV = [
  { to: "/", label: "Missao", icon: Rocket },
  { to: "/projects", label: "Projetos", icon: FolderKanban },
  { to: "/queue", label: "Fila", icon: ListChecks },
  { to: "/reports", label: "Relatorios", icon: FileText },
  { to: "/forge", label: "Forge", icon: Hammer },
  { to: "/private", label: "Mobile", icon: Smartphone },
  { to: "/logs", label: "Logs", icon: Activity },
  { to: "/settings", label: "Configuracoes", icon: Settings },
] as const;

export function AppShell() {
  const { user, signOut } = useAuth();
  const settings = useFactorySettings();
  const authBypass = import.meta.env.VITE_AUTH_BYPASS !== "false";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [authActionBusy, setAuthActionBusy] = useState(false);
  const [unreadReports, setUnreadReports] = useState(0);
  useWorkerQueueNotifications();
  useFactoryData();

  useEffect(() => {
    void factoryData.hydrate();
    const stop = factoryData.startRealtime();
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => {
      stop?.();
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const workerBase = resolveWorkerBase(settings.workerUrl, settings.workerPort);
    let cancelled = false;
    async function loadNotifications() {
      try {
        const response = await fetch(`${workerBase}/notificacoes`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (!cancelled && Array.isArray(payload)) {
          setUnreadReports(payload.filter((item) => item && item.read !== true).length);
        }
      } catch {
        if (!cancelled) setUnreadReports(0);
      }
    }
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [settings.workerPort, settings.workerUrl]);

  if (!user && !authBypass) return <AuthGate />;

  const initials =
    (user?.email || "IR")
      .split("@")[0]
      .split(/[.\-_]/g)
      .filter(Boolean)
      .slice(0, 2)
      .map((chunk) => chunk[0]?.toUpperCase())
      .join("") || "IR";

  async function handleSignOut() {
    setAuthActionBusy(true);
    try {
      await signOut();
      toast.success("Sessao encerrada.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao sair da conta.";
      toast.error(message);
    } finally {
      setAuthActionBusy(false);
    }
  }

  async function handleRecoverPassword() {
    setAuthActionBusy(true);
    try {
      const query = new URLSearchParams({ auth: "reset" });
      if (user?.email) query.set("email", user.email);
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", `/?${query.toString()}`);
      }
      await signOut();
      toast.info("Informe seu e-mail e clique em Enviar link.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao iniciar recuperacao.";
      toast.error(message);
    } finally {
      setAuthActionBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full">
      <aside
        className={`fixed top-0 z-40 h-screen w-64 shrink-0 transition-transform lg:sticky lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col border-r border-border/70 bg-background shadow-[8px_0_34px_rgba(2,8,23,0.2)]">
          <div className="border-b border-border/60 px-5 py-5">
            <Link to="/" className="flex items-center gap-3">
              <div className="relative grid size-9 place-items-center rounded-lg bg-gradient-primary glow-border">
                <Sparkles className="size-5 text-primary-foreground" />
              </div>
              <div>
                <div className="leading-none tracking-tight font-semibold">AI FACTORY</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  ImplantaRH PRO
                </div>
              </div>
            </Link>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
                    active
                      ? "bg-secondary/80 text-foreground glow-border"
                      : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                  }`}
                >
                  <Icon className={`size-4 ${active ? "text-primary" : ""}`} />
                  <span className="font-medium">{item.label}</span>
                  {active && (
                    <span className="ml-auto size-1.5 rounded-full bg-primary pulse-dot text-primary" />
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-border/60 p-3">
            <div className="glass rounded-lg p-3 text-xs">
              <div className="flex items-center gap-2 text-success">
                <Activity className="size-3.5" />
                <span className="font-medium">Sistema operacional</span>
              </div>
              <div className="mt-1 text-muted-foreground">Latencia 12ms - Uptime 99.98%</div>
            </div>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border/60 bg-background/90 px-4 backdrop-blur-sm lg:px-8">
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-md p-2 hover:bg-secondary/50 lg:hidden"
            aria-label="Menu"
          >
            <Menu className="size-4" />
          </button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success pulse-dot text-success" />
            <span>Nucleo IA online</span>
            <span className="hidden sm:inline">- regiao br-sp - v2.4.1</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-md glass px-3 py-1.5 text-xs text-muted-foreground md:flex">
              <kbd className="font-mono">Ctrl</kbd>
              <kbd className="font-mono">K</kbd>
              <span>Buscar / executar</span>
            </div>
            <button
              onClick={() => factoryData.refresh()}
              className="flex items-center gap-1.5 rounded-md glass px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              title="Atualizar dados"
            >
              <RefreshCw className="size-3.5" />
              <span className="hidden sm:inline">Atualizar</span>
            </button>
            <Link
              to="/reports"
              className="relative grid size-8 place-items-center rounded-md border border-border/70 text-muted-foreground hover:text-foreground"
              title="Notificacoes de relatorios"
            >
              <Bell className="size-4" />
              {unreadReports > 0 && (
                <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-bold text-primary-foreground">
                  {unreadReports > 9 ? "9+" : unreadReports}
                </span>
              )}
            </Link>
            <div className="hidden items-center gap-1.5 rounded-md glass px-2.5 py-1.5 text-xs font-mono text-foreground sm:flex">
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              {now.toLocaleTimeString("pt-BR")}
            </div>
            {user ? (
              <>
                <button
                  onClick={() => void handleRecoverPassword()}
                  disabled={authActionBusy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
                  title="Recuperar senha"
                >
                  <Mail className="size-3.5" />
                  <span className="hidden md:inline">Recuperar</span>
                </button>
                <button
                  onClick={() => void handleSignOut()}
                  disabled={authActionBusy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  title="Sair da conta"
                >
                  <LogOut className="size-3.5" />
                  <span className="hidden sm:inline">Sair</span>
                </button>
              </>
            ) : (
              authBypass && (
                <span className="hidden rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning sm:inline">
                  Acesso direto ativo
                </span>
              )
            )}
            <div
              className="grid size-8 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
              title={user?.email || (authBypass ? "Acesso direto" : "Conta")}
            >
              {initials}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8 lg:py-10">
          <Outlet />
        </main>

        <footer className="border-t border-border/60 px-4 py-6 pb-24 text-xs text-muted-foreground lg:px-8 lg:pb-6">
          AI FACTORY - Inteligencia operacional by{" "}
          <span className="text-foreground">ImplantaRH ConsultoriaPRO Ltda.</span>
        </footer>
      </div>
      <MobileBottomNav />
      <FactoryFab />
    </div>
  );
}
