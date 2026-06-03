// AI FACTORY — central data service
// Estratégia: tenta hidratar do Supabase; em falha/vazio mantém o mock local.
// API permanece sincrona para os componentes existentes.

import { useSyncExternalStore } from "react";
import { supabaseApi, subscribeTable } from "./supabase-api";

export type DataSource = "mock" | "real";
export type ProjectStatus = "online" | "build" | "alert" | "offline";

export interface Project {
  id: string;
  name: string;
  category: string;
  status: ProjectStatus;
  progress: number;
  source: DataSource;
  isPrivate: boolean;
  isExternal: boolean;
  lastUpdate: string;
  description: string;
}

export interface SmartLog {
  id: string;
  projectId: string | null;
  projectName?: string;
  missionName?: string | null;
  repository?: string | null;
  status?: string | null;
  action?: string | null;
  result?: string | null;
  commit?: string | null;
  push?: string | boolean | null;
  blocker?: string | null;
  reportId?: string | null;
  reportUrl?: string | null;
  summary?: string | null;
  isMissionLog?: boolean;
  module?: string;
  type: "system" | "monitor" | "forge" | "doctor" | "connect" | "voice";
  level: "info" | "ok" | "warn" | "error";
  message: string;
  createdAt: string;
  source: DataSource;
  durationMs?: number;
  metadataDetails?: {
    prompt?: string;
    response?: string;
    stackTrace?: string;
    [key: string]: unknown;
  };
}

export interface Integration {
  id: string;
  name: string;
  provider: string;
  status: "connected" | "syncing" | "warning" | "offline";
  lastSync: string;
  errorMessage: string | null;
  source: DataSource;
}

export interface Alert {
  id: string;
  projectId: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  status: "open" | "ack" | "resolved";
  createdAt: string;
  source: DataSource;
}

export interface Correction {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: "suggested" | "applied" | "rejected";
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
  createdAt: string;
  source: DataSource;
}

export interface CommandRecord {
  id: string;
  commandText: string;
  interpretedAction: string;
  status: "queued" | "executed" | "failed";
  createdAt: string;
  source: DataSource;
}

export interface Mission {
  id: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
  source: DataSource;
}

export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  source: DataSource;
}

// ---------- helpers ----------

const now = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);
const str = (v: unknown, fb = "") => (typeof v === "string" ? v : v == null ? fb : String(v));
const num = (v: unknown, fb = 0) => (typeof v === "number" ? v : Number(v) || fb);
const bool = (v: unknown) => v === true || v === "true";

// ---------- Mock seed ----------

const seedProjects: Project[] = [
  {
    id: "topac",
    name: "TOPAC RH",
    category: "Recursos Humanos",
    status: "online",
    progress: 92,
    source: "mock",
    isPrivate: false,
    isExternal: false,
    lastUpdate: now(),
    description: "Plataforma operacional de RH",
  },
  {
    id: "nexus",
    name: "Nexus Lead",
    category: "Comercial",
    status: "online",
    progress: 78,
    source: "mock",
    isPrivate: false,
    isExternal: false,
    lastUpdate: now(),
    description: "Geração e qualificação de leads com IA",
  },
  {
    id: "doctor",
    name: "Doctor PRO",
    category: "Diagnóstico",
    status: "build",
    progress: 64,
    source: "mock",
    isPrivate: false,
    isExternal: false,
    lastUpdate: now(),
    description: "Diagnóstico e correção autônoma",
  },
  {
    id: "forge",
    name: "Forge",
    category: "Engenharia",
    status: "online",
    progress: 88,
    source: "mock",
    isPrivate: false,
    isExternal: false,
    lastUpdate: now(),
    description: "Fábrica de sistemas e módulos",
  },
  {
    id: "pulzr",
    name: "PULZR",
    category: "Monitoramento",
    status: "alert",
    progress: 41,
    source: "mock",
    isPrivate: false,
    isExternal: true,
    lastUpdate: now(),
    description: "Pulso operacional em tempo real",
  },
  {
    id: "flow",
    name: "Flow",
    category: "Automação",
    status: "online",
    progress: 71,
    source: "mock",
    isPrivate: false,
    isExternal: false,
    lastUpdate: now(),
    description: "Orquestração de fluxos inteligentes",
  },
];

const seedLogs: SmartLog[] = [
  {
    id: uid(),
    projectId: "topac",
    type: "connect",
    level: "info",
    message: "Projeto TOPAC RH conectado ao núcleo IA",
    createdAt: now(),
    source: "mock",
  },
  {
    id: uid(),
    projectId: "nexus",
    type: "doctor",
    level: "ok",
    message: "Correção aplicada em Nexus Lead · módulo dashboard",
    createdAt: now(),
    source: "mock",
  },
  {
    id: uid(),
    projectId: null,
    type: "connect",
    level: "info",
    message: "API WhatsApp sincronizada · 1.2k eventos",
    createdAt: now(),
    source: "mock",
  },
  {
    id: uid(),
    projectId: "doctor",
    type: "monitor",
    level: "ok",
    message: "Monitoramento ativo · Doctor PRO",
    createdAt: now(),
    source: "mock",
  },
  {
    id: uid(),
    projectId: "pulzr",
    type: "monitor",
    level: "warn",
    message: "Alerta detectado · latência elevada em PULZR",
    createdAt: now(),
    source: "mock",
  },
  {
    id: uid(),
    projectId: null,
    type: "forge",
    level: "info",
    message: "Forge gerou nova arquitetura · módulo financeiro",
    createdAt: now(),
    source: "mock",
  },
  {
    id: uid(),
    projectId: "flow",
    type: "doctor",
    level: "ok",
    message: "Patch automático aplicado em Flow",
    createdAt: now(),
    source: "mock",
  },
];

const seedIntegrations: Integration[] = [
  {
    id: uid(),
    name: "GitHub",
    provider: "github",
    status: "connected",
    lastSync: now(),
    errorMessage: null,
    source: "mock",
  },
  {
    id: uid(),
    name: "Lovable",
    provider: "lovable",
    status: "connected",
    lastSync: now(),
    errorMessage: null,
    source: "mock",
  },
  {
    id: uid(),
    name: "Supabase",
    provider: "supabase",
    status: "syncing",
    lastSync: now(),
    errorMessage: null,
    source: "mock",
  },
  {
    id: uid(),
    name: "WhatsApp",
    provider: "meta",
    status: "connected",
    lastSync: now(),
    errorMessage: null,
    source: "mock",
  },
  {
    id: uid(),
    name: "Google Drive",
    provider: "google",
    status: "warning",
    lastSync: now(),
    errorMessage: "Permissão a renovar em 3 dias",
    source: "mock",
  },
  {
    id: uid(),
    name: "Stripe",
    provider: "stripe",
    status: "offline",
    lastSync: now(),
    errorMessage: "Aguardando reconexão manual",
    source: "mock",
  },
];

const seedAlerts: Alert[] = [
  {
    id: uid(),
    projectId: "pulzr",
    severity: "critical",
    title: "Latência elevada",
    description: "Endpoint /metrics > 1.5s",
    status: "open",
    createdAt: now(),
    source: "mock",
  },
  {
    id: uid(),
    projectId: "nexus",
    severity: "medium",
    title: "Cache desatualizado",
    description: "Invalidação sugerida",
    status: "open",
    createdAt: now(),
    source: "mock",
  },
  {
    id: uid(),
    projectId: "flow",
    severity: "medium",
    title: "Job atrasado",
    description: "Fila assíncrona +12s",
    status: "ack",
    createdAt: now(),
    source: "mock",
  },
];

const seedCorrections: Correction[] = [
  {
    id: uid(),
    projectId: "nexus",
    title: "Otimizar query do dashboard",
    description: "Adicionar índice composto",
    status: "applied",
    riskLevel: "low",
    requiresApproval: false,
    createdAt: now(),
    source: "mock",
  },
  {
    id: uid(),
    projectId: "pulzr",
    title: "Reiniciar worker de métricas",
    description: "Worker travado em loop",
    status: "suggested",
    riskLevel: "medium",
    requiresApproval: true,
    createdAt: now(),
    source: "mock",
  },
];

// ---------- normalizers ----------

function normalizeProject(r: any): Project {
  const status = (
    ["online", "build", "alert", "offline"].includes(r?.status) ? r.status : "online"
  ) as ProjectStatus;
  return {
    id: str(r?.id ?? r?.uuid ?? uid()),
    name: str(r?.name ?? r?.title ?? "Projeto"),
    category: str(r?.category ?? r?.type ?? "Geral"),
    status,
    progress: Math.min(100, Math.max(0, num(r?.progress, 0))),
    source: "real",
    isPrivate: bool(r?.is_private ?? r?.isPrivate),
    isExternal: bool(r?.is_external ?? r?.isExternal),
    lastUpdate: str(r?.updated_at ?? r?.created_at ?? r?.last_update, now()),
    description: str(r?.description ?? ""),
  };
}

function normalizeLog(r: any): SmartLog {
  const level = (
    ["info", "ok", "warn", "error"].includes(r?.level) ? r.level : "info"
  ) as SmartLog["level"];
  const type = (
    ["system", "monitor", "forge", "doctor", "connect", "voice"].includes(r?.type)
      ? r.type
      : "system"
  ) as SmartLog["type"];
  const meta = r?.meta && typeof r.meta === "object" ? r.meta : {};
  const missionLog =
    meta?.missionLog && typeof meta.missionLog === "object" ? meta.missionLog : {};
  return {
    id: str(r?.id ?? uid()),
    projectId: r?.project_id ?? r?.projectId ?? null,
    projectName: str(r?.project_name ?? r?.projectName ?? missionLog.projectName ?? meta.projectName, ""),
    missionName: str(r?.missionName ?? missionLog.missionName ?? meta.missionName, ""),
    repository: str(r?.repository ?? missionLog.repository ?? meta.repository ?? meta.repositoryUrl, ""),
    status: str(r?.status ?? missionLog.status ?? meta.status, ""),
    action: str(r?.action ?? missionLog.action ?? meta.action, ""),
    result: str(r?.result ?? missionLog.result ?? meta.resultSummary, ""),
    commit: str(r?.commit ?? missionLog.commit ?? meta.commit, ""),
    push: r?.push ?? missionLog.push ?? meta.push ?? null,
    blocker: str(r?.blocker ?? missionLog.blocker ?? meta.blocker, ""),
    reportId: str(r?.reportId ?? missionLog.reportId ?? meta.reportId, ""),
    reportUrl: str(r?.reportUrl ?? missionLog.reportUrl ?? meta.reportUrl, ""),
    summary: str(r?.summary ?? missionLog.summary ?? meta.summary, ""),
    isMissionLog: Boolean(r?.isMissionLog ?? meta.isMissionLog ?? missionLog.reportUrl),
    type,
    level,
    message: str(r?.message ?? r?.text ?? ""),
    createdAt: str(r?.created_at ?? r?.createdAt, now()),
    source: "real",
    metadataDetails: meta,
  };
}

function normalizeIntegration(r: any): Integration {
  const status = (
    ["connected", "syncing", "warning", "offline"].includes(r?.status) ? r.status : "connected"
  ) as Integration["status"];
  return {
    id: str(r?.id ?? uid()),
    name: str(r?.name ?? r?.provider ?? "Integração"),
    provider: str(r?.provider ?? "custom"),
    status,
    lastSync: str(r?.last_sync ?? r?.updated_at ?? r?.created_at, now()),
    errorMessage: r?.error_message ?? null,
    source: "real",
  };
}

function normalizeMission(r: any): Mission {
  return {
    id: str(r?.id ?? uid()),
    title: str(r?.title ?? r?.name ?? "Missão"),
    description: str(r?.description ?? ""),
    status: str(r?.status ?? "open"),
    createdAt: str(r?.created_at, now()),
    source: "real",
  };
}

function normalizeMemory(r: any): MemoryEntry {
  return {
    id: str(r?.id ?? uid()),
    key: str(r?.key ?? r?.label ?? "memo"),
    value: str(r?.value ?? r?.content ?? ""),
    createdAt: str(r?.created_at, now()),
    source: "real",
  };
}

// ---------- Persistência local ----------

const LS_KEYS = {
  logs: "factory.logs",
  commands: "factory.commands",
  corrections: "factory.corrections",
} as const;

function readLS<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}
function writeLS<T>(key: string, value: T[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value.slice(0, 200)));
  } catch {
    /* ignore */
  }
}

// ---------- Estado interno ----------

const state = {
  projects: [...seedProjects],
  logs: [...seedLogs],
  integrations: [...seedIntegrations],
  alerts: [...seedAlerts],
  corrections: [...seedCorrections],
  missions: [] as Mission[],
  memories: [] as MemoryEntry[],
  summary: null as Record<string, unknown> | null,
  source: "mock" as DataSource,
  hydrated: false,
  lastSyncAt: null as string | null,
};

const listeners = new Set<() => void>();
let version = 0;
function emit() {
  version++;
  listeners.forEach((l) => l());
}

// ---------- Service ----------

export const factoryData = {
  get source() {
    return state.source;
  },
  getLastSyncAt(): string | null {
    return state.lastSyncAt;
  },

  // Reads (sincronos)
  getProjects(): Project[] {
    return state.projects;
  },
  getProject(id: string): Project | undefined {
    return state.projects.find((p) => p.id === id);
  },
  getIntegrations(): Integration[] {
    return state.integrations;
  },
  getAlerts(): Alert[] {
    return state.alerts;
  },
  getCorrections(): Correction[] {
    return [...readLS<Correction>(LS_KEYS.corrections), ...state.corrections];
  },
  getLogs(): SmartLog[] {
    return [...readLS<SmartLog>(LS_KEYS.logs), ...state.logs];
  },
  getCommands(): CommandRecord[] {
    return readLS<CommandRecord>(LS_KEYS.commands);
  },
  getMissions(): Mission[] {
    return state.missions;
  },
  getMemories(): MemoryEntry[] {
    return state.memories;
  },
  getSummary(): Record<string, unknown> | null {
    return state.summary;
  },

  getStats() {
    const projects = state.projects;
    const integrations = state.integrations;
    const alerts = state.alerts;
    const summary = state.summary as any;
    return {
      projectsConnected: num(summary?.projects_connected, projects.length),
      projectsOnline: num(
        summary?.projects_online,
        projects.filter((p) => p.status === "online").length,
      ),
      corrections: num(summary?.corrections, this.getCorrections().length),
      alertsActive: num(
        summary?.alerts_active,
        alerts.filter((a) => a.status !== "resolved").length,
      ),
      alertsCritical: num(
        summary?.alerts_critical,
        alerts.filter((a) => a.severity === "critical").length,
      ),
      apisConnected: num(summary?.apis_connected, integrations.length),
      apisSyncing: num(
        summary?.apis_syncing,
        integrations.filter((i) => i.status === "syncing").length,
      ),
      monitored: num(summary?.monitored, projects.length + integrations.length),
    };
  },

  // ---------- Hydration ----------
  async hydrate() {
    if (state.hydrated) return;
    state.hydrated = true;
    await this._fetchAll();
  },

  async refresh() {
    state.hydrated = false;
    await this._fetchAll();
  },

  async _fetchAll() {
    const [projects, logs, integrations, missions, memories, summary] = await Promise.all([
      supabaseApi.listProjects(),
      supabaseApi.listSmartLogs(50),
      supabaseApi.listIntegrations(),
      supabaseApi.listMissions(),
      supabaseApi.listMemories(),
      supabaseApi.getDashboardSummary(),
    ]);

    let realCount = 0;
    if (Array.isArray(projects) && projects.length) {
      state.projects = projects.map(normalizeProject);
      realCount++;
    }
    if (Array.isArray(logs) && logs.length) {
      state.logs = logs.map(normalizeLog);
      realCount++;
    }
    if (Array.isArray(integrations) && integrations.length) {
      state.integrations = integrations.map(normalizeIntegration);
      realCount++;
    }
    if (Array.isArray(missions)) state.missions = missions.map(normalizeMission);
    if (Array.isArray(memories)) state.memories = memories.map(normalizeMemory);
    if (summary && typeof summary === "object") state.summary = summary as Record<string, unknown>;

    if (realCount > 0) state.source = "real";
    state.lastSyncAt = new Date().toISOString();
    emit();
  },

  // Writes
  addLog(input: Partial<SmartLog> & { message: string }): SmartLog {
    const log: SmartLog = {
      id: uid(),
      projectId: input.projectId ?? null,
      projectName: input.projectName,
      missionName: input.missionName,
      repository: input.repository,
      status: input.status,
      action: input.action,
      result: input.result,
      commit: input.commit,
      push: input.push,
      blocker: input.blocker,
      reportId: input.reportId,
      reportUrl: input.reportUrl,
      summary: input.summary,
      isMissionLog: input.isMissionLog,
      module: input.module,
      type: input.type ?? "system",
      level: input.level ?? "info",
      message: input.message,
      createdAt: now(),
      source: "mock",
      durationMs: input.durationMs,
      metadataDetails: input.metadataDetails,
    };
    const list = readLS<SmartLog>(LS_KEYS.logs);
    writeLS(LS_KEYS.logs, [log, ...list]);
    void supabaseApi.insertSmartLog({
      message: log.message,
      level: log.level,
      type: log.type,
      project_id: log.projectId,
    });
    emit();
    return log;
  },
  addCorrection(input: Partial<Correction> & { projectId: string; title: string }): Correction {
    const c: Correction = {
      id: uid(),
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? "Correção simulada gerada pela AI Factory.",
      status: input.status ?? "suggested",
      riskLevel: input.riskLevel ?? "low",
      requiresApproval: input.requiresApproval ?? false,
      createdAt: now(),
      source: "mock",
    };
    const list = readLS<Correction>(LS_KEYS.corrections);
    writeLS(LS_KEYS.corrections, [c, ...list]);
    this.addLog({
      projectId: c.projectId,
      type: "doctor",
      level: "ok",
      message: `Correção sugerida: ${c.title}`,
    });
    return c;
  },
  addCommand(input: Partial<CommandRecord> & { commandText: string }): CommandRecord {
    const cmd: CommandRecord = {
      id: uid(),
      commandText: input.commandText,
      interpretedAction: input.interpretedAction ?? "automation.run",
      status: input.status ?? "queued",
      createdAt: now(),
      source: "mock",
    };
    const list = readLS<CommandRecord>(LS_KEYS.commands);
    writeLS(LS_KEYS.commands, [cmd, ...list]);
    this.addLog({
      type: "voice",
      level: "info",
      message: `Comando registrado: ${cmd.commandText}`,
    });
    return cmd;
  },

  async createProject(payload: { name: string; category?: string; description?: string }) {
    const inserted = await supabaseApi.insertProject({
      name: payload.name,
      category: payload.category ?? "Geral",
      description: payload.description ?? "",
      status: "online",
      progress: 0,
    });
    if (inserted) {
      const p = normalizeProject(inserted);
      state.projects = [p, ...state.projects];
      emit();
      return p;
    }
    // fallback local
    const p: Project = {
      id: uid(),
      name: payload.name,
      category: payload.category ?? "Geral",
      description: payload.description ?? "",
      status: "online",
      progress: 0,
      source: "mock",
      isPrivate: false,
      isExternal: false,
      lastUpdate: now(),
    };
    state.projects = [p, ...state.projects];
    emit();
    return p;
  },

  async createMission(payload: { title: string; description?: string }) {
    const inserted = await supabaseApi.insertMission({
      title: payload.title,
      description: payload.description ?? "",
      status: "open",
    });
    if (inserted) {
      const m = normalizeMission(inserted);
      state.missions = [m, ...state.missions];
      emit();
      return m;
    }
    const m: Mission = {
      id: uid(),
      title: payload.title,
      description: payload.description ?? "",
      status: "open",
      createdAt: now(),
      source: "mock",
    };
    state.missions = [m, ...state.missions];
    emit();
    return m;
  },

  async createExecutionMission(payload: { title: string; objective?: string; project?: string }) {
    const queuePayload = {
      type: "project_update",
      status: "open",
      action: "execute_mission",
      payload: {
        projectRoot: "/workspaces/rh-prospera-hub",
        project: payload.project ?? "AI FACTORY",
        objective: payload.objective ?? payload.title,
        files: [],
      },
    };
    const inserted = await supabaseApi.insertExecutionQueue(queuePayload);
    // Sempre registra missão local também
    const m: Mission = {
      id: str((inserted as any)?.id ?? uid()),
      title: payload.title,
      description: payload.objective ?? "",
      status: "open",
      createdAt: now(),
      source: inserted ? "real" : "mock",
    };
    state.missions = [m, ...state.missions];
    this.addLog({
      type: "system",
      level: "info",
      message: `Missão enviada ao núcleo IA: ${payload.title}`,
    });
    emit();
    return m;
  },

  startRealtime() {
    if (typeof window === "undefined") return () => {};
    const unsub = [
      subscribeTable("smart_logs", () => void this._fetchAll()),
      subscribeTable("ai_execution_queue", () => void this._fetchAll()),
      subscribeTable("projects", () => void this._fetchAll()),
    ];
    // auto refresh leve a cada 30s
    const id = setInterval(() => void this._fetchAll(), 30000);
    return () => {
      unsub.forEach((u) => u && u());
      clearInterval(id);
    };
  },

  async saveMemory(payload: { key: string; value: string }) {
    const inserted = await supabaseApi.insertMemory({ key: payload.key, value: payload.value });
    if (inserted) {
      const m = normalizeMemory(inserted);
      state.memories = [m, ...state.memories];
      emit();
      return m;
    }
    const m: MemoryEntry = {
      id: uid(),
      key: payload.key,
      value: payload.value,
      createdAt: now(),
      source: "mock",
    };
    state.memories = [m, ...state.memories];
    emit();
    return m;
  },

  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function sourceLabel(src: DataSource) {
  return src === "real" ? "Supabase" : "Simulado";
}

// Hook para forçar rerender quando o store muda.
export function useFactoryData() {
  return useSyncExternalStore(
    (cb) => factoryData.subscribe(cb),
    () => version,
    () => version,
  );
}
