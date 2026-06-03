import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage } from "./_app.reports";

export const Route = createFileRoute("/_app/notifications")({
  component: ReportsPage,
});
