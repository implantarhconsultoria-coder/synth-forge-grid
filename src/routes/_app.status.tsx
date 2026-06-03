import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ExternalLink } from "lucide-react";
import { useFactorySettings } from "@/lib/factory-settings";
import { resolveWorkerBase } from "@/lib/worker-endpoint";

export const Route = createFileRoute("/_app/status")({
  component: StatusPage,
});

function StatusPage() {
  const settings = useFactorySettings();
  const workerBase = resolveWorkerBase(settings.workerUrl, settings.workerPort);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 pb-28 lg:pb-10">
      <header className="flex items-center gap-3">
        <Activity className="size-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Status da AI Factory</h1>
          <p className="text-sm text-muted-foreground">
            Rota publica da plataforma. O status tecnico do worker fica no endpoint separado.
          </p>
        </div>
      </header>

      <section className="rounded-lg border border-border/50 bg-card/75 p-5">
        <div className="grid gap-3 text-sm">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-background/45 p-3">
            <span className="text-muted-foreground">Frontend</span>
            <span className="font-medium text-success">online</span>
          </div>
          <div className="rounded-md border border-border/40 bg-background/45 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Worker configurado</div>
            <a
              href={`${workerBase}/status`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-2 break-all text-primary hover:opacity-85"
            >
              {workerBase}/status
              <ExternalLink className="size-4 shrink-0" />
            </a>
          </div>
        </div>
      </section>

      <Link
        to="/"
        className="inline-flex items-center rounded-md border border-border/60 px-3 py-2 text-sm hover:bg-foreground/5"
      >
        Voltar ao painel
      </Link>
    </div>
  );
}
