import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_app/relatorio/$reportId")({
  component: ReportRedirectPage,
});

function ReportRedirectPage() {
  const { reportId } = useParams({ from: "/_app/relatorio/$reportId" });

  useEffect(() => {
    window.location.replace(`/reports?report=${encodeURIComponent(reportId)}`);
  }, [reportId]);

  return (
    <div className="rounded-lg border border-border/50 bg-card/70 p-8 text-center">
      <h1 className="text-xl font-semibold">Abrindo relatório</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Redirecionando para a Central de Relatórios da AI Factory.
      </p>
    </div>
  );
}
