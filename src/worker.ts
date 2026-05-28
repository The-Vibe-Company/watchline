import { runCheck } from "./index";
import type { Extractor, MonitorConfig, MonitorMode, PreviousCheck } from "./index";

export interface Env {
  DB: D1Database;
  WATCHLINE_ADMIN_TOKEN?: string;
  WATCHLINE_MAX_CHECKS_PER_CRON?: string;
}

interface MonitorRow {
  id: string;
  name: string;
  url: string;
  mode: MonitorMode;
  interval_minutes: number;
  enabled: number;
  method: string;
  headers_json: string;
  body: string | null;
  expected_status: number | null;
  extractor_json: string | null;
  last_hash: string | null;
  last_status: "up" | "down" | null;
  last_checked_at: string | null;
  next_check_at: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse(
        { error: message },
        message === "Unauthorized" ? 401 : 400
      );
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDueMonitors(env));
  }
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/") {
    return htmlResponse(renderApp());
  }

  if (request.method === "GET" && path === "/api/health") {
    return jsonResponse({ ok: true, service: "watchline" });
  }

  if (request.method === "GET" && path === "/api/monitors") {
    const monitors = await env.DB.prepare(
      "SELECT * FROM monitors ORDER BY created_at DESC"
    ).all<MonitorRow>();
    return jsonResponse(monitors.results.map(rowToMonitorView));
  }

  if (request.method === "POST" && path === "/api/monitors") {
    requireAuth(request, env);
    const input = (await request.json()) as Partial<MonitorConfig>;
    const monitor = normalizeMonitorInput(input);
    const id = crypto.randomUUID();
    const now = new Date();
    const nextCheckAt = now.toISOString();

    await env.DB.prepare(
      `INSERT INTO monitors (
        id, name, url, mode, interval_minutes, enabled, method, headers_json,
        body, expected_status, extractor_json, next_check_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        monitor.name ?? monitor.url,
        monitor.url,
        monitor.mode,
        monitor.intervalMinutes ?? 60,
        monitor.method ?? "GET",
        JSON.stringify(monitor.headers ?? {}),
        monitor.body ?? null,
        monitor.expectedStatus ?? null,
        monitor.extractor ? JSON.stringify(monitor.extractor) : null,
        nextCheckAt
      )
      .run();

    return jsonResponse({ id, ...monitor, nextCheckAt }, 201);
  }

  const checkMatch = path.match(/^\/api\/monitors\/([^/]+)\/check$/);
  if (request.method === "POST" && checkMatch) {
    requireAuth(request, env);
    const result = await runMonitorById(env, checkMatch[1]);
    return jsonResponse(result);
  }

  const deleteMatch = path.match(/^\/api\/monitors\/([^/]+)$/);
  if (request.method === "DELETE" && deleteMatch) {
    requireAuth(request, env);
    await env.DB.prepare("DELETE FROM monitors WHERE id = ?").bind(deleteMatch[1]).run();
    return jsonResponse({ ok: true });
  }

  if (request.method === "GET" && path === "/api/runs") {
    const monitorId = url.searchParams.get("monitorId");
    const statement = monitorId
      ? env.DB.prepare(
          "SELECT * FROM runs WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 50"
        ).bind(monitorId)
      : env.DB.prepare("SELECT * FROM runs ORDER BY checked_at DESC LIMIT 50");
    const runs = await statement.all();
    return jsonResponse(runs.results);
  }

  return jsonResponse({ error: "Not found" }, 404);
}

export async function runDueMonitors(env: Env): Promise<{ checked: number }> {
  const maxChecks = Number(env.WATCHLINE_MAX_CHECKS_PER_CRON ?? "25");
  const due = await env.DB.prepare(
    `SELECT * FROM monitors
     WHERE enabled = 1 AND next_check_at <= ?
     ORDER BY next_check_at ASC
     LIMIT ?`
  )
    .bind(new Date().toISOString(), maxChecks)
    .all<MonitorRow>();

  for (const monitor of due.results) {
    await runMonitor(env, monitor);
  }

  return { checked: due.results.length };
}

async function runMonitorById(env: Env, id: string): Promise<unknown> {
  const monitor = await env.DB.prepare("SELECT * FROM monitors WHERE id = ?")
    .bind(id)
    .first<MonitorRow>();

  if (!monitor) {
    return { error: "Monitor not found" };
  }

  return runMonitor(env, monitor);
}

async function runMonitor(env: Env, row: MonitorRow): Promise<unknown> {
  const monitor = rowToMonitorConfig(row);
  const previous: PreviousCheck = {
    hash: row.last_hash,
    status: row.last_status
  };
  const lastRun = await env.DB.prepare(
    "SELECT extracted_text FROM runs WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 1"
  )
    .bind(row.id)
    .first<{ extracted_text: string | null }>();
  previous.extractedText = lastRun?.extracted_text ?? null;

  const result = await runCheck(monitor, { previous });
  const checkedAt = new Date();
  const nextCheckAt = new Date(
    checkedAt.getTime() + row.interval_minutes * 60_000
  ).toISOString();

  await env.DB.prepare(
    `INSERT INTO runs (
      id, monitor_id, checked_at, ok, changed, status, status_code,
      response_time_ms, hash, extracted_text, diff_summary, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      row.id,
      checkedAt.toISOString(),
      result.ok ? 1 : 0,
      result.changed ? 1 : 0,
      result.status,
      result.statusCode ?? null,
      result.responseTimeMs,
      result.hash ?? null,
      result.extractedText?.slice(0, 20_000) ?? null,
      result.diffSummary ?? null,
      result.error ?? null
    )
    .run();

  await env.DB.prepare(
    `UPDATE monitors
     SET last_hash = ?, last_status = ?, last_checked_at = ?, next_check_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      result.hash ?? row.last_hash,
      result.status,
      checkedAt.toISOString(),
      nextCheckAt,
      row.id
    )
    .run();

  return { monitorId: row.id, nextCheckAt, result };
}

function normalizeMonitorInput(input: Partial<MonitorConfig>): MonitorConfig {
  if (!input.url) {
    throw new Error("url is required");
  }

  const mode = input.mode ?? "page";

  if (!["uptime", "page", "field"].includes(mode)) {
    throw new Error("mode must be uptime, page, or field");
  }

  return {
    body: input.body,
    expectedStatus: input.expectedStatus,
    extractor: input.extractor,
    headers: input.headers,
    intervalMinutes: input.intervalMinutes ?? 60,
    method: input.method ?? "GET",
    mode,
    name: input.name,
    url: input.url
  };
}

function rowToMonitorConfig(row: MonitorRow): MonitorConfig {
  return {
    body: row.body ?? undefined,
    expectedStatus: row.expected_status ?? undefined,
    extractor: row.extractor_json
      ? (JSON.parse(row.extractor_json) as Extractor)
      : row.mode === "field"
        ? undefined
        : { type: "page" },
    headers: JSON.parse(row.headers_json) as Record<string, string>,
    intervalMinutes: row.interval_minutes,
    method: row.method,
    mode: row.mode,
    name: row.name,
    url: row.url
  };
}

function rowToMonitorView(row: MonitorRow): Record<string, unknown> {
  return {
    enabled: Boolean(row.enabled),
    id: row.id,
    intervalMinutes: row.interval_minutes,
    lastCheckedAt: row.last_checked_at,
    lastHash: row.last_hash,
    lastStatus: row.last_status,
    mode: row.mode,
    name: row.name,
    nextCheckAt: row.next_check_at,
    url: row.url
  };
}

function requireAuth(request: Request, env: Env): void {
  if (!env.WATCHLINE_ADMIN_TOKEN) {
    return;
  }

  const auth = request.headers.get("authorization");
  const token = request.headers.get("x-watchline-token");

  if (token === env.WATCHLINE_ADMIN_TOKEN || auth === `Bearer ${env.WATCHLINE_ADMIN_TOKEN}`) {
    return;
  }

  throw new Error("Unauthorized");
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    status
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}

function renderApp(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Watchline</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f7f4; color: #1d1d1b; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 18px; }
    header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
    h1 { font-size: 28px; margin: 0; letter-spacing: 0; }
    p { color: #5b5b55; margin: 6px 0 0; }
    form { display: grid; grid-template-columns: 1.2fr 2fr 140px 120px; gap: 8px; margin-bottom: 18px; }
    input, select, button { border: 1px solid #cbc8bd; border-radius: 6px; font: inherit; min-height: 38px; padding: 0 10px; background: #fff; color: #1d1d1b; }
    button { background: #1d1d1b; color: #fff; cursor: pointer; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dedbd2; }
    th, td { border-bottom: 1px solid #ebe8df; padding: 10px; text-align: left; vertical-align: top; font-size: 14px; }
    th { background: #efede5; font-size: 12px; text-transform: uppercase; color: #666158; }
    .status { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: #9b9488; }
    .up .dot { background: #12805c; }
    .down .dot { background: #b42318; }
    .actions { display: flex; gap: 6px; }
    .actions button { min-height: 30px; padding: 0 8px; font-size: 12px; }
    @media (max-width: 760px) { form { grid-template-columns: 1fr; } header { display: block; } table { display: block; overflow-x: auto; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Watchline</h1>
        <p>Serverless uptime and page-change monitoring.</p>
      </div>
    </header>
    <form id="monitor-form">
      <input name="name" placeholder="Name" required>
      <input name="url" placeholder="https://example.com" required>
      <select name="mode">
        <option value="page">Page diff</option>
        <option value="uptime">Uptime</option>
        <option value="field">Field</option>
      </select>
      <button>Add</button>
    </form>
    <table>
      <thead><tr><th>Name</th><th>URL</th><th>Mode</th><th>Status</th><th>Next check</th><th></th></tr></thead>
      <tbody id="monitors"><tr><td colspan="6">Loading...</td></tr></tbody>
    </table>
  </main>
  <script>
    const tbody = document.querySelector("#monitors");
    const form = document.querySelector("#monitor-form");
    const token = localStorage.getItem("watchline-token") || "";

    async function api(path, options = {}) {
      options.headers = { "content-type": "application/json", "x-watchline-token": token, ...(options.headers || {}) };
      const response = await fetch(path, options);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }

    async function load() {
      const monitors = await api("/api/monitors");
      tbody.innerHTML = monitors.length ? monitors.map((monitor) => {
        const status = monitor.lastStatus || "pending";
        return '<tr><td>' + escapeHtml(monitor.name) + '</td><td>' + escapeHtml(monitor.url) + '</td><td>' + monitor.mode + '</td><td><span class="status ' + status + '"><span class="dot"></span>' + status + '</span></td><td>' + (monitor.nextCheckAt || "") + '</td><td class="actions"><button data-check="' + monitor.id + '">Check</button><button data-delete="' + monitor.id + '">Delete</button></td></tr>';
      }).join("") : '<tr><td colspan="6">No monitors yet.</td></tr>';
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      await api("/api/monitors", { method: "POST", body: JSON.stringify(data) });
      form.reset();
      await load();
    });

    tbody.addEventListener("click", async (event) => {
      const target = event.target;
      if (target.dataset.check) await api("/api/monitors/" + target.dataset.check + "/check", { method: "POST" });
      if (target.dataset.delete) await api("/api/monitors/" + target.dataset.delete, { method: "DELETE" });
      await load();
    });

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
    }

    load().catch((error) => { tbody.innerHTML = '<tr><td colspan="6">' + escapeHtml(error.message) + '</td></tr>'; });
  </script>
</body>
</html>`;
}
