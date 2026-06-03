import { Link, useRouterState } from "@tanstack/react-router";
import { Rocket, ListChecks, FileText, FolderKanban, Settings } from "lucide-react";

const ITEMS = [
  { to: "/", label: "Missao", icon: Rocket, primary: true },
  { to: "/projects", label: "Projetos", icon: FolderKanban },
  { to: "/queue", label: "Fila", icon: ListChecks },
  { to: "/reports", label: "Relatorios", icon: FileText },
  { to: "/settings", label: "Config", icon: Settings },
] as const;

export function MobileBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 px-2 pb-2 pt-2 lg:hidden">
      <div className="grid grid-cols-5 gap-1 rounded-2xl border border-border/60 bg-background/90 px-1 py-1.5 shadow-[0_-6px_24px_rgba(2,8,23,0.26)] backdrop-blur-lg">
        {ITEMS.map((it) => {
          const Icon = it.icon;
          const active = pathname === it.to;
          if ("primary" in it && it.primary) {
            return (
              <Link
                key={it.to}
                to={it.to}
                className="flex flex-col items-center justify-center -mt-5"
              >
                <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-primary to-accent shadow-[0_8px_24px_rgba(56,189,248,0.4)]">
                  <Icon className="size-5 text-primary-foreground" />
                </span>
                <span className="mt-1 text-[10px] font-semibold tracking-wide text-foreground">
                  {it.label}
                </span>
              </Link>
            );
          }
          return (
            <Link
              key={it.to}
              to={it.to}
              className={`flex flex-col items-center justify-center rounded-xl py-1.5 text-[10px] font-medium transition ${
                active ? "bg-primary/10 text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className={`mb-0.5 size-5 ${active ? "text-primary" : ""}`} />
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
