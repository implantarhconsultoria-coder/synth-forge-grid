import { useEffect, useRef } from "react";
import { notify } from "@/lib/notifications";
import { workerBaseFromSettings } from "@/lib/worker-endpoint";

type QueueTask = {
  id?: string;
  status?: string;
  title?: string;
  projectName?: string;
};

function statusKey(task: QueueTask) {
  return String(task.status || "unknown").toLowerCase();
}

function titleOf(task: QueueTask) {
  const base = task.title || task.projectName || "Missao";
  return base.length > 80 ? `${base.slice(0, 77)}...` : base;
}

export function useWorkerQueueNotifications() {
  const cacheRef = useRef<Record<string, string>>({});
  const initializedRef = useRef(false);

  useEffect(() => {
    let canceled = false;

    async function sync() {
      try {
        const response = await fetch(`${workerBaseFromSettings()}/fila`, { cache: "no-store" });
        if (!response.ok) return;
        const items = (await response.json()) as QueueTask[];
        if (!Array.isArray(items)) return;
        if (canceled) return;

        const next: Record<string, string> = {};
        for (const task of items) {
          if (!task.id) continue;
          const status = statusKey(task);
          next[task.id] = status;

          const prev = cacheRef.current[task.id];
          if (!initializedRef.current || prev === status) continue;

          if (status === "awaiting_approval") {
            void notify({
              kind: "approval_needed",
              title: "Autorizacao necessaria",
              body: titleOf(task),
            });
          } else if (status === "processing") {
            void notify({
              kind: "mission_started",
              title: "Missao iniciada",
              body: titleOf(task),
            });
          } else if (status === "done") {
            void notify({
              kind: "mission_completed",
              title: "Missao concluida",
              body: titleOf(task),
            });
          } else if (status === "error") {
            void notify({
              kind: "critical_error",
              title: "Falha na missao",
              body: titleOf(task),
            });
          }
        }

        cacheRef.current = next;
        initializedRef.current = true;
      } catch {
        // best effort
      }
    }

    void sync();
    const id = window.setInterval(() => {
      void sync();
    }, 10_000);

    return () => {
      canceled = true;
      window.clearInterval(id);
    };
  }, []);
}
