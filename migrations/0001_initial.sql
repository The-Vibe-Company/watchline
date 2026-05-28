CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('uptime', 'page', 'field')),
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  enabled INTEGER NOT NULL DEFAULT 1,
  method TEXT NOT NULL DEFAULT 'GET',
  headers_json TEXT NOT NULL DEFAULT '{}',
  body TEXT,
  expected_status INTEGER,
  extractor_json TEXT,
  last_hash TEXT,
  last_status TEXT,
  last_checked_at TEXT,
  next_check_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS monitors_due_idx
  ON monitors (enabled, next_check_at);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  changed INTEGER NOT NULL,
  status TEXT NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER NOT NULL,
  hash TEXT,
  extracted_text TEXT,
  diff_summary TEXT,
  error TEXT,
  FOREIGN KEY (monitor_id) REFERENCES monitors (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS runs_monitor_checked_idx
  ON runs (monitor_id, checked_at DESC);
