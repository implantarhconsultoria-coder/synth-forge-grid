import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Activity, ChevronDown, Clipboard, ExternalLink, MessageCircle } from "lucide-react";
import { useFactoryData, factoryData, type SmartLog } from "@/lib/factory-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/logs")({
  component: LogsPage,
});

type FilterKey = "all" | "alert" | "info" | "ok";

const levelBadge: Record<string, string> = {
  ok: "bg-success/15 text-success border-success/30",
  warn: "bg-warning/15 text-warning border-warning/30",
  info: "bg-primary/15 text-primary border-primary/30",
  error: "bg-destructive/15 text-destructive border-destructive/30",
};

const statusLabel: Record<string, string> = {
  completed: "concluido",
  running: "em execucao",
  failed: "com erro",
  rejected: "bloqueado",
  cancelled: "bloqueado",
  pending: "pendente",
  needs_approval: "aguardando aprovacao",
};

const PAGE = 40;

function valueOrDash(value?: string | null) {
  const text = String(value || "").trim();
  return text || "nao informado";
}

function normalizePush(value: SmartLog["push"]) {
  if (value === true) return "sim";
  if (value === false) return "nao";
  return valueOrDash(value == null ? "nao" : String(value));
}

function logProject(log: SmartLog) {
  if (log.projectName) return log.projectName;
  if (log.projectId) return factoryData.getProject(log.projectId)?.name || log.projectId;
  return "AI Factory";
}

function logTitle(log: SmartLog) {
  const action = log.action || log.message || "Log registrado";
  const project = logProject(log);
  return `${action} - ${project}`;
}

function logStatus(log: SmartLog) {
  const raw = valueOrDash(log.status);
  return statusLabel[raw] || raw;
}

function logResult(log: SmartLog) {
  return valueOrDash(log.result || log.summary || log.message);
}

function logBlocker(log: SmartLog) {
  const blocker = valueOrDash(log.blocker);
  return blocker === "nao informado" ? "nenhum" : blocker;
}

function reportHref(log: SmartLog) {
  if (log.reportUrl) return log.reportUrl.startsWith("/") ? log.reportUrl : log.reportUrl;
  if (log.reportId) return `/reports?report=${encodeURIComponent(log.reportId)}`;
  return "";
}

function readableSummary(log: SmartLog) {
  return [
    logTitle(log),
    "",
    `Projeto: ${logProject(log)}`,
    `Repositorio: ${valueOrDash(log.repository)}`,
    `Status: ${logStatus(log)}`,
    `Acao: ${valueOrDash(log.action || log.message)}`,
    `Feito: ${logResult(log)}`,
    `Commit: ${valueOrDash(log.commit || "nao")}`,
    `Push: ${normalizePush(log.push)}`,
    `Bloqueios: ${logBlocker(log)}`,
    reportHref(log) ? `Relatorio: ${reportHref(log)}` : "Relatorio: nao informado",
  ].join("\n");
}

function whatsappUrl(log: SmartLog) {
  return `https://wa.me/?text=${encodeURIComponent(readableSummary(log))}`;
}

function technicalDetails(log: SmartLog) {
  return JSON.stringify(
    {
      id: log.id,
      createdAt: log.createdAt,
      level: log.level,
      type: log.type,
      source: log.source,
      message: log.message,
      projectId: log.projectId,
      projectName: log.projectName,
      missionName: log.missionName,
      repository: log.repository,
      status: log.status,
      action: log.action,
      result: log.result,
      commit: log.commit,
      push: log.push,
      blocker: log.blocker,
      reportId: log.reportId,
      reportUrl: log.reportUrl,
      metadataDetails: log.metadataDetails,
    },
    null,
    2,
  );
}

async function copySummary(log: SmartLog) {
  await navigator.clipboard.writeText(readableSummary(log));
  toast.success("Resumo do log copiado.");
}

function LogsPage() {
  useFactoryData();
  const all = factoryData.getLogs();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [limit, setLimit] = useState(PAGE);

  const counts = useMemo(() => {
    let alert = 0;
    let info = 0;
    let ok = 0;
    for (const log of all) {
      if (log.level === "error" || log.level === "warn") alert++;
      else if (log.level === "info") info++;
      else if (log.level === "ok") ok++;
    }
    return { all: all.length, alert, info, ok };
  }, [all]);

  const filtered = useMemo(() => {
    if (filter === "all") return all;
    if (filter === "alert") return all.filter((log) => log.level === "error" || log.level === "warn");
    return all.filter((log) => log.level === filter);
  }, [all, filter]);

  const visible = filtered.slice(0, limit);
  const filters: { key: FilterKey; label: string; count: number; cls: string }[] = [
    { key: "all", label: "Todos", count: counts.all, cls: "border-border/60 text-foreground" },
    { key: "alert", label: "Erros/Avisos", count: counts.alert, cls: "border-destructive/40 text-destructive" },
    { key: "info", label: "Informacoes", count: counts.info, cls: "border-primary/40 text-primary" },
    { key: "ok", label: "Sucessos", count: counts.ok, cls: "border-success/40 text-success" },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-28 lg:pb-10">
      <header className="flex items-center gap-3">
        <Activity className="size-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Logs operacionais</h1>
          <p className="text-sm text-muted-foreground">
            Eventos legiveis com missao, projeto, resultado, commit, push e relatorio.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {filters.map((item) => {
          const active = filter === item.key;
          return (
            <button
              key={item.key}
              onClick={() => {
                setFilter(item.key);
                setLimit(PAGE);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-all hover:bg-foreground/5",
                active ? `${item.cls} bg-foreground/5 shadow-[0_0_12px_-4px_currentColor]` : "border-border/40 text-muted-foreground",
              )}
            >
              {item.label} <span className="opacity-70">({item.count})</span>
            </button>
          );
        })}
      </div>

      <section className="space-y-3">
        {visible.length === 0 && (
          <div className="rounded-lg border border-border/50 bg-card/70 p-8 text-center text-sm text-muted-foreground">
            Nenhum log para este filtro.
          </div>
        )}

        {visible.map((log) => {
          const href = reportHref(log);
          return (
            <article key={log.id} className="rounded-lg border border-border/50 bg-card/75 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide", levelBadge[log.level])}>
                      {log.level}
                    </span>
                    {log.source === "mock" && (
                      <span className="rounded border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-warning">
                        Log de teste/simulacao
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </div>

                  <h2 className="mt-3 text-lg font-semibold">{logTitle(log)}</h2>
                  <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                    <LogLine label="Projeto" value={logProject(log)} />
                    <LogLine label="Status" value={logStatus(log)} />
                    <LogLine label="Repositorio" value={valueOrDash(log.repository)} />
                    <LogLine label="Acao" value={valueOrDash(log.action || log.message)} />
                    <LogLine label="Feito" value={logResult(log)} wide />
                    <LogLine label="Commit" value={valueOrDash(log.commit || "nao")} />
                    <LogLine label="Push" value={normalizePush(log.push)} />
                    <LogLine label="Bloqueios" value={logBlocker(log)} wide />
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  {href ? (
                    href.startsWith("/") ? (
                      <Link
                        to="/reports"
                        search={log.reportId ? { report: log.reportId } : undefined}
                        className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm hover:bg-foreground/5"
                      >
                        <ExternalLink className="size-4" />
                        Ver relatorio
                      </Link>
                    ) : (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm hover:bg-foreground/5"
                      >
                        <ExternalLink className="size-4" />
                        Ver relatorio
                      </a>
                    )
                  ) : null}
                  <button
                    onClick={() => void copySummary(log)}
                    className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm hover:bg-foreground/5"
                  >
                    <Clipboard className="size-4" />
                    Copiar resumo
                  </button>
                  <a
                    href={whatsappUrl(log)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-md border border-success/50 px-3 py-2 text-sm text-success hover:bg-success/5"
                  >
                    <MessageCircle className="size-4" />
                    WhatsApp
                  </a>
                </div>
              </div>

              <details className="mt-4 rounded-md border border-border/40 bg-background/45">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground">
                  Ver detalhes tecnicos
                  <ChevronDown className="size-4" />
                </summary>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-border/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
                  {technicalDetails(log)}
                </pre>
              </details>
            </article>
          );
        })}
      </section>

      {filtered.length > limit && (
        <div className="flex justify-center">
          <button
            onClick={() => setLimit((current) => current + PAGE)}
            className="rounded-full border border-border/40 px-4 py-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            Carregar mais ({filtered.length - limit} restantes)
          </button>
        </div>
      )}
    </div>
  );
}

function LogLine({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn("rounded-md border border-border/40 bg-background/45 p-2", wide && "md:col-span-2")}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm text-foreground">{value}</div>
    </div>
  );
}
