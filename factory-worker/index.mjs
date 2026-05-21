import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PORT = Number(process.env.FACTORY_PORT || 8787);
const POLL_MS = Number(process.env.FACTORY_POLL_MS || 5000);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA_DIR = path.join(ROOT, 'factory-data');
const QUEUE_FILE = path.join(DATA_DIR, 'execution-queue.json');
const LOG_FILE = path.join(DATA_DIR, 'execution-logs.json');

const SENSITIVE_PATTERNS = [/delete/i, /drop\s+table/i, /permission/i, /auth/i, /token/i, /secret/i];

const env = {
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
  openaiKey: process.env.OPENAI_API_KEY || '',
  githubToken: process.env.GITHUB_TOKEN || '',
};

const supabase = env.supabaseUrl && env.supabaseKey
  ? createClient(env.supabaseUrl, env.supabaseKey)
  : null;

let processing = false;

async function ensureFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  for (const [file, seed] of [[QUEUE_FILE, '[]'], [LOG_FILE, '[]']]) {
    try { await fs.access(file); } catch { await fs.writeFile(file, seed); }
  }
}

async function readJson(file, fallback = []) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

async function addLog(level, message, extra = {}) {
  const logs = await readJson(LOG_FILE, []);
  logs.unshift({ id: crypto.randomUUID(), ts: new Date().toISOString(), level, message, ...extra });
  await writeJson(LOG_FILE, logs.slice(0, 1000));
  if (supabase) {
    await supabase.from('smart_logs').insert({ level, message, module: 'factory-worker', meta: extra }).catch(() => {});
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
  });
}

function isSensitive(task) {
  const text = `${task.title || ''} ${JSON.stringify(task.payload || {})}`;
  return SENSITIVE_PATTERNS.some((p) => p.test(text));
}

async function queueTask(task) {
  const queue = await readJson(QUEUE_FILE, []);
  const sensitive = isSensitive(task);
  const queued = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    status: sensitive ? 'awaiting_approval' : 'pending',
    requires_approval: sensitive,
    ...task,
  };
  queue.push(queued);
  await writeJson(QUEUE_FILE, queue);
  if (supabase) await supabase.from('ai_execution_queue').insert(queued).catch(() => {});
  await addLog('info', 'Tarefa enfileirada', { taskId: queued.id, requiresApproval: sensitive });
  return queued;
}

async function callOpenAI(task) {
  if (!env.openaiKey) return { provider: 'openai', skipped: true, reason: 'missing OPENAI_API_KEY' };
  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', input: `Analise e plano de execução: ${task.title}` }),
  });
  const data = await resp.json();
  return { provider: 'openai', id: data.id, ok: resp.ok };
}

async function createGithubIssueComment(task) {
  const repo = process.env.GITHUB_REPO;
  if (!env.githubToken || !repo || !task.githubIssueNumber) return { provider: 'github', skipped: true };
  const resp = await fetch(`https://api.github.com/repos/${repo}/issues/${task.githubIssueNumber}/comments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.githubToken}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body: `Factory task ${task.id} concluída em ${new Date().toISOString()}` }),
  });
  return { provider: 'github', ok: resp.ok, status: resp.status };
}

async function processNext() {
  if (processing) return;
  processing = true;
  try {
    const queue = await readJson(QUEUE_FILE, []);
    const idx = queue.findIndex(t => t.status === 'pending');
    if (idx === -1) return;
    const task = queue[idx];
    task.status = 'processing';
    await writeJson(QUEUE_FILE, queue);
    await addLog('info', 'Processamento iniciado', { taskId: task.id });

    const ai = await callOpenAI(task);
    const gh = await createGithubIssueComment(task);

    task.status = 'done';
    task.finished_at = new Date().toISOString();
    task.result = { ai, gh };
    queue[idx] = task;
    await writeJson(QUEUE_FILE, queue);

    if (supabase) {
      await supabase.from('ai_execution_queue').update({ status: 'done', result: task.result, finished_at: task.finished_at }).eq('id', task.id).catch(() => {});
    }

    await addLog('ok', 'Tarefa concluída', { taskId: task.id });
  } catch (err) {
    await addLog('error', 'Falha no processamento', { error: String(err) });
  } finally {
    processing = false;
  }
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/status') {
    return json(res, 200, { online: true, processing, integrations: { supabase: !!supabase, openai: !!env.openaiKey, github: !!env.githubToken } });
  }
  if (req.method === 'GET' && url.pathname === '/fila') {
    return json(res, 200, await readJson(QUEUE_FILE, []));
  }
  if (req.method === 'POST' && url.pathname === '/fila') {
    try {
      const body = await parseBody(req);
      if (!body.title) return json(res, 400, { error: 'title obrigatório' });
      return json(res, 201, await queueTask(body));
    } catch {
      return json(res, 400, { error: 'json inválido' });
    }
  }
  if (req.method === 'POST' && url.pathname.match(/^\/fila\/[^/]+\/aprovar$/)) {
    const id = url.pathname.split('/')[2];
    const queue = await readJson(QUEUE_FILE, []);
    const task = queue.find(t => t.id === id);
    if (!task) return json(res, 404, { error: 'tarefa não encontrada' });
    task.status = 'pending';
    task.approved_at = new Date().toISOString();
    await writeJson(QUEUE_FILE, queue);
    await addLog('info', 'Tarefa sensível aprovada', { taskId: id });
    return json(res, 200, task);
  }
  if (req.method === 'GET' && url.pathname === '/logs') {
    return json(res, 200, await readJson(LOG_FILE, []));
  }
  return json(res, 404, { error: 'not found' });
});

await ensureFiles();
await addLog('info', 'Worker inicializado', { port: PORT });
server.listen(PORT, () => console.log(`AI Factory Worker online na porta ${PORT}`));
setInterval(() => { void processNext(); }, POLL_MS);
void processNext();
