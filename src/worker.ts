import { runCheck } from "./index";
import type { Extractor, MonitorConfig, MonitorMode, PreviousCheck } from "./index";

export interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
  WATCHLINE_ADMIN_TOKEN?: string;
  WATCHLINE_EMAIL_FROM?: string;
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
  webhook_url: string | null;
  notification_email: string | null;
  notify_events: string;
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
        body, expected_status, extractor_json, webhook_url, notification_email,
        notify_events, next_check_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        monitor.webhookUrl ?? null,
        monitor.notificationEmail ?? null,
        (monitor.notifyEvents ?? ["changed", "down", "recovered"]).join(","),
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
  const runId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO runs (
      id, monitor_id, checked_at, ok, changed, status, status_code,
      response_time_ms, hash, extracted_text, diff_summary, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      runId,
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

  const event = notificationEvent(row, result);
  const notification = event
    ? await sendNotification(env, row, result, event, checkedAt.toISOString())
    : { sent: false };

  if (event) {
    await env.DB.prepare(
      "UPDATE runs SET notification_sent = ?, notification_error = ? WHERE id = ?"
    )
      .bind(notification.sent ? 1 : 0, notification.error ?? null, runId)
      .run();
  }

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
    notificationEmail: input.notificationEmail,
    notifyEvents: input.notifyEvents,
    url: input.url,
    webhookUrl: input.webhookUrl
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
    notificationEmail: row.notification_email ?? undefined,
    notifyEvents: row.notify_events.split(",").filter(Boolean),
    url: row.url,
    webhookUrl: row.webhook_url ?? undefined
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
    notifyEvents: row.notify_events.split(",").filter(Boolean),
    emailConfigured: Boolean(row.notification_email),
    url: row.url,
    webhookConfigured: Boolean(row.webhook_url)
  };
}

function notificationEvent(
  row: MonitorRow,
  result: Awaited<ReturnType<typeof runCheck>>
): "changed" | "down" | "recovered" | undefined {
  const events = new Set(row.notify_events.split(",").filter(Boolean));

  if (result.changed && events.has("changed")) {
    return "changed";
  }

  if (result.status === "down" && row.last_status !== "down" && events.has("down")) {
    return "down";
  }

  if (result.status === "up" && row.last_status === "down" && events.has("recovered")) {
    return "recovered";
  }

  return undefined;
}

async function sendNotification(
  env: Env,
  row: MonitorRow,
  result: Awaited<ReturnType<typeof runCheck>>,
  event: "changed" | "down" | "recovered",
  checkedAt: string
): Promise<{ sent: boolean; error?: string }> {
  if (!row.webhook_url && !row.notification_email) {
    return { sent: false };
  }

  const text = notificationText(row, result, event);
  const errors: string[] = [];
  let sent = false;

  if (row.webhook_url) {
    const webhook = await sendWebhook(row.webhook_url, row, result, event, checkedAt, text);
    sent ||= webhook.sent;
    if (webhook.error) {
      errors.push(webhook.error);
    }
  }

  if (row.notification_email) {
    const email = await sendEmail(env, row.notification_email, text, row, result, event);
    sent ||= email.sent;
    if (email.error) {
      errors.push(email.error);
    }
  }

  return {
    sent,
    error: errors.length ? errors.join("; ") : undefined
  };
}

async function sendWebhook(
  webhookUrl: string,
  row: MonitorRow,
  result: Awaited<ReturnType<typeof runCheck>>,
  event: "changed" | "down" | "recovered",
  checkedAt: string,
  text: string
): Promise<{ sent: boolean; error?: string }> {
  const payload = {
    text,
    content: text,
    event,
    checkedAt,
    monitor: {
      id: row.id,
      name: row.name,
      url: row.url,
      mode: row.mode
    },
    result: {
      changed: result.changed,
      diffSummary: result.diffSummary,
      error: result.error,
      hash: result.hash,
      responseTimeMs: result.responseTimeMs,
      status: result.status,
      statusCode: result.statusCode
    }
  };

  try {
    const response = await fetch(webhookUrl, {
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
        "user-agent": "watchline/0.2"
      },
      method: "POST"
    });

    if (!response.ok) {
      return {
        sent: false,
        error: `webhook returned ${response.status}`
      };
    }

    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      error: `webhook failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function sendEmail(
  env: Env,
  to: string,
  text: string,
  row: MonitorRow,
  result: Awaited<ReturnType<typeof runCheck>>,
  event: "changed" | "down" | "recovered"
): Promise<{ sent: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) {
    return { sent: false, error: "RESEND_API_KEY is missing" };
  }

  if (!env.WATCHLINE_EMAIL_FROM) {
    return { sent: false, error: "WATCHLINE_EMAIL_FROM is missing" };
  }

  const subject = `Watchline: ${row.name} ${event}`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      body: JSON.stringify({
        from: env.WATCHLINE_EMAIL_FROM,
        to: [to],
        subject,
        text,
        html: emailHtml(text, row, result, event)
      }),
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json"
      },
      method: "POST"
    });

    if (!response.ok) {
      return {
        sent: false,
        error: `resend returned ${response.status}: ${await response.text()}`
      };
    }

    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      error: `resend failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function emailHtml(
  text: string,
  row: MonitorRow,
  result: Awaited<ReturnType<typeof runCheck>>,
  event: "changed" | "down" | "recovered"
): string {
  return `<!doctype html>
<html>
<body style="font-family:Inter,Arial,sans-serif;line-height:1.5;color:#1d1d1b">
  <h2 style="margin:0 0 12px">Watchline: ${escapeHtml(row.name)} ${event}</h2>
  <p><a href="${escapeHtml(row.url)}">${escapeHtml(row.url)}</a></p>
  <ul>
    <li>Status: ${escapeHtml(result.status)}</li>
    <li>HTTP: ${escapeHtml(String(result.statusCode ?? "-"))}</li>
    <li>Response time: ${escapeHtml(String(result.responseTimeMs))}ms</li>
  </ul>
  <pre style="white-space:pre-wrap;background:#f6f6f3;padding:12px;border-radius:6px">${escapeHtml(text)}</pre>
</body>
</html>`;
}

function notificationText(
  row: MonitorRow,
  result: Awaited<ReturnType<typeof runCheck>>,
  event: "changed" | "down" | "recovered"
): string {
  const label =
    event === "changed"
      ? "changed"
      : event === "down"
        ? "is down"
        : "recovered";
  const status = result.statusCode ? `HTTP ${result.statusCode}` : result.status;
  const suffix = result.diffSummary ? `\n\n${result.diffSummary}` : "";

  return `Watchline: ${row.name} ${label} (${status}, ${result.responseTimeMs}ms)\n${row.url}${suffix}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    };

    return entities[char] ?? char;
  });
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
    form { display: grid; grid-template-columns: 1fr 1.8fr 130px 1.5fr 1.2fr 110px; gap: 8px; margin-bottom: 18px; }
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
      <input name="webhookUrl" placeholder="Webhook URL">
      <input name="notificationEmail" placeholder="Email">
      <button>Add</button>
    </form>
    <table>
      <thead><tr><th>Name</th><th>URL</th><th>Mode</th><th>Status</th><th>Notify</th><th>Next check</th><th></th></tr></thead>
      <tbody id="monitors"><tr><td colspan="7">Loading...</td></tr></tbody>
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
        const notify = [monitor.webhookConfigured ? 'Webhook' : '', monitor.emailConfigured ? 'Email' : ''].filter(Boolean).join(', ') || '-';
        return '<tr><td>' + escapeHtml(monitor.name) + '</td><td>' + escapeHtml(monitor.url) + '</td><td>' + monitor.mode + '</td><td><span class="status ' + status + '"><span class="dot"></span>' + status + '</span></td><td>' + notify + '</td><td>' + (monitor.nextCheckAt || "") + '</td><td class="actions"><button data-check="' + monitor.id + '">Check</button><button data-delete="' + monitor.id + '">Delete</button></td></tr>';
      }).join("") : '<tr><td colspan="7">No monitors yet.</td></tr>';
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
