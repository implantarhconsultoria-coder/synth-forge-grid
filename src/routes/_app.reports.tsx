import { createFileRoute, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  MessageCircle,
  RefreshCcw,
  Search,
  Send,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { useFactorySettings } from "@/lib/factory-settings";
import { resolveWorkerBase } from "@/lib/worker-endpoint";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
});

type MissionReport = {
  id: string;
  taskId?: string | null;
  createdAt?: string;
  status?: string;
  project?: string;
  repository?: string;
  branch?: string;
  mission?: string;
  missionCommand?: string;
  commit?: string;
  commits?: string[];
  push?: string;
  deploy?: string;
  feito?: string[];
  rodando_agora?: string[];
  pendente?: string[];
  bloqueios?: string[];
  arquivos_alterados?: string[];
  proximos_passos?: string[];
  reportUrl?: string;
  text?: string;
};

type FactoryNotification = {
  id: string;
  reportId: string;
  createdAt?: string;
  read?: boolean;
  title?: string;
  project?: string;
  status?: string;
  summary?: string;
};

function formatDate(value?: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function list(items?: string[]) {
  return Array.isArray(items) && items.length > 0 ? items : ["nao informado"];
}

function statusTone(status = "") {
  const value = status.toLowerCase();
  if (["completed", "ok", "done"].includes(value)) return "border-success/40 text-success";
  if (["failed", "error", "blocked", "cancelled", "rejected"].includes(value)) {
    return "border-destructive/40 text-destructive";
  }
  return "border-warning/40 text-warning";
}

function summaryFor(report: MissionReport) {
  return list(report.feito).slice(0, 2).join("; ");
}

function whatsappUrl(report: MissionReport) {
  const text = [
    "AI Factory - Missao Finalizada",
    `Projeto: ${report.project || "nao informado"}`,
    `Status: ${report.status || "nao informado"}`,
    `Resumo: ${summaryFor(report)}`,
    `Commit: ${report.commit || "nao"}`,
    `Proximo passo: ${list(report.proximos_passos)[0]}`,
    `Relatorio: ${report.reportUrl || `/reports?report=${report.id}`}`,
  ].join("\n");
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function ReportsPage() {
  const settings = useFactorySettings();
  const reportFromUrl = useRouterState({
    select: (state) =>
      typeof state.location.search === "object"
        ? String((state.location.search as Record<string, unknown>).report || "")
        : "",
  });
  const workerBase = useMemo(
    () => resolveWorkerBase(settings.workerUrl, settings.workerPort),
    [settings.workerPort, settings.workerUrl],
  );
  const [reports, setReports] = useState<MissionReport[]>([]);
  const [notifications, setNotifications] = useState<FactoryNotification[]>([]);
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(reportFromUrl || null);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    setLoading(true);
    try {
      const [reportsResponse, notificationsResponse] = await Promise.all([
        fetch(`${workerBase}/relatorios`, { cache: "no-store" }),
        fetch(`${workerBase}/notificacoes`, { cache: "no-store" }),
      ]);
      if (!reportsResponse.ok) throw new Error(`Relatorios ${reportsResponse.status}`);
      const nextReports = (await reportsResponse.json()) as MissionReport[];
      const nextNotifications = notificationsResponse.ok
        ? ((await notificationsResponse.json()) as FactoryNotification[])
        : [];
      setReports(Array.isArray(nextReports) ? nextReports : []);
      setNotifications(Array.isArray(nextNotifications) ? nextNotifications : []);
      setSelectedId((current) => current || reportFromUrl || nextReports?.[0]?.id || null);
    } catch (error) {
      toast.error("Nao foi possivel carregar a Central de Relatorios.");
      console.error("[reports] load error:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, [reportFromUrl, workerBase]);

  useEffect(() => {
    if (reportFromUrl) setSelectedId(reportFromUrl);
  }, [reportFromUrl]);

  const projects = useMemo(() => {
    return Array.from(new Set(reports.map((item) => item.project || "nao informado"))).sort();
  }, [reports]);

  const statuses = useMemo(() => {
    return Array.from(new Set(reports.map((item) => item.status || "unknown"))).sort();
  }, [reports]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return reports.filter((report) => {
      const matchesSearch =
        !term ||
        JSON.stringify([report.mission, report.project, report.repository, report.status])
          .toLowerCase()
          .includes(term);
      const matchesProject = project === "all" || report.project === project;
      const matchesStatus = status === "all" || report.status === status;
      return matchesSearch && matchesProject && matchesStatus;
    });
  }, [project, reports, search, status]);

  const selected = filtered.find((item) => item.id === selectedId) || filtered[0] || reports[0];
  const unread = notifications.filter((item) => !item.read).length;

  async function copySummary(report: MissionReport) {
    const text = report.text || summaryFor(report);
    await navigator.clipboard.writeText(text);
    toast.success("Resumo copiado.");
  }

  async function shareReport(report: MissionReport) {
    const text = report.text || summaryFor(report);
    if (navigator.share) {
      await navigator.share({ title: "AI Factory - Relatorio", text });
    } else {
      await navigator.clipboard.writeText(text);
      toast.success("Compartilhamento indisponivel; texto copiado.");
    }
  }

  async function markRead(notificationId: string, reportId: string) {
    await fetch(`${workerBase}/notificacoes/${encodeURIComponent(notificationId)}/lida`, {
      method: "POST",
    });
    setSelectedId(reportId);
    await loadAll();
  }

  return (
    <div className="space-y-6 pb-28 lg:pb-10">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-primary">
            <FileText className="size-4" />
            Central de Relatorios
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Missoes finalizadas com rastro completo
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Historico, filtros, PDF e notificacoes internas para auditar cada entrega da AI Factory.
          </p>
        </div>
        <button
          onClick={() => void loadAll()}
          className="inline-flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <RefreshCcw className="size-4" />
          Atualizar
        </button>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="Relatorios" value={String(reports.length)} />
        <Metric label="Nao lidas" value={String(unread)} tone="warning" />
        <Metric label="Projetos" value={String(projects.length)} />
        <Metric label="Worker" value={loading ? "sincronizando" : "online"} tone="success" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-3">
          <div className="rounded-lg border border-border/50 bg-card/70 p-3">
            <div className="grid gap-2">
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full rounded-md border border-border/50 bg-background/70 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
                  placeholder="Buscar por missao"
                />
              </label>
              <select
                value={project}
                onChange={(event) => setProject(event.target.value)}
                className="rounded-md border border-border/50 bg-background/70 px-3 py-2 text-sm"
              >
                <option value="all">Todos os projetos</option>
                {projects.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="rounded-md border border-border/50 bg-background/70 px-3 py-2 text-sm"
              >
                <option value="all">Todos os status</option>
                {statuses.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
            {filtered.map((report) => (
              <button
                key={report.id}
                onClick={() => setSelectedId(report.id)}
                className={`w-full rounded-lg border p-3 text-left transition hover:border-primary/60 ${
                  selected?.id === report.id
                    ? "border-primary/70 bg-primary/10"
                    : "border-border/45 bg-card/60"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {report.mission || "Missao sem titulo"}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {report.project || "Projeto nao informado"}
                    </div>
                  </div>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${statusTone(report.status)}`}>
                    {report.status || "unknown"}
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {formatDate(report.createdAt)}
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="rounded-lg border border-border/50 bg-card/60 p-6 text-center text-sm text-muted-foreground">
                Nenhum relatorio encontrado.
              </div>
            )}
          </div>
        </aside>

        <main className="min-w-0 rounded-lg border border-border/50 bg-card/70">
          {selected ? (
            <ReportDetail report={selected} workerBase={workerBase} onCopy={copySummary} onShare={shareReport} />
          ) : (
            <div className="p-10 text-center text-muted-foreground">
              Nenhum relatorio disponivel ainda.
            </div>
          )}
        </main>
      </section>

      <section className="rounded-lg border border-border/50 bg-card/70 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Bell className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Sininho de notificacoes</h2>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {notifications.slice(0, 8).map((item) => (
            <button
              key={item.id}
              onClick={() => void markRead(item.id, item.reportId)}
              className={`rounded-lg border p-3 text-left ${
                item.read ? "border-border/40 bg-background/40" : "border-primary/50 bg-primary/10"
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-sm font-medium">
                <span>{item.project || "AI Factory"}</span>
                {!item.read && <span className="size-2 rounded-full bg-primary" />}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{item.summary}</div>
            </button>
          ))}
          {notifications.length === 0 && (
            <div className="text-sm text-muted-foreground">Nenhuma notificacao interna.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  const color = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-lg border border-border/50 bg-card/70 p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function ReportDetail({
  report,
  workerBase,
  onCopy,
  onShare,
}: {
  report: MissionReport;
  workerBase: string;
  onCopy: (report: MissionReport) => Promise<void>;
  onShare: (report: MissionReport) => Promise<void>;
}) {
  return (
    <article className="space-y-5 p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className={`inline-flex rounded border px-2 py-1 text-xs ${statusTone(report.status)}`}>
            {report.status || "unknown"}
          </div>
          <h2 className="mt-3 text-2xl font-bold">{report.mission || "Relatorio de missao"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{formatDate(report.createdAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`${workerBase}/relatorio/${encodeURIComponent(report.id)}/pdf`}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
          >
            <Download className="size-4" />
            Baixar PDF
          </a>
          <button
            onClick={() => void onCopy(report)}
            className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
          >
            <Copy className="size-4" />
            Copiar resumo
          </button>
          <button
            onClick={() => void onShare(report)}
            className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
          >
            <Share2 className="size-4" />
            Compartilhar
          </button>
          <a
            href={whatsappUrl(report)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-success/50 px-3 py-2 text-sm text-success"
          >
            <MessageCircle className="size-4" />
            WhatsApp
          </a>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Info label="Projeto" value={report.project} />
        <Info label="Repositorio" value={report.repository} />
        <Info label="Branch" value={report.branch} />
        <Info label="Commit" value={report.commit} />
        <Info label="Push" value={report.push} />
        <Info label="Deploy" value={report.deploy} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ListBlock title="O que foi feito" items={report.feito} icon={<CheckCircle2 className="size-4" />} />
        <ListBlock title="O que esta rodando" items={report.rodando_agora} />
        <ListBlock title="O que ficou pendente" items={report.pendente} />
        <ListBlock title="Bloqueios encontrados" items={report.bloqueios} />
        <ListBlock title="Arquivos alterados" items={report.arquivos_alterados} />
        <ListBlock title="Proximos passos" items={report.proximos_passos} icon={<Send className="size-4" />} />
      </div>

      <div className="rounded-lg border border-border/50 bg-background/50 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <ExternalLink className="size-4 text-primary" />
          Link do relatorio
        </div>
        <code className="break-all text-xs text-muted-foreground">{report.reportUrl || `/reports?report=${report.id}`}</code>
      </div>
    </article>
  );
}

function Info({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium">{value || "nao informado"}</div>
    </div>
  );
}

function ListBlock({ title, items, icon }: { title: string; items?: string[]; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/50 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <ol className="space-y-2 text-sm text-muted-foreground">
        {list(items).map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-2">
            <span className="text-primary">{index + 1}.</span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
