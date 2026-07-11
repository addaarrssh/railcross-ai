CREATE TABLE IF NOT EXISTS gate_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crossing_id TEXT NOT NULL,
  reported_status TEXT NOT NULL,
  reporter_lat REAL,
  reporter_lng REAL,
  distance_meters REAL,
  credibility_weight REAL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS route_polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crossing_id TEXT NOT NULL,
  static_duration_seconds REAL,
  traffic_duration_seconds REAL,
  traffic_delay_seconds REAL,
  approach_a_speed_kph REAL,
  approach_b_speed_kph REAL,
  data_source TEXT DEFAULT 'routes_api',
  polled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS predictions_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crossing_id TEXT NOT NULL,
  predicted_status TEXT NOT NULL,
  closed_probability REAL NOT NULL,
  adjusted_probability REAL,
  features_json TEXT,
  data_source TEXT NOT NULL,
  verified_status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS model_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  total_predictions INTEGER,
  verified_predictions INTEGER,
  accuracy REAL,
  precision_score REAL,
  recall REAL,
  f1_score REAL,
  drift_detected INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS crossing_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crossing_id TEXT NOT NULL,
  date TEXT NOT NULL,
  hour INTEGER NOT NULL,
  closure_count INTEGER DEFAULT 0,
  total_closure_minutes REAL DEFAULT 0,
  avg_closure_duration REAL DEFAULT 0,
  report_count INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS train_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crossing_id TEXT NOT NULL,
  train_number TEXT NOT NULL,
  train_name TEXT,
  expected_time TEXT NOT NULL,
  days_of_week TEXT NOT NULL,
  avg_closure_minutes REAL DEFAULT 8,
  is_active INTEGER DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  keys_json TEXT NOT NULL,
  crossing_ids TEXT,
  alert_on_close INTEGER DEFAULT 1,
  alert_on_open INTEGER DEFAULT 0,
  commute_time TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_notified_at TEXT
);

CREATE INDEX IF NOT EXISTS gate_reports_crossing_created_at
ON gate_reports (crossing_id, created_at);

CREATE INDEX IF NOT EXISTS predictions_log_crossing_created_at
ON predictions_log (crossing_id, created_at);
