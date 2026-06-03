import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/missao")({
  component: MissionAliasPage,
});

function MissionAliasPage() {
  return (
    <div className="rounded-lg border border-border/50 bg-card/70 p-8 text-center">
      <h1 className="text-xl font-semibold">Central da missão</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        A criação de missões fica no Command Center da AI Factory.
      </p>
      <Link
        to="/"
        className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
      >
        Abrir Command Center
      </Link>
    </div>
  );
}
