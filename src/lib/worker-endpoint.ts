import { getSettings } from "@/lib/factory-settings";

const DEFAULT_WORKER_URL = "https://stunning-train-r7ggp5447rj93ppw6-8787.app.github.dev";

function withPort(base: string, port: number) {
  const noSlash = base.replace(/\/+$/, "");
  const hasPort = /:\d+(\/|$)/.test(noSlash.replace(/^https?:\/\//, ""));
  return hasPort ? noSlash : `${noSlash}:${port}`;
}

export function resolveWorkerBase(workerUrl: string, workerPort: number) {
  if (typeof window === "undefined") return DEFAULT_WORKER_URL;

  const fromSettings = workerUrl.trim();
  if (fromSettings) return withPort(fromSettings, workerPort);

  const origin = window.location.origin;
  if (origin.includes("-8081.app.github.dev"))
    return origin.replace("-8081.app.github.dev", "-8787.app.github.dev");
  if (origin.includes("-8080.app.github.dev"))
    return origin.replace("-8080.app.github.dev", "-8787.app.github.dev");
  if (origin.includes("127.0.0.1")) return "http://127.0.0.1:8787";
  if (origin.includes("localhost")) return "http://localhost:8787";

  const legacy = localStorage.getItem("ai_factory_worker_url");
  if (legacy) return legacy.replace(/\/+$/, "");
  return DEFAULT_WORKER_URL;
}

export function workerBaseFromSettings() {
  const settings = getSettings();
  return resolveWorkerBase(settings.workerUrl, settings.workerPort);
}
