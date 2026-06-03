import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const PORT = Number(process.env.FACTORY_PORT || 8787);
const POLL_MS = Number(process.env.FACTORY_POLL_MS || 4000);
const AUTOPILOT_MIN_INTERVAL_MS = 30_000;
const AUTOPILOT_DEFAULT_INTERVAL_MS = 120_000;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "factory-data");
const OUTPUT_DIR = path.join(ROOT, "factory-output");
const GENERATED_PROJECTS_DIR = path.join(OUTPUT_DIR, "generated-projects");
const DOCTOR_REPORTS_DIR = path.join(OUTPUT_DIR, "doctor-reports");
const EXECUTION_EVIDENCE_DIR = path.join(OUTPUT_DIR, "execution-evidence");

const QUEUE_FILE = path.join(DATA_DIR, "execution-queue.json");
const LOG_FILE = path.join(DATA_DIR, "execution-logs.json");
const PROJECTS_FILE = path.join(DATA_DIR, "connected-projects.json");
const AUTOPILOT_FILE = path.join(DATA_DIR, "autopilot.json");
const PUSH_SUBSCRIPTIONS_FILE = path.join(DATA_DIR, "push-subscriptions.json");
const VAPID_FILE = path.join(DATA_DIR, "vapid-keys.json");
const REPORTS_FILE = path.join(DATA_DIR, "factory-reports.json");

function loadEnvFile(filePath, { override = false } = {}) {
  if (!fsSync.existsSync(filePath)) return;
  const raw = fsSync.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] && !override) continue;
    const value = rawValue.trim().replace(/^['"]|['"]$/g, "");
    process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, ".env"));
loadEnvFile(path.join(ROOT, "factory-worker", ".env"), { override: true });

const SENSITIVE_PATTERNS = [
  /delete/i,
  /drop\s+table/i,
  /permission/i,
  /permiss[aã]o/i,
  /auth/i,
  /login/i,
  /token/i,
  /secret/i,
  /pagamento/i,
  /payment/i,
  /financeir/i,
  /calculo/i,
  /c[aá]lculo/i,
  /regra\s+comercial/i,
  /exclus[aã]o\s+de\s+dados/i,
  /rm\s+-rf/i,
  /del\s+\/f/i,
  /truncate/i,
  /drop\s+database/i,
];

const DANGEROUS_COMMAND_PATTERNS = [
  /rm\s+-rf/i,
  /del\s+\/s/i,
  /format\s+[a-z]:/i,
  /mkfs/i,
  /shutdown/i,
  /reboot/i,
  /halt/i,
];

const DEFAULT_AUTOPILOT_STATE = {
  enabled: false,
  autoFix: true,
  intervalMs: AUTOPILOT_DEFAULT_INTERVAL_MS,
  mode: "doctor",
  maxQueueSize: 20,
  lastTickAt: null,
  lastSeedAt: null,
  lastError: null,
};

const DEFAULT_PROJECTS = [
  {
    id: "topac",
    name: "App dos Mecanicos (TOPAC)",
    repository: "implantarhconsultoria-coder/rh-prospera-hub-70cb89a5",
    workspacePath: "",
    objective: "Auditar ponto, jornada e estabilidade da experiencia mobile.",
    enabled: true,
    tags: ["ponto", "mobile", "operacao"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "nexus-lead-ia",
    name: "NEXUS LEAD IA",
    repository: "implantarhconsultoria-coder/synth-forge-grid",
    workspacePath: "",
    objective: "Melhorar fluxo de leads, automacoes e telemetria operacional.",
    enabled: true,
    tags: ["crm", "automacao"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "doctor-pro",
    name: "AI Factory / Doctor PRO",
    repository: "implantarhconsultoria-coder/synth-forge-grid",
    workspacePath: "",
    objective: "Operar consultorio inteligente com diagnostico e correcao guiada.",
    enabled: true,
    tags: ["factory", "doctor"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const env = {
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseKey:
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "",
  factoryWorkerSecret: process.env.FACTORY_WORKER_SECRET || "",
  openaiKey: process.env.OPENAI_API_KEY || "",
  githubToken: process.env.GITHUB_TOKEN || "",
  githubRepo: process.env.GITHUB_REPO || "",
  vapidPublicKey: process.env.FACTORY_VAPID_PUBLIC_KEY || "",
  vapidPrivateKey: process.env.FACTORY_VAPID_PRIVATE_KEY || "",
  vapidSubject: process.env.FACTORY_VAPID_SUBJECT || "mailto:suporte@implantarh.com",
};

function getMissingEnv() {
  const missing = [];
  if (!process.env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_KEY) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY");
  }
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!process.env.GITHUB_TOKEN) missing.push("GITHUB_TOKEN");
  if (!process.env.GITHUB_REPO) missing.push("GITHUB_REPO");
  return missing;
}

const supabase =
  env.supabaseUrl && env.supabaseKey
    ? createClient(env.supabaseUrl, env.supabaseKey, {
        global: {
          headers: env.factoryWorkerSecret
            ? { "x-ai-factory-worker": env.factoryWorkerSecret }
            : {},
        },
      })
    : null;
let pushKeys = {
  publicKey: env.vapidPublicKey || "",
  privateKey: env.vapidPrivateKey || "",
  source: env.vapidPublicKey && env.vapidPrivateKey ? "env" : "auto",
};
const pushConfigured = Boolean(pushKeys.publicKey && pushKeys.privateKey);
let pushReady = false;
if (pushConfigured) {
  try {
    webpush.setVapidDetails(env.vapidSubject, pushKeys.publicKey, pushKeys.privateKey);
    pushReady = true;
  } catch (error) {
    console.error("Falha ao carregar VAPID:", error);
    pushReady = false;
  }
}

let processing = false;
let autopilotTimer = null;
let autopilotState = { ...DEFAULT_AUTOPILOT_STATE };
let openaiRuntimeState = {
  configured: Boolean(env.openaiKey),
  ready: false,
  lastCheckedAt: null,
  lastStatus: null,
  lastError: env.openaiKey ? "aguardando validacao real" : "missing OPENAI_API_KEY",
};
const packageScriptsCache = new Map();

function clampAutopilotInterval(ms) {
  if (!Number.isFinite(ms)) return AUTOPILOT_DEFAULT_INTERVAL_MS;
  return Math.max(AUTOPILOT_MIN_INTERVAL_MS, Math.floor(ms));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeTaskStatus(status = "") {
  const value = String(status || "")
    .trim()
    .toLowerCase();
  if (["awaiting_approval", "needs_approval"].includes(value)) return "needs_approval";
  if (["processing", "running", "in_progress"].includes(value)) return "running";
  if (["done", "completed", "resolved", "ok"].includes(value)) return "completed";
  if (["error", "failed", "failure"].includes(value)) return "failed";
  if (["rejected", "cancelled", "canceled", "paused", "pending"].includes(value)) return value;
  if (value === "queued" || value === "open") return "pending";
  return value || "pending";
}

function isActiveStatus(status = "") {
  return ["pending", "running", "needs_approval"].includes(normalizeTaskStatus(status));
}

function isPendingStatus(status = "") {
  return normalizeTaskStatus(status) === "pending";
}

function isApprovalStatus(status = "") {
  return normalizeTaskStatus(status) === "needs_approval";
}

function isRunningStatus(status = "") {
  return normalizeTaskStatus(status) === "running";
}

function isFailedStatus(status = "") {
  return normalizeTaskStatus(status) === "failed";
}

function slugify(value) {
  return (
    String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 80) || "project"
  );
}

function buildTaskTitle(task) {
  if (task.title && String(task.title).trim()) return String(task.title).trim();
  if (task.command && String(task.command).trim()) return String(task.command).trim().slice(0, 180);
  if (task.type && task.projectName) return `${task.type}:${task.projectName}`;
  if (task.type) return String(task.type);
  return "factory-task";
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

async function loadOrCreateVapidKeys() {
  if (pushKeys.publicKey && pushKeys.privateKey) return pushKeys;

  const stored = await readJson(VAPID_FILE, null);
  if (stored?.publicKey && stored?.privateKey) {
    pushKeys = { publicKey: stored.publicKey, privateKey: stored.privateKey, source: "file" };
  } else {
    const generated = webpush.generateVAPIDKeys();
    pushKeys = { publicKey: generated.publicKey, privateKey: generated.privateKey, source: "auto" };
    await writeJson(VAPID_FILE, pushKeys);
  }

  try {
    webpush.setVapidDetails(env.vapidSubject, pushKeys.publicKey, pushKeys.privateKey);
    pushReady = true;
  } catch (error) {
    pushReady = false;
    console.error("Falha ao configurar VAPID:", error);
  }

  return pushKeys;
}

async function ensureFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(GENERATED_PROJECTS_DIR, { recursive: true });
  await fs.mkdir(DOCTOR_REPORTS_DIR, { recursive: true });
  await fs.mkdir(EXECUTION_EVIDENCE_DIR, { recursive: true });

  const seeds = [
    [QUEUE_FILE, []],
    [LOG_FILE, []],
    [PROJECTS_FILE, DEFAULT_PROJECTS],
    [AUTOPILOT_FILE, DEFAULT_AUTOPILOT_STATE],
    [PUSH_SUBSCRIPTIONS_FILE, []],
    [REPORTS_FILE, []],
  ];

  for (const [file, seed] of seeds) {
    try {
      await fs.access(file);
    } catch {
      await writeJson(file, seed);
    }
  }
}

async function recoverInterruptedTasks() {
  const queue = await readJson(QUEUE_FILE, []);
  if (!Array.isArray(queue)) return;
  let changed = false;
  const recoveredAt = nowIso();
  const normalized = queue.map((task) => {
    const nextStatus = normalizeTaskStatus(task.status);
    const patch = { ...task, status: nextStatus };
    if (nextStatus === "running") {
      patch.status = "pending";
      patch.recovered_at = recoveredAt;
      patch.recovery_reason = "worker reiniciado durante execucao";
    }
    if (patch.status !== task.status || patch.recovered_at !== task.recovered_at) changed = true;
    return patch;
  });

  if (!changed) return;
  await writeJson(QUEUE_FILE, normalized);
  await addLog("warn", "Fila recuperada apos restart", {
    recoveredAt,
    recovered: normalized.filter((task) => task.recovered_at === recoveredAt).length,
  });
}

function toDbStatus(status) {
  return normalizeTaskStatus(status);
}

function toQueueDbRow(task) {
  return {
    external_id: task.id,
    mission_id: task.missionId || task.mission_id || null,
    type: task.type || "generic",
    title: task.title || task.command || "Missao",
    action: task.requestedAction || task.action || task.command || task.type || "execute_mission",
    status: toDbStatus(task.status),
    priority: task.priority || "normal",
    project_name: task.projectName || null,
    project_root: task.projectRoot || task.workspacePath || null,
    repository_url: task.repositoryUrl || task.repository || null,
    branch: task.branch || task.payload?.branch || null,
    module: task.module || task.payload?.module || null,
    requested_action: task.requestedAction || task.command || task.title || null,
    requires_approval: Boolean(task.requires_approval),
    attempts: Number(task.attempts || 0),
    logs: task.logs || [],
    result: task.result || null,
    error: task.error || null,
    payload: task.payload || {},
    created_at: task.created_at || task.createdAt || nowIso(),
    started_at: task.started_at || task.startedAt || null,
    finished_at: task.finished_at || task.finishedAt || null,
    updated_at: nowIso(),
  };
}

function toMissionTaskDbRow(task) {
  return {
    id: task.id,
    mission_id: task.missionId || task.mission_id || task.id,
    execution_queue_external_id: task.id,
    title: task.title || task.command || "Missao",
    task_title: task.title || task.command || "Missao",
    task_type: task.type || "generic",
    status: toDbStatus(task.status),
    priority: task.priority || "normal",
    project_name: task.projectName || null,
    project_root: task.projectRoot || task.workspacePath || null,
    repository_url: task.repositoryUrl || task.repository || null,
    branch: task.branch || task.payload?.branch || null,
    module: task.module || task.payload?.module || null,
    requested_action: task.requestedAction || task.command || task.title || null,
    requires_approval: Boolean(task.requires_approval),
    result: task.result || null,
    logs: task.logs || [],
    payload: task.payload || {},
    created_at: task.created_at || task.createdAt || nowIso(),
    updated_at: nowIso(),
  };
}

async function persistTaskInsert(task) {
  if (!supabase) return;
  const results = await Promise.allSettled([
    supabase.from("ai_execution_queue").upsert(toQueueDbRow(task), { onConflict: "external_id" }),
    supabase.from("ai_mission_tasks").upsert(toMissionTaskDbRow(task), { onConflict: "id" }),
  ]);
  for (const result of results) {
    if (result.status === "fulfilled" && result.value?.error) {
      console.error("Supabase task insert failed:", result.value.error.message);
    } else if (result.status === "rejected") {
      console.error("Supabase task insert rejected:", result.reason);
    }
  }
}

async function persistTaskPatch(taskId, patch) {
  if (!supabase) return;
  const allowed = new Set([
    "status",
    "priority",
    "requires_approval",
    "attempts",
    "logs",
    "result",
    "error",
    "started_at",
    "finished_at",
    "updated_at",
  ]);
  const dbPatch = Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => allowed.has(key) && value !== undefined),
  );
  Object.assign(dbPatch, {
    status: patch.status ? toDbStatus(patch.status) : undefined,
    updated_at: nowIso(),
  });
  Object.keys(dbPatch).forEach((key) => dbPatch[key] === undefined && delete dbPatch[key]);
  const missionPatch = Object.fromEntries(
    Object.entries(dbPatch).filter(([key]) =>
      ["status", "result", "error", "logs", "updated_at"].includes(key),
    ),
  );
  const results = await Promise.allSettled([
    supabase.from("ai_execution_queue").update(dbPatch).eq("external_id", taskId),
    supabase
      .from("ai_mission_tasks")
      .update(missionPatch)
      .eq("execution_queue_external_id", taskId),
  ]);
  for (const result of results) {
    if (result.status === "fulfilled" && result.value?.error) {
      console.error("Supabase task update failed:", result.value.error.message);
    } else if (result.status === "rejected") {
      console.error("Supabase task update rejected:", result.reason);
    }
  }
}

async function getDatabaseHealth() {
  if (!supabase) {
    return {
      connected: false,
      ready: false,
      reason: "SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes",
      tables: {},
    };
  }

  const tables = {};
  for (const table of ["ai_execution_queue", "ai_mission_tasks", "smart_logs"]) {
    const { error } = await supabase.from(table).select("id").limit(1);
    tables[table] = error ? { ok: false, error: error.message || String(error) } : { ok: true };
  }

  const ready = Object.values(tables).every((item) => item.ok);
  return {
    connected: true,
    ready,
    reason: ready
      ? null
      : "pendente de integracao real: aplique supabase/ai_factory_real_execution_schema.sql",
    tables,
  };
}

async function addLog(level, message, extra = {}) {
  const logs = await readJson(LOG_FILE, []);
  const log = {
    id: crypto.randomUUID(),
    createdAt: nowIso(),
    level,
    message,
    ...extra,
  };
  logs.unshift(log);
  await writeJson(LOG_FILE, logs.slice(0, 1500));

  if (supabase) {
    await Promise.allSettled([
      supabase.from("smart_logs").insert({
        level,
        message,
        module: "factory-worker",
        project_id: extra.projectId || null,
        project_name: extra.projectName || null,
        meta: extra,
      }),
      supabase.from("ai_execution_logs").insert({
        id: log.id,
        task_id: extra.taskId || null,
        execution_queue_external_id: extra.taskId || null,
        level,
        message,
        project_name: extra.projectName || null,
        payload: extra,
        created_at: log.createdAt,
      }),
    ]);
  }
}

function listFrom(value, fallback = ["nao informado"]) {
  if (Array.isArray(value)) {
    const clean = value.map((item) => String(item || "").trim()).filter(Boolean);
    return clean.length > 0 ? clean : fallback;
  }
  if (value) return [String(value)];
  return fallback;
}

function getCodexOperationalStatus() {
  const explicit = String(process.env.CODEX_STATUS || "").trim().toLowerCase();
  const allowed = new Set(["not_connected", "connected", "manual_bridge", "unknown"]);
  const status = allowed.has(explicit)
    ? explicit
    : process.env.CODEX_CONNECTED === "true" || process.env.CODEX_API_URL
      ? "connected"
      : "manual_bridge";
  const connected = status === "connected";
  const manualBridge = status === "manual_bridge";
  return {
    codex_status: status,
    connected,
    connectedLabel: connected ? "SIM" : "NAO",
    mode: connected ? "connected" : manualBridge ? "manual_bridge" : status,
    sendsMission: connected
      ? "Factory envia missao para a integracao Codex configurada."
      : "Factory gera missao estruturada para execucao manual pelo Codex.",
    receivesReturn: connected
      ? "Factory espera retorno da integracao Codex e registra resultado na fila."
      : "Codex executa no ambiente compartilhado e a Factory registra o retorno no relatorio final.",
    recordsCommitPush:
      "Commit, push e deploy sao gravados no relatorio final quando informados pelo executor ou detectados no resultado.",
  };
}

function extractChangedFiles(task = {}, result = {}) {
  const values = [
    ...(Array.isArray(result.changedFiles) ? result.changedFiles : []),
    ...(Array.isArray(result.writtenFiles) ? result.writtenFiles : []),
    ...(Array.isArray(result.applied) ? result.applied : []),
    ...(Array.isArray(result.execution?.writtenFiles) ? result.execution.writtenFiles : []),
    ...(Array.isArray(task.changedFiles) ? task.changedFiles : []),
    ...(Array.isArray(task.payload?.changedFiles) ? task.payload.changedFiles : []),
  ];
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function buildMissionReport(task, { status, result = null, error = null } = {}) {
  const codex = getCodexOperationalStatus();
  const payload = task?.payload && typeof task.payload === "object" ? task.payload : {};
  const reportResult = result && typeof result === "object" ? result : {};
  const commit = reportResult.commit || payload.commit || task.commit || null;
  const push =
    reportResult.push ??
    payload.push ??
    task.push ??
    (commit ? "nao informado" : "nao");
  const deploy =
    reportResult.deploy ??
    payload.deploy ??
    task.deploy ??
    "nao";
  const changedFiles = extractChangedFiles(task, reportResult);
  const blocked = error
    ? [String(error)]
    : listFrom(reportResult.blockers || payload.blockers, ["nenhum bloqueio informado"]);
  const runningNow = reportResult.awaitingCodex
    ? ["aguardando Codex"]
    : listFrom(reportResult.runningNow || payload.runningNow, ["nada em execucao informado"]);

  const report = {
    id: crypto.randomUUID(),
    taskId: task?.id || null,
    createdAt: nowIso(),
    title: "RELATÓRIO FINAL DA MISSÃO",
    status: status || normalizeTaskStatus(task?.status),
    project: task?.projectName || task?.projectId || payload.projectName || "nao informado",
    repository:
      task?.repository ||
      task?.repositoryUrl ||
      payload.repository ||
      payload.repositoryUrl ||
      env.githubRepo ||
      "nao informado",
    branch: task?.branch || payload.branch || process.env.GITHUB_REF_NAME || "nao informado",
    codex_connected: codex.connectedLabel,
    codex_status: codex.codex_status,
    codex_mode: codex.mode,
    codex: {
      connected: codex.connected,
      status: codex.codex_status,
      mode: codex.mode,
      sendsMission: codex.sendsMission,
      receivesReturn: codex.receivesReturn,
      recordsCommitPush: codex.recordsCommitPush,
      executed: reportResult.codexExecuted || payload.codexExecuted || "nao informado",
    },
    commit: commit || "nao",
    push,
    deploy,
    feito: listFrom(reportResult.done || payload.done, [
      error ? "missao nao concluida" : "missao executada pela Factory",
    ]),
    rodando_agora: runningNow,
    bloqueios: blocked,
    arquivos_alterados: changedFiles.length > 0 ? changedFiles : ["nenhum arquivo informado"],
    proximos_passos: listFrom(reportResult.nextSteps || payload.nextSteps, [
      error ? "corrigir bloqueio informado" : "aguardar nova missao ou validacao humana",
    ]),
    observacoes: listFrom(reportResult.notes || payload.notes, [
      codex.connected
        ? "Codex conectado conforme status operacional."
        : "Execucao Codex em modo manual_bridge.",
    ]),
  };
  report.text = formatMissionReportText(report);
  return report;
}

function numberedList(items = []) {
  return listFrom(items).map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function formatMissionReportText(report) {
  return `RELATÓRIO FINAL DA MISSÃO

Status:
${report.status}
Projeto:
${report.project}
Repositório:
${report.repository}
Branch:
${report.branch}
Codex conectado:
${report.codex_connected}
Commit:
${report.commit}
Push:
${report.push}
Deploy:
${report.deploy}

Feito:
${numberedList(report.feito)}

Rodando agora:
${numberedList(report.rodando_agora)}

Bloqueios:
${numberedList(report.bloqueios)}

Arquivos alterados:
${numberedList(report.arquivos_alterados)}

Próximos passos:
${numberedList(report.proximos_passos)}

Observações:
${numberedList(report.observacoes)}`;
}

async function saveMissionReport(report) {
  const reports = await readJson(REPORTS_FILE, []);
  const nextReports = Array.isArray(reports) ? reports : [];
  nextReports.unshift(report);
  await writeJson(REPORTS_FILE, nextReports.slice(0, 500));
  await addLog("info", "Relatorio final da missao registrado", {
    taskId: report.taskId,
    reportId: report.id,
    codex_status: report.codex_status,
    status: report.status,
  });
  if (supabase) {
    await Promise.allSettled([
      supabase.from("smart_logs").insert({
        level: "info",
        message: "Relatorio final da missao",
        module: "factory-worker",
        project_name: report.project,
        meta: report,
      }),
    ]);
  }
  return report;
}

function withCorsHeaders(headers = {}) {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    ...headers,
  };
}

function json(res, status, payload) {
  res.writeHead(status, withCorsHeaders());
  res.end(JSON.stringify(payload));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function wantsJson(req, url) {
  if (url.searchParams.get("format") === "json") return true;
  return false;
}

function html(res, status, body) {
  res.writeHead(
    status,
    withCorsHeaders({
      "Content-Type": "text/html; charset=utf-8",
    }),
  );
  res.end(body);
}

function formatStatusDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR");
}

function statusClass(status = "") {
  const value = normalizeTaskStatus(status);
  if (["completed", "online", "active"].includes(value)) return "ok";
  if (["pending", "running", "needs_approval", "paused"].includes(value)) return "warn";
  if (["failed", "rejected", "cancelled", "offline"].includes(value)) return "bad";
  return "";
}

function taskSummary(task = {}) {
  return {
    id: task.id || "-",
    title: task.title || task.command || task.type || "Tarefa sem titulo",
    projectName: task.projectName || task.projectId || "Projeto nao identificado",
    status: task.status || "-",
    priority: task.priority || "-",
    type: task.type || "-",
    createdAt: task.created_at || task.createdAt || "-",
    attempts: task.attempts ?? 0,
    error: task.error || task.result?.error || task.meta?.error || "",
  };
}

function statusHtml(payload, details = {}) {
  const queue = Array.isArray(details.queue) ? details.queue : [];
  const logs = Array.isArray(details.logs) ? details.logs : [];
  const projects = Array.isArray(details.projects) ? details.projects : [];
  const activeTasks = queue
    .filter((task) => isActiveStatus(task.status) || isFailedStatus(task.status))
    .slice(0, 18)
    .map(taskSummary);
  const approvalTasks = queue
    .filter((task) => isApprovalStatus(task.status))
    .slice(0, 8)
    .map(taskSummary);
  const recentLogs = logs.slice(0, 18);

  const rows = [
    ["Worker", payload.online ? "ONLINE" : "OFFLINE"],
    ["Processando", payload.processing ? "sim" : "nao"],
    ["Pendentes", payload.counts.queuePending],
    ["Aguardando aprovacao", payload.counts.queueAwaitingApproval],
    ["Em processamento", payload.counts.queueProcessing],
    ["Falhadas", payload.counts.queueFailed],
    ["Projetos ativos", `${payload.counts.projectsEnabled}/${payload.counts.projectsTotal}`],
    ["Autopilot", payload.autopilot.enabled ? "ativo" : "inativo"],
    ["Modo", payload.autopilot.mode],
    ["Auto fix", payload.autopilot.autoFix ? "ativo" : "inativo"],
    ["Intervalo", `${payload.autopilot.intervalMs} ms`],
    ["Ultimo tick", payload.autopilot.lastTickAt || "-"],
    ["Ultimo erro", payload.autopilot.lastError || "nenhum"],
    ["Supabase", payload.integrations.supabase ? "conectado" : "desligado"],
    [
      "OpenAI",
      payload.integrations.openaiReady
        ? "pronto"
        : payload.integrations.openaiConfigured
          ? payload.integrations.openaiLastStatus === 401
            ? "chave invalida"
            : "pendente de validacao real"
          : "desligado",
    ],
    ["GitHub", payload.integrations.github ? "conectado" : "desligado"],
  ];

  const nav = [
    ["Dashboard", "/"],
    ["JSON status", "/status?format=json"],
    ["Fila JSON", "/fila"],
    ["Logs JSON", "/logs"],
    ["Projetos JSON", "/projects"],
    [
      payload.autopilot.enabled ? "Parar autopilot" : "Iniciar autopilot",
      payload.autopilot.enabled ? "/autopilot/stop" : "/autopilot/start",
    ],
  ];

  const capabilities = Object.entries(payload.capabilities)
    .map(
      ([key, enabled]) =>
        `<span class="pill ${enabled ? "ok" : "bad"}">${escapeHtml(key)}: ${
          enabled ? "on" : "off"
        }</span>`,
    )
    .join("");

  const taskActionsHtml = (task) => {
    const status = normalizeTaskStatus(task.status);
    const actions = [
      `<button class="mini" type="button" data-detail="${escapeHtml(task.id)}" data-mode="logs">logs</button>`,
      `<button class="mini" type="button" data-detail="${escapeHtml(task.id)}" data-mode="diagnostico">diagnostico</button>`,
      `<button class="mini" type="button" data-detail="${escapeHtml(task.id)}" data-mode="arquivos">arquivos</button>`,
    ];
    if (status === "needs_approval") {
      actions.push(
        `<button class="mini ok" type="button" data-post="/fila/${escapeHtml(task.id)}/aprovar">aprovar</button>`,
      );
      actions.push(
        `<button class="mini bad" type="button" data-post="/fila/${escapeHtml(task.id)}/rejeitar">rejeitar</button>`,
      );
    }
    if (["pending", "running"].includes(status)) {
      actions.push(
        `<button class="mini bad" type="button" data-post="/fila/${escapeHtml(task.id)}/cancelar">cancelar</button>`,
      );
    }
    if (["failed", "rejected", "cancelled"].includes(status)) {
      actions.push(
        `<button class="mini warn" type="button" data-post="/fila/${escapeHtml(task.id)}/reenviar">reenviar</button>`,
      );
    }
    return actions.join("");
  };

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI Factory Console</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, Segoe UI, Arial, sans-serif; background: #0b0f14; color: #e6edf3; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #0b0f14; }
    main { max-width: 1360px; margin: 0 auto; padding: 22px 18px 44px; }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    h1 { margin: 0; font-size: 26px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 17px; letter-spacing: 0; }
    a { color: #7dd3fc; text-decoration: none; }
    nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 20px; }
    nav a { border: 1px solid #30363d; border-radius: 6px; padding: 9px 11px; background: #121821; color: #dbeafe; }
    .badge { padding: 8px 12px; border-radius: 6px; font-weight: 700; background: #12351f; color: #86efac; border: 1px solid #1f7a3b; }
    .badge.bad { background: #3b1114; color: #fca5a5; border-color: #7f1d1d; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(178px, 1fr)); gap: 10px; }
    .layout { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(330px, 0.8fr); gap: 14px; align-items: start; }
    .item, .panel { border: 1px solid #30363d; border-radius: 8px; background: #121821; }
    .item { padding: 13px; }
    .panel { padding: 14px; }
    .label { color: #8b949e; font-size: 12px; text-transform: uppercase; margin-bottom: 8px; }
    .value { font-size: 17px; font-weight: 650; overflow-wrap: anywhere; }
    .section { margin-top: 14px; }
    .pills { display: flex; flex-wrap: wrap; gap: 8px; }
    .pill { border: 1px solid #30363d; border-radius: 999px; padding: 7px 10px; background: #161b22; font-size: 13px; }
    button.pill { color: inherit; cursor: pointer; font: inherit; }
    button, input, textarea, select { font: inherit; }
    button { cursor: pointer; border: 1px solid #30363d; border-radius: 6px; padding: 9px 11px; background: #182233; color: #e6edf3; }
    button:hover { border-color: #58a6ff; }
    button.ok, .mini.ok { border-color: #1f7a3b; color: #86efac; }
    button.warn, .mini.warn { border-color: #8a5a00; color: #fde68a; }
    button.bad, .mini.bad { border-color: #7f1d1d; color: #fca5a5; }
    .mini { padding: 6px 8px; font-size: 12px; background: #0d1117; }
    input, textarea, select { width: 100%; border: 1px solid #30363d; border-radius: 6px; padding: 10px; background: #0d1117; color: #e6edf3; }
    textarea { min-height: 96px; resize: vertical; }
    .form-grid { display: grid; grid-template-columns: minmax(180px, 0.8fr) minmax(180px, 0.8fr) minmax(180px, 0.8fr); gap: 10px; }
    .field { display: grid; gap: 6px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .pill.ok { border-color: #1f7a3b; color: #86efac; }
    .pill.warn { border-color: #8a5a00; color: #fde68a; }
    .pill.bad { border-color: #7f1d1d; color: #fca5a5; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border-bottom: 1px solid #26303b; padding: 10px 8px; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
    th { color: #8b949e; font-size: 12px; text-transform: uppercase; font-weight: 650; }
    td { font-size: 13px; }
    .status { display: inline-block; border: 1px solid #30363d; border-radius: 999px; padding: 4px 8px; font-weight: 700; font-size: 12px; }
    .status.ok { border-color: #1f7a3b; color: #86efac; }
    .status.warn { border-color: #8a5a00; color: #fde68a; }
    .status.bad { border-color: #7f1d1d; color: #fca5a5; }
    .muted { color: #8b949e; }
    .log { border-bottom: 1px solid #26303b; padding: 10px 0; }
    .log:last-child { border-bottom: 0; }
    .log-title { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
    .project-list { display: grid; gap: 10px; }
    .project { border: 1px solid #26303b; border-radius: 8px; padding: 10px; background: #0d1117; }
    #operation-output { min-height: 92px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid #30363d; border-radius: 8px; padding: 14px; background: #010409; color: #c9d1d9; max-height: 360px; overflow: auto; }
    @media (max-width: 920px) { .layout, .form-grid { grid-template-columns: 1fr; } header { flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>AI Factory / Doctor PRO</h1>
        <div class="muted">Console operacional do worker em tempo real</div>
      </div>
      <div class="badge ${payload.online ? "" : "bad"}">${payload.online ? "ONLINE" : "OFFLINE"}</div>
    </header>
    <nav>
      ${nav.map(([label, href]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`).join("")}
    </nav>
    <section class="grid">
      ${rows
        .map(
          ([label, value]) =>
            `<div class="item"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`,
        )
        .join("")}
    </section>
    <section class="panel section">
      <h2>Operacao real</h2>
      <div class="form-grid">
        <label class="field">
          <span class="label">Tipo</span>
          <select id="mission-type">
            <option value="project_audit">Doctor audit</option>
            <option value="project_fix">Doctor fix</option>
            <option value="project_bootstrap">Criar projeto</option>
            <option value="ai_diagnostic">Diagnostico OpenAI</option>
          </select>
        </label>
        <label class="field">
          <span class="label">Projeto</span>
          <select id="mission-project">
            ${projects
              .map(
                (project) =>
                  `<option value="${escapeHtml(project.name || project.id)}">${escapeHtml(project.name || project.id)}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="field">
          <span class="label">Prioridade</span>
          <select id="mission-priority">
            <option value="normal">normal</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
        </label>
      </div>
      <div class="section field">
        <span class="label">Missao</span>
        <textarea id="mission-command" placeholder="Descreva a missao real para o worker processar."></textarea>
      </div>
      <div class="actions section">
        <button class="ok" type="button" id="create-mission">criar missao</button>
        <button type="button" data-post="/doctor/run">rodar doctor agora</button>
        <button type="button" data-post="/autopilot/start">iniciar autopilot</button>
        <button class="warn" type="button" data-post="/autopilot/stop">pausar autopilot</button>
        <button type="button" id="refresh-page">atualizar status</button>
      </div>
      <pre id="operation-output">Aguardando acao real.</pre>
    </section>
    <div class="layout section">
      <section class="panel">
        <h2>Fila ativa e problemas</h2>
        <table>
          <thead><tr><th style="width: 25%">Tarefa</th><th style="width: 16%">Projeto</th><th style="width: 12%">Status</th><th style="width: 10%">Prioridade</th><th style="width: 14%">Criada</th><th style="width: 13%">Acoes</th><th>Erro</th></tr></thead>
          <tbody>
            ${
              activeTasks.length
                ? activeTasks
                    .map(
                      (task) => `<tr>
                        <td>${escapeHtml(task.title)}<div class="muted">${escapeHtml(task.type)} / tentativas ${escapeHtml(task.attempts)}</div></td>
                        <td>${escapeHtml(task.projectName)}</td>
                        <td><span class="status ${statusClass(task.status)}">${escapeHtml(task.status)}</span></td>
                        <td>${escapeHtml(task.priority)}</td>
                        <td>${escapeHtml(formatStatusDate(task.createdAt))}</td>
                        <td><div class="actions">${taskActionsHtml(task)}</div></td>
                        <td>${escapeHtml(task.error || "-")}</td>
                      </tr>`,
                    )
                    .join("")
                : `<tr><td colspan="7" class="muted">Nenhuma tarefa pendente, processando, aguardando aprovacao ou com erro.</td></tr>`
            }
          </tbody>
        </table>
      </section>
      <aside class="panel">
        <h2>Aprovacoes pendentes</h2>
        ${
          approvalTasks.length
            ? approvalTasks
                .map(
                  (task) => `<div class="project">
                    <strong>${escapeHtml(task.title)}</strong>
                    <div class="muted">${escapeHtml(task.projectName)} · ${escapeHtml(formatStatusDate(task.createdAt))}</div>
                    <div class="pills" style="margin-top: 8px;">
                      <span class="pill warn">${escapeHtml(task.priority)}</span>
                      <form method="post" action="/fila/${escapeHtml(task.id)}/aprovar"><button class="pill ok" type="submit">aprovar</button></form>
                      <form method="post" action="/fila/${escapeHtml(task.id)}/rejeitar"><button class="pill bad" type="submit">rejeitar</button></form>
                    </div>
                  </div>`,
                )
                .join("")
            : `<div class="muted">Nada aguardando aprovacao agora.</div>`
        }
        <div class="section">
          <h2>Projetos</h2>
          <div class="project-list">
            ${projects
              .map(
                (project) => `<div class="project">
                  <strong>${escapeHtml(project.name || project.id)}</strong>
                  <div class="muted">${escapeHtml(project.repository || "-")}</div>
                  <div class="muted">${escapeHtml(project.workspacePath || "workspacePath nao configurado")}</div>
                  <div class="pills" style="margin-top: 8px;">
                    <span class="pill ${project.enabled === false ? "bad" : "ok"}">${project.enabled === false ? "off" : "on"}</span>
                    ${(project.tags || []).map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("")}
                  </div>
                </div>`,
              )
              .join("")}
          </div>
        </div>
      </aside>
    </div>
    <section class="panel section">
      <h2>Logs recentes</h2>
      ${
        recentLogs.length
          ? recentLogs
              .map(
                (log) => `<div class="log">
                  <div class="log-title"><strong>${escapeHtml(log.message || "-")}</strong><span class="status ${statusClass(log.level)}">${escapeHtml(log.level || "log")}</span></div>
                  <div class="muted">${escapeHtml(formatStatusDate(log.createdAt || log.created_at))}</div>
                  <div>${escapeHtml(JSON.stringify(log, null, 2))}</div>
                </div>`,
              )
              .join("")
          : `<div class="muted">Sem logs recentes.</div>`
      }
    </section>
    <section class="panel section">
      <h2>Capacidades</h2>
      <div class="pills">${capabilities}</div>
    </section>
    <section class="panel section">
      <h2>Snapshot JSON</h2>
      <p><a href="/status?format=json">Abrir resposta JSON pura</a></p>
      <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
    </section>
  </main>
  <script>
    const output = document.getElementById("operation-output");
    function writeOutput(value) {
      output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    }
    async function api(path, options = {}) {
      const response = await fetch(path, {
        cache: "no-store",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });
      const text = await response.text();
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: text };
      }
      if (!response.ok) throw new Error(payload.error || response.statusText || response.status);
      return payload;
    }
    document.getElementById("refresh-page")?.addEventListener("click", () => location.reload());
    document.getElementById("create-mission")?.addEventListener("click", async () => {
      try {
        const type = document.getElementById("mission-type").value;
        const projectName = document.getElementById("mission-project").value || "AI Factory / Doctor PRO";
        const priority = document.getElementById("mission-priority").value;
        const command = document.getElementById("mission-command").value.trim();
        const payload = await api("/fila", {
          method: "POST",
          body: JSON.stringify({
            type,
            projectName,
            priority,
            command,
            title: command ? command.slice(0, 140) : type + ": " + projectName,
            payload: { requestedAction: type, createdFrom: "worker-console" },
          }),
        });
        writeOutput(payload);
        setTimeout(() => location.reload(), 1200);
      } catch (error) {
        writeOutput(String(error));
      }
    });
    document.querySelectorAll("[data-post]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const payload = await api(button.dataset.post, { method: "POST", body: "{}" });
          writeOutput(payload);
          setTimeout(() => location.reload(), 1200);
        } catch (error) {
          writeOutput(String(error));
        }
      });
    });
    document.querySelectorAll("[data-detail]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const taskId = button.dataset.detail;
          const mode = button.dataset.mode;
          const path = mode === "logs" ? "/fila/" + taskId : "/fila/" + taskId + "/" + mode;
          writeOutput(await api(path));
        } catch (error) {
          writeOutput(String(error));
        }
      });
    });
  </script>
</body>
</html>`;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function normalizePushSubscriptionInput(raw = {}) {
  const subscription =
    raw.subscription && typeof raw.subscription === "object" ? raw.subscription : {};
  const keys = subscription.keys && typeof subscription.keys === "object" ? subscription.keys : {};
  const endpoint = String(subscription.endpoint || "").trim();
  if (!endpoint) return null;

  return {
    id: crypto.randomUUID(),
    endpoint,
    subscription: {
      endpoint,
      expirationTime: subscription.expirationTime || null,
      keys: {
        p256dh: String(keys.p256dh || ""),
        auth: String(keys.auth || ""),
      },
    },
    userId: raw.userId ? String(raw.userId) : null,
    platform: raw.platform ? String(raw.platform) : "",
    userAgent: raw.userAgent ? String(raw.userAgent) : "",
    locale: raw.locale ? String(raw.locale) : "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

async function loadPushSubscriptions() {
  const list = await readJson(PUSH_SUBSCRIPTIONS_FILE, []);
  return Array.isArray(list) ? list : [];
}

async function savePushSubscriptions(subscriptions) {
  await writeJson(PUSH_SUBSCRIPTIONS_FILE, subscriptions);
}

async function upsertPushSubscription(payload) {
  const next = normalizePushSubscriptionInput(payload);
  if (!next) throw new Error("subscription invalida");

  const all = await loadPushSubscriptions();
  const index = all.findIndex((item) => item.endpoint === next.endpoint);
  if (index >= 0) {
    all[index] = {
      ...all[index],
      ...next,
      id: all[index].id || next.id,
      createdAt: all[index].createdAt || next.createdAt,
      updatedAt: nowIso(),
    };
  } else {
    all.unshift(next);
  }
  await savePushSubscriptions(all);
  return index >= 0 ? all[index] : next;
}

async function removePushSubscription(endpoint = "") {
  const safeEndpoint = String(endpoint || "").trim();
  if (!safeEndpoint) return { removed: 0 };

  const all = await loadPushSubscriptions();
  const filtered = all.filter((item) => item.endpoint !== safeEndpoint);
  const removed = all.length - filtered.length;
  if (removed > 0) await savePushSubscriptions(filtered);
  return { removed };
}

async function notifyPush(payload, options = {}) {
  if (!pushReady) {
    return { enabled: false, reason: "vapid_not_configured", sent: 0, failed: 0 };
  }

  const subscriptions = await loadPushSubscriptions();
  const targetUserId = options.userId ? String(options.userId) : null;
  const targets = targetUserId
    ? subscriptions.filter((item) => item.userId === targetUserId)
    : subscriptions;

  let sent = 0;
  let failed = 0;
  const staleEndpoints = [];

  for (const item of targets) {
    try {
      await webpush.sendNotification(item.subscription, JSON.stringify(payload));
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = Number(error?.statusCode || 0);
      if (statusCode === 404 || statusCode === 410) staleEndpoints.push(item.endpoint);
    }
  }

  if (staleEndpoints.length > 0) {
    const set = new Set(staleEndpoints);
    const fresh = subscriptions.filter((item) => !set.has(item.endpoint));
    await savePushSubscriptions(fresh);
  }

  return { enabled: true, sent, failed, totalTargets: targets.length };
}

function taskStatusMessage(status = "") {
  const key = String(status || "").toLowerCase();
  if (key === "awaiting_approval") return "Aguardando autorizacao";
  if (key === "pending") return "Na fila";
  if (key === "processing") return "Executando";
  if (key === "done") return "Concluida";
  if (key === "error") return "Falhou";
  if (key === "rejected") return "Rejeitada";
  return key || "Atualizada";
}

function buildTaskPush(task, status, patch = {}) {
  const title = status === "error" ? "Falha em missao" : `Missao ${taskStatusMessage(status)}`;
  const taskTitle = task.title || task.command || task.type || "Missao";
  const bodyParts = [taskTitle];
  if (task.projectName) bodyParts.push(task.projectName);
  if (patch.error) bodyParts.push(String(patch.error));

  return {
    title,
    body: bodyParts.join(" - ").slice(0, 240),
    tag: `task-${task.id}`,
    data: {
      taskId: task.id,
      status,
      projectName: task.projectName || null,
      type: task.type || null,
      timestamp: nowIso(),
    },
  };
}

function isSensitive(task) {
  const text = `${task.title || ""} ${task.command || ""} ${JSON.stringify(task.payload || {})}`;
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function taskTypeNeedsApproval(type = "") {
  return [
    "project_fix",
    "workspace_command",
    "workspace_patch",
    "seed_data",
    "project_seed_data",
  ].includes(String(type || "").toLowerCase());
}

function isDangerousCommand(command = "") {
  const value = String(command || "");
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(value));
}

function shouldRequireApproval(task, explicitFlag = null) {
  if (explicitFlag === true) return true;
  if (explicitFlag === false) return false;
  if (isSensitive(task)) return true;
  if (taskTypeNeedsApproval(task.type)) return true;
  if (isDangerousCommand(task.command)) return true;
  return false;
}

function normalizeTaskInput(rawTask = {}) {
  const payload = rawTask.payload && typeof rawTask.payload === "object" ? rawTask.payload : {};
  return {
    type: rawTask.type || "generic",
    title: buildTaskTitle(rawTask),
    command: rawTask.command || payload.command || "",
    projectId: rawTask.projectId || payload.projectId || null,
    projectName: rawTask.projectName || payload.projectName || null,
    projectRoot:
      rawTask.projectRoot ||
      rawTask.project_root ||
      payload.projectRoot ||
      payload.project_root ||
      null,
    repositoryUrl:
      rawTask.repositoryUrl ||
      rawTask.repository_url ||
      rawTask.repository ||
      payload.repositoryUrl ||
      payload.repository_url ||
      payload.repository ||
      null,
    repository:
      rawTask.repository ||
      rawTask.repositoryUrl ||
      rawTask.repository_url ||
      payload.repository ||
      payload.repositoryUrl ||
      payload.repository_url ||
      null,
    workspacePath:
      rawTask.workspacePath ||
      rawTask.projectRoot ||
      rawTask.project_root ||
      payload.workspacePath ||
      payload.projectRoot ||
      payload.project_root ||
      null,
    branch: rawTask.branch || payload.branch || null,
    module: rawTask.module || payload.module || null,
    requestedAction:
      rawTask.requestedAction ||
      rawTask.requested_action ||
      payload.requestedAction ||
      payload.requested_action ||
      rawTask.command ||
      payload.command ||
      rawTask.type ||
      "execute_mission",
    priority: rawTask.priority || "normal",
    payload,
    meta: rawTask.meta && typeof rawTask.meta === "object" ? rawTask.meta : {},
    githubIssueNumber: rawTask.githubIssueNumber || null,
    requiresApproval:
      rawTask.requiresApproval ??
      rawTask.requires_approval ??
      payload.requiresApproval ??
      payload.requires_approval ??
      null,
  };
}

async function queueTask(inputTask) {
  const queue = await readJson(QUEUE_FILE, []);
  const normalized = normalizeTaskInput(inputTask);
  const sensitive = shouldRequireApproval(normalized, normalized.requiresApproval);
  const queuedTask = {
    id: crypto.randomUUID(),
    created_at: nowIso(),
    status: sensitive ? "needs_approval" : "pending",
    requires_approval: sensitive,
    attempts: 0,
    logs: [],
    ...normalized,
  };

  delete queuedTask.requiresApproval;

  queue.push(queuedTask);
  await writeJson(QUEUE_FILE, queue);

  await persistTaskInsert(queuedTask);

  await addLog("info", "Tarefa enfileirada", {
    taskId: queuedTask.id,
    type: queuedTask.type,
    projectName: queuedTask.projectName,
    requiresApproval: sensitive,
  });

  void notifyPush(buildTaskPush(queuedTask, queuedTask.status)).catch(() => {});

  return queuedTask;
}

async function updateTaskStatus(taskId, patch) {
  const queue = await readJson(QUEUE_FILE, []);
  const taskIndex = queue.findIndex((task) => task.id === taskId);
  if (taskIndex === -1) return null;
  const previous = queue[taskIndex];
  queue[taskIndex] = { ...queue[taskIndex], ...patch };
  await writeJson(QUEUE_FILE, queue);

  await persistTaskPatch(taskId, patch);

  const next = queue[taskIndex];
  const prevStatus = String(previous?.status || "");
  const nextStatus = String(next?.status || "");
  if (prevStatus !== nextStatus) {
    const pushStatus = [
      "needs_approval",
      "running",
      "completed",
      "failed",
      "rejected",
      "cancelled",
    ];
    if (pushStatus.includes(normalizeTaskStatus(nextStatus))) {
      void notifyPush(buildTaskPush(next, nextStatus, patch)).catch(() => {});
    }
  }

  return queue[taskIndex];
}

async function approveTask(taskId) {
  const updatedTask = await updateTaskStatus(taskId, {
    status: "pending",
    approved_at: nowIso(),
    requires_approval: false,
  });
  if (updatedTask) await addLog("info", "Tarefa sensivel aprovada", { taskId });
  return updatedTask;
}

function normalizeCommandList(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => String(item || "").trim()).filter(Boolean);
}

function buildForceRecoveryCommands(sourceTask) {
  const steps = Array.isArray(sourceTask?.result?.execution?.steps)
    ? sourceTask.result.execution.steps
    : [];
  const failedSteps = steps.filter((step) => step && step.ok !== true);
  const selectedSteps = failedSteps.length > 0 ? failedSteps : steps;

  const commandsFromSteps = normalizeCommandList(selectedSteps.map((step) => step?.command));
  if (commandsFromSteps.length > 0) {
    return [...new Set(commandsFromSteps)].slice(0, 8);
  }

  const commandsFromPayload = normalizeCommandList(sourceTask?.payload?.commands);
  if (commandsFromPayload.length > 0) {
    return [...new Set(commandsFromPayload)].slice(0, 8);
  }

  return ["npm run lint", "npm run build", "npm run test"];
}

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function pickProjectForTask(projects, sourceTask) {
  if (!Array.isArray(projects) || !sourceTask) return null;
  if (sourceTask.projectId) {
    const byId = projects.find((project) => project.id === sourceTask.projectId);
    if (byId) return byId;
  }
  if (!sourceTask.projectName) return null;
  const targetName = normalizeText(sourceTask.projectName);
  const byExactName = projects.find((project) => normalizeText(project.name) === targetName);
  if (byExactName) return byExactName;
  return (
    projects.find((project) => normalizeText(project.name).includes(targetName)) ||
    projects.find((project) => targetName.includes(normalizeText(project.name))) ||
    null
  );
}

async function loadProjects() {
  const projects = await readJson(PROJECTS_FILE, []);
  return Array.isArray(projects) ? projects : [];
}

async function saveProjects(projects) {
  await writeJson(PROJECTS_FILE, projects);
}

async function loadAutopilotState() {
  const raw = await readJson(AUTOPILOT_FILE, DEFAULT_AUTOPILOT_STATE);
  autopilotState = {
    ...DEFAULT_AUTOPILOT_STATE,
    ...raw,
    intervalMs: clampAutopilotInterval(Number(raw.intervalMs || AUTOPILOT_DEFAULT_INTERVAL_MS)),
  };
  await writeJson(AUTOPILOT_FILE, autopilotState);
}

async function saveAutopilotState(patch = {}) {
  autopilotState = {
    ...autopilotState,
    ...patch,
    intervalMs: clampAutopilotInterval(
      Number((patch.intervalMs ?? autopilotState.intervalMs) || AUTOPILOT_DEFAULT_INTERVAL_MS),
    ),
  };
  await writeJson(AUTOPILOT_FILE, autopilotState);
  return autopilotState;
}

function hasPendingTaskForProject(queue, projectId) {
  return queue.some((task) => {
    if (!projectId || task.projectId !== projectId) return false;
    return isActiveStatus(task.status);
  });
}

async function enqueueDoctorAuditForProject(project, source = "autopilot") {
  const queuedTask = await queueTask({
    type: "project_audit",
    title: `Doctor audit: ${project.name}`,
    projectId: project.id,
    projectName: project.name,
    repository: project.repository || null,
    workspacePath: project.workspacePath || null,
    priority: "high",
    payload: {
      source,
      objective: project.objective || "",
      autoFix: Boolean(autopilotState.autoFix),
      project,
    },
  });
  return queuedTask;
}

async function runDoctorSeed(source = "manual") {
  const queue = await readJson(QUEUE_FILE, []);
  const projects = await loadProjects();
  const enabledProjects = projects.filter((project) => project.enabled !== false);
  let queued = 0;

  if (queue.filter((task) => isActiveStatus(task.status)).length >= autopilotState.maxQueueSize) {
    return { queued, reason: "queue_limit" };
  }

  for (const project of enabledProjects) {
    if (hasPendingTaskForProject(queue, project.id)) continue;
    await enqueueDoctorAuditForProject(project, source);
    queued += 1;
  }

  await saveAutopilotState({ lastSeedAt: nowIso(), lastError: null });
  await addLog("info", "Seed de auditoria concluido", {
    source,
    queued,
    enabledProjects: enabledProjects.length,
  });

  return { queued, enabledProjects: enabledProjects.length };
}

async function autopilotTick(source = "interval") {
  await saveAutopilotState({ lastTickAt: nowIso() });
  if (!autopilotState.enabled) return { skipped: true, reason: "disabled" };
  try {
    return await runDoctorSeed(source);
  } catch (error) {
    await saveAutopilotState({ lastError: String(error) });
    await addLog("error", "Falha no autopilot", { error: String(error) });
    return { skipped: true, reason: "error", error: String(error) };
  }
}

function restartAutopilotTimer() {
  if (autopilotTimer) {
    clearInterval(autopilotTimer);
    autopilotTimer = null;
  }

  if (!autopilotState.enabled) return;
  autopilotTimer = setInterval(() => {
    void autopilotTick("interval");
  }, autopilotState.intervalMs);
}

async function startAutopilot(intervalMs) {
  const nextState = await saveAutopilotState({
    enabled: true,
    intervalMs: intervalMs ?? autopilotState.intervalMs,
    lastError: null,
  });
  restartAutopilotTimer();
  await addLog("ok", "Autopilot iniciado", { intervalMs: nextState.intervalMs });
  await autopilotTick("start");
  return nextState;
}

async function stopAutopilot() {
  const nextState = await saveAutopilotState({ enabled: false });
  restartAutopilotTimer();
  await addLog("warn", "Autopilot pausado");
  return nextState;
}

async function resolveWorkspacePath(task) {
  const fromTask = task.workspacePath || task.payload?.workspacePath || "";
  if (!fromTask) return "";
  return path.resolve(String(fromTask));
}

function hasWorkspaceConfigured(project) {
  return Boolean(String(project?.workspacePath || "").trim());
}

function workspaceMissingErrorMessage(project) {
  return `workspacePath ausente para ${project?.name || "projeto"}. Configure antes da execucao real.`;
}

async function safeReadText(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

function isPathInside(basePath, targetPath) {
  const relative = path.relative(basePath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolvePathInsideWorkspace(workspacePath, candidatePath = ".") {
  const resolved = path.resolve(workspacePath, String(candidatePath || "."));
  if (!isPathInside(workspacePath, resolved)) {
    throw new Error(`Caminho fora do workspace bloqueado: ${candidatePath}`);
  }
  return resolved;
}

function normalizeCommandEntry(entry, index) {
  if (typeof entry === "string") {
    return {
      id: `step-${index + 1}`,
      label: `Comando ${index + 1}`,
      command: entry.trim(),
      cwd: ".",
      timeoutMs: 15 * 60_000,
    };
  }

  return {
    id: String(entry?.id || `step-${index + 1}`),
    label: String(entry?.label || `Comando ${index + 1}`),
    command: String(entry?.command || "").trim(),
    cwd: String(entry?.cwd || "."),
    timeoutMs: Number(entry?.timeoutMs || 15 * 60_000),
  };
}

function defaultProjectPipeline(snapshot) {
  const scripts = snapshot?.scripts || {};
  const steps = [];
  if (scripts.lint) steps.push("npm run lint");
  if (scripts.build) steps.push("npm run build");
  if (scripts.test) steps.push("npm run test");
  return steps;
}

function normalizeShellCommand(command = "") {
  const trimmed = String(command || "").trim();
  if (!trimmed) return "";

  const nodeBin = `"${process.execPath}"`;

  if (/^node(\s|$)/i.test(trimmed)) return trimmed.replace(/^node/i, nodeBin);
  return trimmed;
}

async function loadPackageScripts(cwd) {
  const safeCwd = path.resolve(String(cwd || process.cwd()));
  const packageJsonPath = path.join(safeCwd, "package.json");
  const cacheKey = packageJsonPath;
  const cached = packageScriptsCache.get(cacheKey);
  if (cached) return cached;

  const packageText = await safeReadText(packageJsonPath);
  if (!packageText) {
    packageScriptsCache.set(cacheKey, {});
    return {};
  }

  try {
    const parsed = JSON.parse(packageText);
    const scripts = parsed?.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
    packageScriptsCache.set(cacheKey, scripts);
    return scripts;
  } catch {
    packageScriptsCache.set(cacheKey, {});
    return {};
  }
}

function parsePackageManagerRunCommand(command = "") {
  const raw = String(command || "").trim();
  if (!raw) return null;

  const runMatch = raw.match(/^(npm|pnpm|yarn|bun)\s+run\s+([a-z0-9:_-]+)(?:\s+--\s*(.*))?$/i);
  if (runMatch) {
    return {
      script: runMatch[2],
      forwardedArgs: String(runMatch[3] || "").trim(),
    };
  }

  const aliasMatch = raw.match(/^(npm|pnpm|yarn|bun)\s+(test|start|build|lint)(?:\s+--\s*(.*))?$/i);
  if (aliasMatch) {
    return {
      script: aliasMatch[2],
      forwardedArgs: String(aliasMatch[3] || "").trim(),
    };
  }

  return null;
}

async function prepareCommandForExecution(command = "", cwd = ".", depth = 0) {
  const trimmed = String(command || "").trim();
  if (!trimmed) return "";
  if (depth > 3) return normalizeShellCommand(trimmed);

  const runScript = parsePackageManagerRunCommand(trimmed);
  if (runScript) {
    const scripts = await loadPackageScripts(cwd);
    const scriptBody = String(scripts?.[runScript.script] || "").trim();
    if (scriptBody) {
      const merged = runScript.forwardedArgs
        ? `${scriptBody} ${runScript.forwardedArgs}`
        : scriptBody;
      return prepareCommandForExecution(merged, cwd, depth + 1);
    }
  }

  return normalizeShellCommand(trimmed);
}

function truncateForPreview(text = "", max = 1600) {
  const value = String(text || "");
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated]`;
}

class CommandPlanFailedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "CommandPlanFailedError";
    this.step = details.step || null;
    this.execution = details.execution || null;
    this.failedStepIndex = Number.isFinite(details.failedStepIndex) ? details.failedStepIndex : -1;
  }
}

function clampAutoResolveAttempts(value, fallback = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(4, Math.floor(num)));
}

function hasScript(snapshot, scriptName) {
  return Boolean(snapshot?.scripts && snapshot.scripts[scriptName]);
}

function buildFailureDigest(error) {
  const parts = [String(error?.message || "")];
  if (error?.step) {
    parts.push(String(error.step.command || ""));
    parts.push(String(error.step.stdoutPreview || ""));
    parts.push(String(error.step.stderrPreview || ""));
  }
  const steps = Array.isArray(error?.execution?.steps) ? error.execution.steps : [];
  for (const step of steps) {
    if (!step || step.ok === true) continue;
    parts.push(String(step.command || ""));
    parts.push(String(step.stdoutPreview || ""));
    parts.push(String(step.stderrPreview || ""));
  }
  return normalizeText(parts.join("\n"));
}

function dedupeRepairCommands(items) {
  const list = Array.isArray(items) ? items : [];
  const seen = new Set();
  const output = [];
  for (const item of list) {
    const command = String(item?.command || "").trim();
    if (!command) continue;
    if (seen.has(command)) continue;
    seen.add(command);
    output.push({
      label: String(item?.label || "Autocorrecao"),
      command,
      timeoutMs: Number(item?.timeoutMs || 20 * 60_000),
    });
  }
  return output;
}

function buildAutonomousRepairCommands(snapshot, failureError) {
  const digest = buildFailureDigest(failureError);
  const failedCommand = normalizeText(failureError?.step?.command || "");
  const commands = [];

  const lintOrFormatFailure =
    /(eslint|prettier|lint|format|formatacao|formatting)/.test(digest) ||
    /(npm run lint|pnpm lint|yarn lint|bun lint)/.test(failedCommand);
  if (lintOrFormatFailure) {
    if (hasScript(snapshot, "lint")) {
      commands.push({
        label: "Autocorrecao lint --fix",
        command: "npm run lint -- --fix",
        timeoutMs: 20 * 60_000,
      });
    } else if (hasScript(snapshot, "format")) {
      commands.push({
        label: "Autocorrecao format",
        command: "npm run format",
        timeoutMs: 20 * 60_000,
      });
    }
  }

  const dependencyFailure =
    /(cannot find module|module not found|is not recognized as an internal|enoent|npm err! code e404|missing script)/.test(
      digest,
    );
  if (dependencyFailure) {
    commands.push({
      label: "Autocorrecao dependencias",
      command: "npm install",
      timeoutMs: 25 * 60_000,
    });
  }

  return dedupeRepairCommands(commands).slice(0, 3);
}

async function runShellCommand(command, cwd, timeoutMs = 15 * 60_000) {
  if (!command) {
    return {
      ok: false,
      command,
      cwd,
      exitCode: -1,
      stdout: "",
      stderr: "comando vazio",
      durationMs: 0,
      timedOut: false,
    };
  }

  const startedAt = Date.now();
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const localBin = path.join(cwd, "node_modules", ".bin");
    const nodeBin = path.dirname(process.execPath);
    const currentPath = String(process.env.PATH || process.env.Path || process.env.path || "");
    const mergedPath = [localBin, nodeBin, currentPath].filter(Boolean).join(path.delimiter);
    const envWithPath = {
      ...process.env,
      PATH: mergedPath,
      Path: mergedPath,
      path: mergedPath,
    };

    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: envWithPath,
    });

    const timeoutId = setTimeout(
      () => {
        timedOut = true;
        child.kill();
      },
      Math.max(1_000, timeoutMs),
    );

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      resolve({
        ok: false,
        command,
        cwd,
        exitCode: -1,
        stdout,
        stderr: `${stderr}\n${String(error)}`.trim(),
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeoutId);
      resolve({
        ok: !timedOut && code === 0,
        command,
        cwd,
        exitCode: Number.isFinite(code) ? code : -1,
        signal: signal || null,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });
  });
}

async function applySafeWorkspaceFixes(task, snapshot) {
  const workspacePath = snapshot.workspacePath;
  const applied = [];

  const envPath = path.join(workspacePath, ".env");
  const gitIgnorePath = path.join(workspacePath, ".gitignore");
  const envText = await safeReadText(envPath);
  if (envText) {
    const gitIgnoreText = await safeReadText(gitIgnorePath);
    const hasRule = /(^|\n)\.env(\n|$)/.test(gitIgnoreText);
    if (!hasRule) {
      const base = gitIgnoreText.trimEnd();
      const next = `${base ? `${base}\n` : ""}.env\n`;
      await fs.writeFile(gitIgnorePath, next, "utf8");
      applied.push({
        action: "protect_env",
        filePath: gitIgnorePath,
        note: ".env adicionado no .gitignore",
      });
    }
  }

  if (!snapshot.checks.some((check) => check.name === "README.md" && check.ok)) {
    const readmePath = path.join(workspacePath, "README.md");
    const content = [
      `# ${task.projectName || "Projeto"}`,
      "",
      "README criado automaticamente pelo AI Factory Doctor.",
      "",
      `Atualizado em: ${nowIso()}`,
      "",
    ].join("\n");
    await fs.writeFile(readmePath, content, "utf8");
    applied.push({
      action: "create_readme",
      filePath: readmePath,
      note: "README criado para onboarding basico",
    });
  }

  return applied;
}

async function applyTextReplacements(workspacePath, replacements = []) {
  const results = [];
  for (const item of replacements) {
    const filePath = String(item?.filePath || item?.path || "");
    const search = String(item?.search || "");
    const replace = String(item?.replace || "");
    const replaceAll = item?.replaceAll !== false;

    if (!filePath || !search) {
      results.push({
        filePath,
        changed: false,
        reason: "filePath/search obrigatorios",
      });
      continue;
    }

    let absolutePath = "";
    try {
      absolutePath = path.isAbsolute(filePath)
        ? path.resolve(filePath)
        : resolvePathInsideWorkspace(workspacePath, filePath);
      if (!isPathInside(workspacePath, absolutePath)) {
        throw new Error("fora do workspace");
      }
    } catch {
      results.push({
        filePath,
        changed: false,
        reason: "caminho bloqueado por seguranca",
      });
      continue;
    }

    const current = await safeReadText(absolutePath);
    if (!current) {
      results.push({
        filePath: absolutePath,
        changed: false,
        reason: "arquivo nao encontrado ou vazio",
      });
      continue;
    }

    const occurrences = current.split(search).length - 1;
    if (occurrences <= 0) {
      results.push({
        filePath: absolutePath,
        changed: false,
        reason: "texto de busca nao encontrado",
      });
      continue;
    }

    const next = replaceAll
      ? current.split(search).join(replace)
      : current.replace(search, replace);
    await fs.writeFile(absolutePath, next, "utf8");
    results.push({
      filePath: absolutePath,
      changed: true,
      occurrences,
    });
  }

  return results;
}

async function createExecutionEvidenceDir(task, prefix = "exec") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const folder = `${stamp}_${slugify(`${prefix}-${task.projectName || task.type || "task"}`)}`;
  const evidenceDir = path.join(EXECUTION_EVIDENCE_DIR, folder);
  await fs.mkdir(evidenceDir, { recursive: true });
  return evidenceDir;
}

async function runCommandPlan(task, workspacePath, commands, options = {}) {
  const continueOnError = Boolean(options.continueOnError);
  const evidenceDir =
    options.evidenceDir || (await createExecutionEvidenceDir(task, options.prefix || "commands"));
  const steps = [];
  const totalSteps = Array.isArray(commands) ? commands.length : 0;

  for (let i = 0; i < commands.length; i += 1) {
    const step = normalizeCommandEntry(commands[i], i);
    if (!step.command) continue;
    const cwd = resolvePathInsideWorkspace(workspacePath, step.cwd || ".");
    const preparedCommand = normalizeShellCommand(step.command);
    const preparedCommandResolved = await prepareCommandForExecution(preparedCommand, cwd);

    if (isDangerousCommand(preparedCommandResolved) && !options.allowDangerousCommands) {
      throw new Error(`Comando bloqueado por seguranca: ${preparedCommandResolved}`);
    }

    const startedAt = nowIso();
    const result = await runShellCommand(preparedCommandResolved, cwd, step.timeoutMs);
    const finishedAt = nowIso();
    const logPath = path.join(
      evidenceDir,
      `${String(i + 1).padStart(2, "0")}-${slugify(step.label)}.log`,
    );
    const content = [
      `command=${preparedCommand}`,
      `cwd=${cwd}`,
      `started_at=${startedAt}`,
      `ended_at=${finishedAt}`,
      `exit_code=${result.exitCode}`,
      `timed_out=${result.timedOut ? "true" : "false"}`,
      "",
      "stdout:",
      result.stdout || "",
      "",
      "stderr:",
      result.stderr || "",
      "",
    ].join("\n");
    await fs.writeFile(logPath, content, "utf8");

    const stepResult = {
      id: step.id,
      label: step.label,
      command: preparedCommandResolved,
      cwd,
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      startedAt,
      finishedAt,
      stdoutPreview: truncateForPreview(result.stdout),
      stderrPreview: truncateForPreview(result.stderr),
      logPath,
    };
    steps.push(stepResult);

    if (typeof options.onStep === "function") {
      await options.onStep({
        index: i + 1,
        total: totalSteps,
        step: stepResult,
      });
    }

    if (!result.ok && !continueOnError) {
      throw new CommandPlanFailedError(
        `Falha ao executar: ${preparedCommand} (exit ${result.exitCode})`,
        {
          step: stepResult,
          failedStepIndex: i,
          execution: {
            evidenceDir,
            steps: [...steps],
          },
        },
      );
    }
  }

  return {
    evidenceDir,
    steps,
  };
}

const ESTIMATION_RULES = [
  {
    id: "mobile_app",
    pattern: /(mobile|app|ios|android|pwa)/i,
    setupHours: 36,
    implantationBrl: 6500,
    monthlyBrl: 1300,
  },
  {
    id: "crm_sales",
    pattern: /(crm|lead|capta|prospec|pipeline|negoci)/i,
    setupHours: 28,
    implantationBrl: 5200,
    monthlyBrl: 1200,
  },
  {
    id: "whatsapp",
    pattern: /(whatsapp|wpp|mensag|chatbot|atendimento)/i,
    setupHours: 18,
    implantationBrl: 2800,
    monthlyBrl: 900,
  },
  {
    id: "finance",
    pattern: /(financeir|faturamento|conta|receber|pagar|dre|fluxo de caixa)/i,
    setupHours: 26,
    implantationBrl: 5000,
    monthlyBrl: 1100,
  },
  {
    id: "integrations",
    pattern: /(integra|api|erp|gateway|supabase|openai|twilio|n8n)/i,
    setupHours: 20,
    implantationBrl: 3500,
    monthlyBrl: 850,
  },
  {
    id: "automation_ai",
    pattern: /(autonom|ia|ai|factory|agente|orquestra)/i,
    setupHours: 22,
    implantationBrl: 4000,
    monthlyBrl: 1400,
  },
];

function roundToHundreds(value) {
  return Math.round(value / 100) * 100;
}

function estimateProjectBudget(input = {}) {
  const objective = String(input.objective || input.command || "").trim();
  const name = String(input.name || input.projectName || "Projeto").trim();
  const tags = Array.isArray(input.tags) ? input.tags.map((item) => String(item)) : [];
  const integrations = Array.isArray(input.integrations)
    ? input.integrations.map((item) => String(item))
    : [];
  const modules = Array.isArray(input.modules) ? input.modules.map((item) => String(item)) : [];

  const corpus = [name, objective, tags.join(" "), integrations.join(" "), modules.join(" ")]
    .join(" ")
    .trim();

  let setupHours = 22;
  let implantationBrl = 4200;
  let monthlyBrl = 950;
  const matchedRules = [];

  for (const rule of ESTIMATION_RULES) {
    if (!rule.pattern.test(corpus)) continue;
    setupHours += rule.setupHours;
    implantationBrl += rule.implantationBrl;
    monthlyBrl += rule.monthlyBrl;
    matchedRules.push(rule.id);
  }

  const integrationBonus = integrations.length * 380;
  const moduleBonus = Math.max(0, modules.length - 1) * 420;
  implantationBrl += integrationBonus + moduleBonus;
  monthlyBrl += integrations.length * 220 + Math.max(0, modules.length - 1) * 160;

  const complexityScore = Math.min(100, 20 + matchedRules.length * 14 + integrations.length * 6);
  const riskMultiplier = complexityScore >= 80 ? 1.22 : complexityScore >= 60 ? 1.12 : 1.06;

  const implantationCenter = roundToHundreds(implantationBrl * riskMultiplier);
  const monthlyCenter = roundToHundreds(monthlyBrl * riskMultiplier);

  const implantationMin = roundToHundreds(implantationCenter * 0.88);
  const implantationMax = roundToHundreds(implantationCenter * 1.2);
  const monthlyMin = roundToHundreds(monthlyCenter * 0.9);
  const monthlyMax = roundToHundreds(monthlyCenter * 1.25);

  const implementationWeeks = Math.max(2, Math.ceil(setupHours / 24));

  const suggestedPlan =
    implantationCenter >= 22000 ? "enterprise" : implantationCenter >= 12000 ? "pro" : "starter";

  return {
    currency: "BRL",
    complexityScore,
    suggestedPlan,
    matchedRules,
    setupHours,
    implementationWeeks,
    estimate: {
      implantation: {
        min: implantationMin,
        reference: implantationCenter,
        max: implantationMax,
      },
      monthly: {
        min: monthlyMin,
        reference: monthlyCenter,
        max: monthlyMax,
      },
    },
    assumptions: [
      "Valores de referencia para aprovacao inicial.",
      "Nao inclui impostos, anuncios pagos e licencas enterprise de terceiros.",
      "Revisar proposta final apos escopo detalhado e validacao tecnica.",
    ],
    generatedAt: nowIso(),
  };
}

async function buildProjectSnapshot(task) {
  const workspacePath = await resolveWorkspacePath(task);
  if (!workspacePath) {
    return {
      workspacePath: "",
      exists: false,
      checks: [],
      warnings: ["workspacePath nao configurado. Configure para diagnostico completo."],
      summary: "Projeto sem caminho local conectado.",
      score: 35,
      severity: "atencao",
    };
  }

  const checks = [];
  const warnings = [];
  let score = 100;

  const packageJsonPath = path.join(workspacePath, "package.json");
  const readmePath = path.join(workspacePath, "README.md");
  const gitIgnorePath = path.join(workspacePath, ".gitignore");
  const envPath = path.join(workspacePath, ".env");

  const packageJsonText = await safeReadText(packageJsonPath);
  const readmeText = await safeReadText(readmePath);
  const gitIgnoreText = await safeReadText(gitIgnorePath);
  const envText = await safeReadText(envPath);

  const hasPackageJson = Boolean(packageJsonText);
  const hasReadme = Boolean(readmeText);
  const hasGitIgnore = Boolean(gitIgnoreText);
  const hasEnv = Boolean(envText);
  const envIgnored = hasGitIgnore && /(^|\n)\.env(\n|$)/.test(gitIgnoreText);

  checks.push({ name: "package.json", ok: hasPackageJson });
  checks.push({ name: "README.md", ok: hasReadme });
  checks.push({ name: ".gitignore", ok: hasGitIgnore });
  checks.push({ name: ".env protegido", ok: !hasEnv || envIgnored });

  if (!hasPackageJson) {
    score -= 30;
    warnings.push("Projeto sem package.json local.");
  }

  if (!hasReadme) {
    score -= 15;
    warnings.push("Projeto sem README.md para onboarding rapido.");
  }

  if (hasEnv && !envIgnored) {
    score -= 30;
    warnings.push("Arquivo .env existe e nao esta protegido no .gitignore.");
  }

  let scripts = {};
  if (hasPackageJson) {
    try {
      const parsed = JSON.parse(packageJsonText);
      scripts = parsed.scripts || {};
      checks.push({ name: "script lint", ok: Boolean(parsed.scripts?.lint) });
      checks.push({ name: "script test", ok: Boolean(parsed.scripts?.test) });
      if (!parsed.scripts?.lint) {
        score -= 10;
        warnings.push("Sem script de lint configurado.");
      }
      if (!parsed.scripts?.test) {
        score -= 10;
        warnings.push("Sem script de teste configurado.");
      }
    } catch {
      score -= 15;
      warnings.push("package.json invalido para parse.");
    }
  }

  score = Math.max(0, Math.min(100, score));

  const severity = score >= 80 ? "saudavel" : score >= 55 ? "atencao" : "critico";
  const summary =
    severity === "saudavel"
      ? "Projeto com saude operacional estavel."
      : severity === "atencao"
        ? "Projeto funcional com pontos de risco."
        : "Projeto com risco alto e precisa de correcao orientada.";

  return {
    workspacePath,
    exists: true,
    score,
    severity,
    checks,
    warnings,
    scripts,
    summary,
  };
}

async function buildDoctorPlan(task, snapshot) {
  const projectName = task.projectName || task.payload?.projectName || "Projeto sem nome";
  const slug = slugify(projectName);
  const reportFile = path.join(DOCTOR_REPORTS_DIR, `${slug}-${Date.now()}.md`);

  const actions = [];
  if (!snapshot.exists || !snapshot.workspacePath) {
    actions.push("- Conectar workspacePath local para habilitar diagnostico completo.");
  }
  if (snapshot.warnings.length === 0) {
    actions.push("- Manter rotina diaria de auditoria e monitorar logs.");
  } else {
    for (const warning of snapshot.warnings) actions.push(`- ${warning}`);
  }
  if (!snapshot.checks.some((check) => check.name === "script lint" && check.ok)) {
    actions.push("- Criar script de lint e executar em CI.");
  }
  if (!snapshot.checks.some((check) => check.name === "script test" && check.ok)) {
    actions.push("- Criar suite minima de testes automatizados.");
  }

  const content = [
    `# Doctor Report - ${projectName}`,
    "",
    `Gerado em: ${nowIso()}`,
    `Task: ${task.id}`,
    `Tipo: ${task.type}`,
    "",
    "## Status",
    `- Score: ${snapshot.score}/100`,
    `- Severidade: ${snapshot.severity || "indefinida"}`,
    `- Resumo: ${snapshot.summary}`,
    "",
    "## Checkpoints",
    ...snapshot.checks.map((check) => `- [${check.ok ? "x" : " "}] ${check.name}`),
    "",
    "## Plano de Correcao",
    ...actions,
    "",
    "## Proximo Ciclo",
    "- Rodar auditoria novamente apos aplicar as correcoes.",
    "- Revisar logs e tarefas pendentes no painel da AI Factory.",
    "",
  ].join("\n");

  await fs.writeFile(reportFile, content, "utf8");

  return {
    reportFile,
    actions,
    score: snapshot.score,
    severity: snapshot.severity,
  };
}

async function saveLiveExecutionProgress(task, scope, progress) {
  if (!task?.id || !progress?.step) return;
  await updateTaskStatus(task.id, {
    live_execution: {
      scope,
      updatedAt: nowIso(),
      stepIndex: progress.index,
      stepTotal: progress.total,
      lastStep: {
        id: progress.step.id,
        label: progress.step.label,
        command: progress.step.command,
        ok: progress.step.ok,
        exitCode: progress.step.exitCode,
        durationMs: progress.step.durationMs,
        startedAt: progress.step.startedAt,
        finishedAt: progress.step.finishedAt,
        stdoutPreview: progress.step.stdoutPreview || "",
        stderrPreview: progress.step.stderrPreview || "",
        logPath: progress.step.logPath,
      },
    },
  });
}

async function executeProjectBootstrap(task) {
  const name = task.projectName || task.payload?.projectName || "novo-projeto";
  const objective =
    task.payload?.objective || task.command || "Projeto criado automaticamente pela AI Factory.";
  const stack = task.payload?.stack || "node";
  const slug = slugify(name);
  const baseDir = path.join(GENERATED_PROJECTS_DIR, `${slug}-${Date.now()}`);

  await fs.mkdir(path.join(baseDir, "src"), { recursive: true });

  const packageJson = {
    name: slug,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      start: "node src/index.js",
      doctor: 'echo "Doctor checklist: configure lint/test/build"',
    },
  };

  const readme = [
    `# ${name}`,
    "",
    "Criado automaticamente pela AI Factory.",
    "",
    "## Objetivo",
    objective,
    "",
    "## Stack sugerida",
    `- ${stack}`,
    "",
    "## Proximos passos",
    "1. Conectar repositorio Git remoto.",
    "2. Configurar lint, testes e pipeline de deploy.",
    "3. Registrar o workspace no painel AI Factory.",
    "",
  ].join("\n");

  await fs.writeFile(path.join(baseDir, "README.md"), readme, "utf8");
  await fs.writeFile(
    path.join(baseDir, "package.json"),
    JSON.stringify(packageJson, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(baseDir, "src", "index.js"),
    `console.log("Projeto ${name} criado pela AI Factory em ${nowIso()}");\n`,
    "utf8",
  );

  return {
    kind: "project_bootstrap",
    generatedPath: baseDir,
    files: ["README.md", "package.json", "src/index.js"],
    message: "Projeto base criado com sucesso.",
  };
}

async function executeProjectAudit(task) {
  const snapshot = await buildProjectSnapshot(task);
  const doctorPlan = await buildDoctorPlan(task, snapshot);

  if (task.payload?.autoFix && snapshot.score < 80) {
    await queueTask({
      type: "project_fix",
      projectId: task.projectId,
      projectName: task.projectName,
      repository: task.repository,
      workspacePath: task.workspacePath,
      title: `Doctor fix plan: ${task.projectName || "projeto"}`,
      command: "Gerar plano de correcao orientado por diagnostico.",
      payload: {
        sourceAuditTaskId: task.id,
        snapshot,
      },
      priority: snapshot.score < 55 ? "high" : "normal",
    });
  }

  return {
    kind: "project_audit",
    snapshot,
    doctorPlan,
  };
}

async function executeProjectFix(task) {
  const snapshot = task.payload?.snapshot || (await buildProjectSnapshot(task));
  const doctorPlan = await buildDoctorPlan(task, snapshot);
  if (!snapshot.exists || !snapshot.workspacePath) {
    return {
      kind: "project_fix",
      summary: "Workspace nao conectado. Correcao automatica nao executada.",
      snapshot,
      doctorPlan,
      execution: null,
      safeFixes: [],
      replacements: [],
    };
  }

  const safeFixes =
    task.payload?.applySafeFixes === false ? [] : await applySafeWorkspaceFixes(task, snapshot);
  const replacementList = Array.isArray(task.payload?.replacements)
    ? task.payload.replacements
    : [];
  const replacements = replacementList.length
    ? await applyTextReplacements(snapshot.workspacePath, replacementList)
    : [];

  let commands = [];
  if (Array.isArray(task.payload?.commands) && task.payload.commands.length > 0) {
    commands = task.payload.commands;
  } else if (task.command && !/gerar plano/i.test(task.command)) {
    commands = [task.command];
  } else {
    commands = defaultProjectPipeline(snapshot);
  }

  const autoResolveEnabled = task.payload?.autoResolve !== false;
  const autoResolveMaxAttempts = clampAutoResolveAttempts(task.payload?.autoResolveMaxAttempts, 2);
  const autoRepairAttempts = [];
  let execution = null;

  if (commands.length > 0) {
    let recoveryAttempt = 0;
    while (recoveryAttempt <= autoResolveMaxAttempts) {
      try {
        execution = await runCommandPlan(task, snapshot.workspacePath, commands, {
          prefix: recoveryAttempt === 0 ? "project-fix" : `project-fix-rerun-${recoveryAttempt}`,
          continueOnError: Boolean(task.payload?.continueOnError),
          allowDangerousCommands: Boolean(task.payload?.allowDangerousCommands),
          onStep: async (progress) => {
            await saveLiveExecutionProgress(task, "project_fix", progress);
          },
        });
        break;
      } catch (error) {
        if (!(error instanceof CommandPlanFailedError)) throw error;
        if (!autoResolveEnabled || recoveryAttempt >= autoResolveMaxAttempts) {
          throw error;
        }

        const repairCommands = buildAutonomousRepairCommands(snapshot, error);
        if (repairCommands.length === 0) {
          throw new Error(
            `${error.message}. Auto-resolucao sem estrategia para esta falha; acione forca manual com contexto especifico.`,
          );
        }

        await addLog("warn", "Auto-resolucao em andamento", {
          taskId: task.id,
          attempt: recoveryAttempt + 1,
          projectName: task.projectName || null,
          failedCommand: error.step?.command || null,
          repairCommands: repairCommands.map((item) => item.command),
        });

        let repairExecution = null;
        try {
          repairExecution = await runCommandPlan(task, snapshot.workspacePath, repairCommands, {
            prefix: `project-fix-auto-${recoveryAttempt + 1}`,
            continueOnError: false,
            allowDangerousCommands: false,
            onStep: async (progress) => {
              await saveLiveExecutionProgress(task, "project_fix_auto", progress);
            },
          });
        } catch (repairError) {
          const repairMessage =
            repairError instanceof Error ? repairError.message : String(repairError);
          throw new Error(
            `Auto-resolucao falhou na tentativa ${recoveryAttempt + 1}: ${repairMessage}`,
          );
        }

        autoRepairAttempts.push({
          attempt: recoveryAttempt + 1,
          reason: error.message,
          failedCommand: error.step?.command || "",
          repairCommands: repairCommands.map((item) => item.command),
          execution: repairExecution,
        });

        recoveryAttempt += 1;
      }
    }
  }

  const changedFiles = [
    ...safeFixes.map((item) => item.filePath),
    ...replacements.filter((item) => item.changed).map((item) => item.filePath),
  ];

  const summaryBase =
    changedFiles.length > 0
      ? "Correcao aplicada com sucesso e evidencias registradas."
      : "Nenhuma alteracao de arquivo aplicada; somente validacao executada.";
  const summary =
    autoRepairAttempts.length > 0
      ? `${summaryBase} Auto-resolucao executou ${autoRepairAttempts.length} tentativa(s) automatica(s).`
      : summaryBase;

  return {
    kind: "project_fix",
    summary,
    snapshot,
    doctorPlan,
    safeFixes,
    replacements,
    changedFiles,
    autoResolve: {
      enabled: autoResolveEnabled,
      maxAttempts: autoResolveMaxAttempts,
      attemptsUsed: autoRepairAttempts.length,
      recovered: autoRepairAttempts.length > 0 && Boolean(execution),
      attempts: autoRepairAttempts,
    },
    execution,
    executedAt: nowIso(),
  };
}

async function executeWorkspaceCommand(task) {
  const workspacePath = await resolveWorkspacePath(task);
  if (!workspacePath) {
    return {
      kind: "workspace_command",
      summary: "workspacePath ausente. Comando nao executado.",
      execution: null,
    };
  }

  const commands = Array.isArray(task.payload?.commands)
    ? task.payload.commands
    : task.command
      ? [task.command]
      : [];
  if (commands.length === 0) {
    return {
      kind: "workspace_command",
      summary: "Nenhum comando recebido.",
      execution: null,
    };
  }

  const execution = await runCommandPlan(task, workspacePath, commands, {
    prefix: "workspace-command",
    continueOnError: Boolean(task.payload?.continueOnError),
    allowDangerousCommands: Boolean(task.payload?.allowDangerousCommands),
    onStep: async (progress) => {
      await saveLiveExecutionProgress(task, "workspace_command", progress);
    },
  });

  return {
    kind: "workspace_command",
    workspacePath,
    summary: "Comandos executados com evidencias de log.",
    execution,
  };
}

async function executeProjectSeedData(task) {
  const workspacePath = await resolveWorkspacePath(task);
  if (!workspacePath) {
    return {
      kind: "project_seed_data",
      summary: "workspacePath ausente. Seed nao executado.",
      writtenFiles: [],
      execution: null,
    };
  }

  const files = Array.isArray(task.payload?.files) ? task.payload.files : [];
  const writtenFiles = [];

  for (const item of files) {
    const relative = String(item?.path || item?.filePath || "");
    if (!relative) continue;
    const absolutePath = resolvePathInsideWorkspace(workspacePath, relative);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const value = item?.content;
    const text =
      typeof value === "string" ? value : JSON.stringify(value ?? item?.data ?? {}, null, 2);
    await fs.writeFile(absolutePath, `${text}\n`, "utf8");
    writtenFiles.push(absolutePath);
  }

  const commands = Array.isArray(task.payload?.commands) ? task.payload.commands : [];
  const execution =
    commands.length > 0
      ? await runCommandPlan(task, workspacePath, commands, {
          prefix: "seed-data",
          continueOnError: Boolean(task.payload?.continueOnError),
          allowDangerousCommands: Boolean(task.payload?.allowDangerousCommands),
          onStep: async (progress) => {
            await saveLiveExecutionProgress(task, "project_seed_data", progress);
          },
        })
      : null;

  return {
    kind: "project_seed_data",
    workspacePath,
    summary: "Dados preparados no workspace com trilha de evidencias.",
    writtenFiles,
    execution,
  };
}

async function callOpenAI(task) {
  if (!env.openaiKey) {
    openaiRuntimeState = {
      configured: false,
      ready: false,
      lastCheckedAt: nowIso(),
      lastStatus: null,
      lastError: "missing OPENAI_API_KEY",
    };
    return {
      provider: "openai",
      skipped: true,
      reason: "missing OPENAI_API_KEY",
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: `Analise e plano de execucao: ${task.title}`,
    }),
  });

  const data = await response.json().catch(() => ({}));
  openaiRuntimeState = {
    configured: true,
    ready: response.ok,
    lastCheckedAt: nowIso(),
    lastStatus: response.status,
    lastError: response.ok ? null : data.error?.message || String(data.error || "OpenAI falhou"),
  };
  return {
    provider: "openai",
    ok: response.ok,
    status: response.status,
    id: data.id || null,
    model: data.model || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    error: response.ok ? null : data.error?.message || data.error || data,
  };
}

async function createGithubIssueComment(task) {
  const repo = task.repository || process.env.GITHUB_REPO;
  if (!env.githubToken || !repo || !task.githubIssueNumber) {
    return { provider: "github", skipped: true };
  }

  const response = await fetch(
    `https://api.github.com/repos/${repo}/issues/${task.githubIssueNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: `Factory task ${task.id} finalizada em ${nowIso()}`,
      }),
    },
  );

  return {
    provider: "github",
    ok: response.ok,
    status: response.status,
  };
}

async function executeTask(task) {
  if (task.type === "codex_manual_bridge" || task.type === "factory_report_test") {
    return {
      kind: task.type,
      codex_status: "manual_bridge",
      awaitingCodex: task.type === "codex_manual_bridge",
      done: [
        task.type === "codex_manual_bridge"
          ? "missao estruturada para execucao manual pelo Codex"
          : "missao teste finalizada pela Factory",
      ],
      runningNow:
        task.type === "codex_manual_bridge" ? ["aguardando Codex"] : ["nada em execucao"],
      blockers:
        task.type === "codex_manual_bridge"
          ? ["aguardando Codex executar a missao pela ponte manual"]
          : ["nenhum bloqueio"],
      nextSteps:
        task.type === "codex_manual_bridge"
          ? ["registrar retorno do Codex no relatorio final"]
          : ["validar endpoints /relatorio e /relatorios"],
      notes: ["Codex operando por manual_bridge quando nao ha conexao automatica real."],
    };
  }
  if (task.type === "project_bootstrap") return executeProjectBootstrap(task);
  if (task.type === "project_audit") return executeProjectAudit(task);
  if (task.type === "project_fix") return executeProjectFix(task);
  if (task.type === "workspace_command") return executeWorkspaceCommand(task);
  if (task.type === "project_seed_data" || task.type === "seed_data") {
    return executeProjectSeedData(task);
  }

  const ai = await callOpenAI(task);
  if (ai.skipped || ai.ok === false) {
    throw new Error(
      `OpenAI indisponivel para ${task.type || "generic"}: ${ai.reason || ai.error || ai.status}`,
    );
  }
  const gh = await createGithubIssueComment(task);
  return {
    kind: task.type || "generic",
    ai,
    gh,
  };
}

async function processNext() {
  if (processing) return;
  processing = true;
  let task = null;

  try {
    const queue = await readJson(QUEUE_FILE, []);
    const nextIndex = queue.findIndex((task) => isPendingStatus(task.status));
    if (nextIndex === -1) return;

    task = queue[nextIndex];
    const startedAt = nowIso();

    await updateTaskStatus(task.id, {
      status: "running",
      started_at: startedAt,
      attempts: Number(task.attempts || 0) + 1,
      live_execution: {
        scope: task.type || "generic",
        updatedAt: startedAt,
        stepIndex: 0,
        stepTotal: 0,
      },
    });

    await addLog("info", "Processamento iniciado", {
      taskId: task.id,
      type: task.type,
      projectName: task.projectName,
    });

    const result = await executeTask(task);

    await updateTaskStatus(task.id, {
      status: "completed",
      finished_at: nowIso(),
      result,
      live_execution: null,
    });

    await saveMissionReport(
      buildMissionReport(task, {
        status: "completed",
        result,
      }),
    );

    await addLog("ok", "Tarefa concluida", {
      taskId: task.id,
      type: task.type,
      projectName: task.projectName,
    });
  } catch (error) {
    const message = String(error);
    if (task?.id) {
      await updateTaskStatus(task.id, {
        status: "failed",
        finished_at: nowIso(),
        error: message,
        live_execution: null,
      });
      await saveMissionReport(
        buildMissionReport(task, {
          status: "failed",
          error: message,
        }),
      );
    }
    await addLog("error", "Falha no processamento", {
      error: message,
      taskId: task?.id || null,
      taskType: task?.type || null,
    });
  } finally {
    processing = false;
  }
}

async function getStatusPayload() {
  const queue = await readJson(QUEUE_FILE, []);
  const projects = await loadProjects();
  const subscriptions = await loadPushSubscriptions();
  const database = await getDatabaseHealth();
  const missingEnv = getMissingEnv();
  const codex = getCodexOperationalStatus();
  const reports = await readJson(REPORTS_FILE, []);
  return {
    online: true,
    processing,
    port: PORT,
    pollMs: POLL_MS,
    queueFile: QUEUE_FILE,
    logFile: LOG_FILE,
    reportsFile: REPORTS_FILE,
    missingEnv,
    codex_status: codex.codex_status,
    reports_enabled: true,
    counts: {
      queuePending: queue.filter((task) => isPendingStatus(task.status)).length,
      queueAwaitingApproval: queue.filter((task) => isApprovalStatus(task.status)).length,
      queueProcessing: queue.filter((task) => isRunningStatus(task.status)).length,
      queueFailed: queue.filter((task) => isFailedStatus(task.status)).length,
      projectsEnabled: projects.filter((project) => project.enabled !== false).length,
      projectsTotal: projects.length,
      pushSubscriptions: subscriptions.length,
      reports: Array.isArray(reports) ? reports.length : 0,
    },
    autopilot: autopilotState,
    integrations: {
      supabase: database.ready,
      supabaseConnected: database.connected,
      openai: openaiRuntimeState.ready,
      openaiConfigured: openaiRuntimeState.configured,
      openaiReady: openaiRuntimeState.ready,
      openaiLastCheckedAt: openaiRuntimeState.lastCheckedAt,
      openaiLastStatus: openaiRuntimeState.lastStatus,
      openaiLastError: openaiRuntimeState.lastError,
      github: Boolean(env.githubToken),
      githubRepo: Boolean(env.githubRepo),
      codexConnected: codex.connected,
      codexStatus: codex.codex_status,
      reportsEnabled: true,
      missingEnv,
    },
    codex,
    database,
    capabilities: {
      createProject: true,
      auditProject: true,
      applyFixes: true,
      runWorkspaceCommands: true,
      seedProjectData: true,
      estimateProjectCost: true,
      approvalFlow: true,
      evidenceLogs: true,
      pushNotifications: pushReady,
    },
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, withCorsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/status")) {
    const payload = await getStatusPayload();
    if (wantsJson(req, url)) return json(res, 200, payload);
    const [queue, logs, projects] = await Promise.all([
      readJson(QUEUE_FILE, []),
      readJson(LOG_FILE, []),
      loadProjects(),
    ]);
    return html(res, 200, statusHtml(payload, { queue, logs, projects }));
  }

  if (req.method === "GET" && url.pathname === "/fila") {
    return json(res, 200, await readJson(QUEUE_FILE, []));
  }

  if (req.method === "GET" && /^\/fila\/[^/]+$/.test(url.pathname)) {
    const taskId = url.pathname.split("/")[2];
    const queue = await readJson(QUEUE_FILE, []);
    const task = queue.find((item) => item.id === taskId);
    if (!task) return json(res, 404, { error: "tarefa nao encontrada" });
    const logs = (await readJson(LOG_FILE, [])).filter((log) => {
      const serialized = JSON.stringify(log);
      return serialized.includes(taskId);
    });
    return json(res, 200, {
      ...task,
      status: normalizeTaskStatus(task.status),
      logs,
    });
  }

  if (req.method === "POST" && url.pathname === "/fila") {
    try {
      const body = await parseBody(req);
      const queuedTask = await queueTask(body);
      return json(res, 201, queuedTask);
    } catch {
      return json(res, 400, { error: "json invalido" });
    }
  }

  if (req.method === "POST" && /^\/fila\/[^/]+\/(?:aprovar|approve)$/.test(url.pathname)) {
    const taskId = url.pathname.split("/")[2];
    const updatedTask = await approveTask(taskId);
    if (!updatedTask) return json(res, 404, { error: "tarefa nao encontrada" });
    return json(res, 200, updatedTask);
  }

  if (req.method === "POST" && /^\/fila\/[^/]+\/rejeitar$/.test(url.pathname)) {
    const taskId = url.pathname.split("/")[2];
    const body = await parseBody(req).catch(() => ({}));
    const updatedTask = await updateTaskStatus(taskId, {
      status: "rejected",
      rejected_at: nowIso(),
      rejection_reason: body.reason ? String(body.reason) : "rejeitado manualmente",
    });
    if (!updatedTask) return json(res, 404, { error: "tarefa nao encontrada" });
    await addLog("warn", "Tarefa rejeitada manualmente", { taskId });
    return json(res, 200, updatedTask);
  }

  if (req.method === "POST" && /^\/fila\/[^/]+\/cancelar$/.test(url.pathname)) {
    const taskId = url.pathname.split("/")[2];
    const body = await parseBody(req).catch(() => ({}));
    const updatedTask = await updateTaskStatus(taskId, {
      status: "cancelled",
      cancelled_at: nowIso(),
      cancellation_reason: body.reason ? String(body.reason) : "cancelado manualmente",
      live_execution: null,
    });
    if (!updatedTask) return json(res, 404, { error: "tarefa nao encontrada" });
    await addLog("warn", "Tarefa cancelada manualmente", { taskId });
    return json(res, 200, updatedTask);
  }

  if (req.method === "POST" && /^\/fila\/[^/]+\/reenviar$/.test(url.pathname)) {
    const taskId = url.pathname.split("/")[2];
    const queue = await readJson(QUEUE_FILE, []);
    const sourceTask = queue.find((task) => task.id === taskId);
    if (!sourceTask) return json(res, 404, { error: "tarefa nao encontrada" });
    const queuedTask = await queueTask({
      ...sourceTask,
      title: `Reenvio: ${sourceTask.title || sourceTask.type || sourceTask.id}`,
      status: undefined,
      requiresApproval: false,
      payload: {
        ...(sourceTask.payload || {}),
        resentFromTaskId: sourceTask.id,
        resentAt: nowIso(),
      },
    });
    await addLog("info", "Tarefa reenviada", {
      taskId: queuedTask.id,
      sourceTaskId: sourceTask.id,
      projectName: queuedTask.projectName,
    });
    return json(res, 201, queuedTask);
  }

  if (req.method === "GET" && /^\/fila\/[^/]+\/diagnostico$/.test(url.pathname)) {
    const taskId = url.pathname.split("/")[2];
    const queue = await readJson(QUEUE_FILE, []);
    const task = queue.find((item) => item.id === taskId);
    if (!task) return json(res, 404, { error: "tarefa nao encontrada" });
    const reportFile = task.result?.doctorPlan?.reportFile || task.result?.reportFile || null;
    let report = null;
    if (reportFile) {
      try {
        report = await fs.readFile(reportFile, "utf8");
      } catch {
        report = null;
      }
    }
    return json(res, 200, {
      taskId,
      status: normalizeTaskStatus(task.status),
      diagnostic: task.result?.doctorPlan || task.result?.snapshot || task.result || null,
      reportFile,
      report,
    });
  }

  if (req.method === "GET" && /^\/fila\/[^/]+\/arquivos$/.test(url.pathname)) {
    const taskId = url.pathname.split("/")[2];
    const queue = await readJson(QUEUE_FILE, []);
    const task = queue.find((item) => item.id === taskId);
    if (!task) return json(res, 404, { error: "tarefa nao encontrada" });
    const changedFiles = [
      ...(Array.isArray(task.result?.applied) ? task.result.applied : []),
      ...(Array.isArray(task.result?.writtenFiles) ? task.result.writtenFiles : []),
      ...(Array.isArray(task.result?.execution?.writtenFiles)
        ? task.result.execution.writtenFiles
        : []),
    ];
    return json(res, 200, {
      taskId,
      changedFiles,
      pendingIntegration:
        changedFiles.length === 0 ? "aguardando execucao ou sem arquivos alterados" : null,
    });
  }

  if (req.method === "POST" && /^\/fila\/[^/]+\/forcar$/.test(url.pathname)) {
    try {
      const sourceTaskId = url.pathname.split("/")[2];
      const body = await parseBody(req).catch(() => ({}));
      const queue = await readJson(QUEUE_FILE, []);
      const sourceTask = queue.find((task) => task.id === sourceTaskId);
      if (!sourceTask) return json(res, 404, { error: "tarefa de origem nao encontrada" });

      const projects = await loadProjects();
      const project = pickProjectForTask(projects, sourceTask);
      const workspaceFromTask = String(
        sourceTask.workspacePath || sourceTask.payload?.workspacePath || "",
      ).trim();
      const workspacePath = String(project?.workspacePath || workspaceFromTask || "").trim();
      const projectName = project?.name || sourceTask.projectName || "Projeto nao identificado";
      const projectId = project?.id || sourceTask.projectId || null;
      const repository = String(project?.repository || sourceTask.repository || "").trim();

      if (!workspacePath) {
        return json(res, 400, {
          error: `workspacePath ausente para ${projectName}. Configure antes de forcar resolucao.`,
        });
      }

      const commands = buildForceRecoveryCommands(sourceTask);
      const reason = body.reason
        ? String(body.reason).trim()
        : "forca manual para resolver falha com prioridade";
      const queuedTask = await queueTask({
        type: "project_fix",
        projectId,
        projectName,
        repository,
        workspacePath,
        priority: "critical",
        requiresApproval: false,
        title: body.title
          ? String(body.title).trim()
          : `Forcar resolucao: ${sourceTask.title || sourceTask.type || sourceTask.id}`,
        command: body.command
          ? String(body.command).trim()
          : `Forcar correcao da tarefa ${sourceTask.id}. Motivo: ${reason}`,
        payload: {
          applySafeFixes: true,
          replacements: [],
          commands,
          continueOnError: false,
          autoResolve: true,
          autoResolveMaxAttempts: 3,
          forceMode: true,
          forcedFromTaskId: sourceTask.id,
          forcedReason: reason,
          forcedAt: nowIso(),
        },
      });

      const forcedTask =
        (await updateTaskStatus(queuedTask.id, {
          status: "pending",
          requires_approval: false,
          approved_at: nowIso(),
          forced_by_user: true,
        })) || queuedTask;

      await addLog("warn", "Forca de resolucao acionada", {
        sourceTaskId,
        forcedTaskId: forcedTask.id,
        projectName,
        commands: commands.length,
      });

      return json(res, 201, {
        ok: true,
        sourceTaskId,
        forcedTask,
      });
    } catch (error) {
      return json(res, 400, { error: `falha ao forcar resolucao: ${String(error)}` });
    }
  }

  if (req.method === "GET" && url.pathname === "/relatorio") {
    const reports = await readJson(REPORTS_FILE, []);
    const latest = Array.isArray(reports) && reports.length > 0 ? reports[0] : null;
    if (!latest) return json(res, 404, { error: "nenhum relatorio registrado" });
    return json(res, 200, latest);
  }

  if (req.method === "GET" && url.pathname === "/relatorios") {
    const reports = await readJson(REPORTS_FILE, []);
    return json(res, 200, Array.isArray(reports) ? reports : []);
  }

  if (req.method === "GET" && url.pathname === "/logs") {
    return json(res, 200, await readJson(LOG_FILE, []));
  }

  if (req.method === "GET" && url.pathname === "/db/health") {
    return json(res, 200, await getDatabaseHealth());
  }

  if (req.method === "GET" && url.pathname === "/notifications/vapid-public-key") {
    if (!pushReady || !pushKeys.publicKey) {
      return json(res, 503, { error: "push_desabilitado", reason: "vapid_nao_configurado" });
    }
    return json(res, 200, { publicKey: pushKeys.publicKey });
  }

  if (req.method === "GET" && url.pathname === "/notifications/subscriptions") {
    const subscriptions = await loadPushSubscriptions();
    return json(res, 200, {
      count: subscriptions.length,
      enabled: pushReady,
    });
  }

  if (req.method === "POST" && url.pathname === "/notifications/subscriptions") {
    try {
      const body = await parseBody(req);
      const saved = await upsertPushSubscription(body);
      await addLog("info", "Push subscription registrada", {
        subscriptionId: saved.id,
        userId: saved.userId,
      });
      return json(res, 201, { ok: true, id: saved.id, userId: saved.userId });
    } catch (error) {
      return json(res, 400, { error: String(error) });
    }
  }

  if (req.method === "DELETE" && url.pathname === "/notifications/subscriptions") {
    const body = await parseBody(req).catch(() => ({}));
    const endpoint = body.endpoint ? String(body.endpoint) : "";
    const result = await removePushSubscription(endpoint);
    return json(res, 200, { ok: true, ...result });
  }

  if (req.method === "POST" && url.pathname === "/notifications/test") {
    if (!pushReady) {
      return json(res, 503, { error: "push_desabilitado", reason: "vapid_nao_configurado" });
    }
    const body = await parseBody(req).catch(() => ({}));
    const payload = {
      title: body.title ? String(body.title) : "AI Factory",
      body: body.body ? String(body.body) : "Push de teste",
      tag: body.tag ? String(body.tag) : "test",
      data: { type: "manual_test", timestamp: nowIso() },
    };
    const result = await notifyPush(payload, { userId: body.userId || null });
    return json(res, 200, { ok: true, result });
  }

  if (req.method === "GET" && url.pathname === "/projects") {
    return json(res, 200, await loadProjects());
  }

  if (req.method === "POST" && /^\/projects\/[^/]+\/estimate$/.test(url.pathname)) {
    try {
      const projectId = url.pathname.split("/")[2];
      const body = await parseBody(req).catch(() => ({}));
      const projects = await loadProjects();
      const project = projects.find((item) => item.id === projectId);
      if (!project) return json(res, 404, { error: "projeto nao encontrado" });

      const tags = Array.isArray(body.tags) ? body.tags : project.tags || [];
      const modules = Array.isArray(body.modules) ? body.modules : project.modules || [];
      const integrations = Array.isArray(body.integrations)
        ? body.integrations
        : project.integrations || [];

      const estimate = estimateProjectBudget({
        name: body.name || project.name,
        objective: body.objective || project.objective || "",
        tags,
        modules,
        integrations,
        command: body.command || "",
      });

      const index = projects.findIndex((item) => item.id === projectId);
      projects[index] = {
        ...project,
        tags,
        modules,
        integrations,
        estimate,
        updatedAt: nowIso(),
      };
      await saveProjects(projects);

      await addLog("info", "Estimativa de custo gerada", {
        projectId,
        projectName: project.name,
        complexityScore: estimate.complexityScore,
        plan: estimate.suggestedPlan,
      });

      return json(res, 200, {
        ok: true,
        projectId,
        projectName: project.name,
        estimate,
      });
    } catch (error) {
      return json(res, 400, { error: `falha ao estimar: ${String(error)}` });
    }
  }

  if (req.method === "POST" && url.pathname === "/projects") {
    try {
      const body = await parseBody(req);
      if (!body.name) return json(res, 400, { error: "name obrigatorio" });

      const tags = Array.isArray(body.tags) ? body.tags.map((item) => String(item)) : [];
      const modules = Array.isArray(body.modules) ? body.modules.map((item) => String(item)) : [];
      const integrations = Array.isArray(body.integrations)
        ? body.integrations.map((item) => String(item))
        : [];

      const projects = await loadProjects();
      const estimate = estimateProjectBudget({
        name: body.name,
        objective: body.objective || "",
        tags,
        modules,
        integrations,
      });
      const project = {
        id: `${slugify(body.name)}-${Math.random().toString(36).slice(2, 8)}`,
        name: String(body.name).trim(),
        clientId: body.clientId ? String(body.clientId).trim() : "",
        clientName: body.clientName ? String(body.clientName).trim() : "",
        repository: body.repository ? String(body.repository).trim() : "",
        workspacePath: body.workspacePath ? String(body.workspacePath).trim() : "",
        objective: body.objective ? String(body.objective).trim() : "",
        enabled: body.enabled !== false,
        status: body.status ? String(body.status).trim() : "active",
        tags,
        modules,
        integrations,
        estimate,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      projects.unshift(project);
      await saveProjects(projects);
      await addLog("ok", "Projeto conectado adicionado", {
        projectId: project.id,
        projectName: project.name,
      });
      return json(res, 201, project);
    } catch {
      return json(res, 400, { error: "payload invalido" });
    }
  }

  if (req.method === "PUT" && /^\/projects\/[^/]+$/.test(url.pathname)) {
    try {
      const projectId = url.pathname.split("/")[2];
      const body = await parseBody(req);
      const projects = await loadProjects();
      const index = projects.findIndex((project) => project.id === projectId);
      if (index === -1) return json(res, 404, { error: "projeto nao encontrado" });

      projects[index] = {
        ...projects[index],
        ...body,
        id: projects[index].id,
        updatedAt: nowIso(),
      };
      await saveProjects(projects);
      await addLog("info", "Projeto atualizado", { projectId, projectName: projects[index].name });
      return json(res, 200, projects[index]);
    } catch {
      return json(res, 400, { error: "payload invalido" });
    }
  }

  if (req.method === "DELETE" && /^\/projects\/[^/]+$/.test(url.pathname)) {
    const projectId = url.pathname.split("/")[2];
    const projects = await loadProjects();
    const filtered = projects.filter((project) => project.id !== projectId);
    if (filtered.length === projects.length)
      return json(res, 404, { error: "projeto nao encontrado" });
    await saveProjects(filtered);
    await addLog("warn", "Projeto removido da lista", { projectId });
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && /^\/projects\/[^/]+\/bootstrap$/.test(url.pathname)) {
    const projectId = url.pathname.split("/")[2];
    const projects = await loadProjects();
    const project = projects.find((item) => item.id === projectId);
    if (!project) return json(res, 404, { error: "projeto nao encontrado" });
    const queuedTask = await queueTask({
      type: "project_bootstrap",
      projectId: project.id,
      projectName: project.name,
      repository: project.repository,
      workspacePath: project.workspacePath,
      priority: "high",
      title: `Criar base automatica: ${project.name}`,
      command: "Criacao autonoma de projeto base.",
      payload: {
        project,
        objective: project.objective,
      },
    });
    return json(res, 201, queuedTask);
  }

  if (req.method === "POST" && /^\/projects\/[^/]+\/fix$/.test(url.pathname)) {
    const projectId = url.pathname.split("/")[2];
    const body = await parseBody(req).catch(() => ({}));
    const projects = await loadProjects();
    const project = projects.find((item) => item.id === projectId);
    if (!project) return json(res, 404, { error: "projeto nao encontrado" });
    if (!hasWorkspaceConfigured(project)) {
      return json(res, 400, { error: workspaceMissingErrorMessage(project) });
    }

    const queuedTask = await queueTask({
      type: "project_fix",
      projectId: project.id,
      projectName: project.name,
      repository: project.repository,
      workspacePath: project.workspacePath,
      priority: body.priority || "high",
      title: body.title || `Correcao real: ${project.name}`,
      command: body.command || "",
      payload: {
        applySafeFixes: body.applySafeFixes !== false,
        replacements: Array.isArray(body.replacements) ? body.replacements : [],
        commands: Array.isArray(body.commands) ? body.commands : [],
        continueOnError: Boolean(body.continueOnError),
        autoResolve: body.autoResolve !== false,
        autoResolveMaxAttempts: clampAutoResolveAttempts(body.autoResolveMaxAttempts, 2),
      },
      requiresApproval: body.requiresApproval !== false,
    });
    return json(res, 201, queuedTask);
  }

  if (req.method === "POST" && /^\/projects\/[^/]+\/run$/.test(url.pathname)) {
    const projectId = url.pathname.split("/")[2];
    const body = await parseBody(req).catch(() => ({}));
    const projects = await loadProjects();
    const project = projects.find((item) => item.id === projectId);
    if (!project) return json(res, 404, { error: "projeto nao encontrado" });
    if (!hasWorkspaceConfigured(project)) {
      return json(res, 400, { error: workspaceMissingErrorMessage(project) });
    }

    const commands = Array.isArray(body.commands)
      ? body.commands
      : body.command
        ? [body.command]
        : [];
    if (commands.length === 0) {
      return json(res, 400, { error: "commands obrigatorio" });
    }

    const queuedTask = await queueTask({
      type: "workspace_command",
      projectId: project.id,
      projectName: project.name,
      repository: project.repository,
      workspacePath: project.workspacePath,
      title: body.title || `Execucao no workspace: ${project.name}`,
      command: "",
      payload: {
        commands,
        continueOnError: Boolean(body.continueOnError),
      },
      requiresApproval: body.requiresApproval !== false,
      priority: body.priority || "high",
    });
    return json(res, 201, queuedTask);
  }

  if (req.method === "POST" && /^\/projects\/[^/]+\/seed$/.test(url.pathname)) {
    const projectId = url.pathname.split("/")[2];
    const body = await parseBody(req).catch(() => ({}));
    const projects = await loadProjects();
    const project = projects.find((item) => item.id === projectId);
    if (!project) return json(res, 404, { error: "projeto nao encontrado" });
    if (!hasWorkspaceConfigured(project)) {
      return json(res, 400, { error: workspaceMissingErrorMessage(project) });
    }

    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) {
      return json(res, 400, { error: "files obrigatorio" });
    }

    const queuedTask = await queueTask({
      type: "project_seed_data",
      projectId: project.id,
      projectName: project.name,
      repository: project.repository,
      workspacePath: project.workspacePath,
      title: body.title || `Seed de dados: ${project.name}`,
      payload: {
        files,
        commands: Array.isArray(body.commands) ? body.commands : [],
        continueOnError: Boolean(body.continueOnError),
      },
      requiresApproval: body.requiresApproval !== false,
      priority: body.priority || "high",
    });
    return json(res, 201, queuedTask);
  }

  if (req.method === "GET" && url.pathname === "/autopilot") {
    return json(res, 200, autopilotState);
  }

  if ((req.method === "POST" || req.method === "GET") && url.pathname === "/autopilot/start") {
    let body = {};
    if (req.method === "POST") {
      body = await parseBody(req).catch(() => ({}));
    }
    const intervalMsFromQuery = Number(url.searchParams.get("intervalMs") || "");
    const intervalMs = Number(body.intervalMs || intervalMsFromQuery || autopilotState.intervalMs);
    const state = await startAutopilot(intervalMs);
    return json(res, 200, state);
  }

  if ((req.method === "POST" || req.method === "GET") && url.pathname === "/autopilot/stop") {
    const state = await stopAutopilot();
    return json(res, 200, state);
  }

  if (req.method === "POST" && url.pathname === "/doctor/run") {
    const result = await runDoctorSeed("manual");
    return json(res, 200, result);
  }

  return json(res, 404, { error: "not found" });
});

await ensureFiles();
await recoverInterruptedTasks();
await loadOrCreateVapidKeys();
await loadAutopilotState();
restartAutopilotTimer();
const missingEnvAtStartup = getMissingEnv();
if (missingEnvAtStartup.length > 0) {
  await addLog("warn", "Variaveis de ambiente ausentes", {
    missingEnv: missingEnvAtStartup,
  });
}
await addLog("info", "Worker inicializado", {
  port: PORT,
  pollMs: POLL_MS,
  queueFile: QUEUE_FILE,
  logFile: LOG_FILE,
  missingEnv: missingEnvAtStartup,
  autopilotEnabled: autopilotState.enabled,
  pushEnabled: pushReady,
  pushKeySource: pushKeys.source,
});

if (process.env.FACTORY_RUN_ONCE === "true") {
  console.log("AI Factory Worker executando ciclo unico");
  await processNext();
  await addLog("info", "Worker finalizou ciclo unico", {
    port: PORT,
    missingEnv: missingEnvAtStartup,
  });
  process.exit(0);
}

server.listen(PORT, () => {
  console.log(`AI Factory Worker online na porta ${PORT}`);
});

setInterval(() => {
  void processNext();
}, POLL_MS);

void processNext();
