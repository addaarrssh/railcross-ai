import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, real } from "drizzle-orm/sqlite-core";

export const gateReports = sqliteTable("gate_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  crossingId: text("crossing_id").notNull(),
  reportedStatus: text("reported_status").notNull(), // "OPEN" or "CLOSED"
  reporterLat: real("reporter_lat"),
  reporterLng: real("reporter_lng"),
  distanceMeters: real("distance_meters"),
  credibilityWeight: real("credibility_weight").default(1.0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const routePolls = sqliteTable("route_polls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  crossingId: text("crossing_id").notNull(),
  staticDurationSeconds: real("static_duration_seconds"),
  trafficDurationSeconds: real("traffic_duration_seconds"),
  trafficDelaySeconds: real("traffic_delay_seconds"),
  approachASpeedKph: real("approach_a_speed_kph"),
  approachBSpeedKph: real("approach_b_speed_kph"),
  dataSource: text("data_source").default("routes_api"),
  polledAt: text("polled_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const predictionsLog = sqliteTable("predictions_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  crossingId: text("crossing_id").notNull(),
  predictedStatus: text("predicted_status").notNull(),
  closedProbability: real("closed_probability").notNull(),
  adjustedProbability: real("adjusted_probability"),
  featuresJson: text("features_json"),
  dataSource: text("data_source").notNull(), // "synthetic", "routes_api", "crowdsource"
  verifiedStatus: text("verified_status"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const modelMetrics = sqliteTable("model_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  windowStart: text("window_start").notNull(),
  windowEnd: text("window_end").notNull(),
  totalPredictions: integer("total_predictions"),
  verifiedPredictions: integer("verified_predictions"),
  accuracy: real("accuracy"),
  precisionScore: real("precision_score"),
  recall: real("recall"),
  f1Score: real("f1_score"),
  driftDetected: integer("drift_detected").default(0), // 0=false, 1=true
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crossingHistory = sqliteTable("crossing_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  crossingId: text("crossing_id").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  hour: integer("hour").notNull(), // 0-23
  closureCount: integer("closure_count").default(0),
  totalClosureMinutes: real("total_closure_minutes").default(0),
  avgClosureDuration: real("avg_closure_duration").default(0),
  reportCount: integer("report_count").default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const trainSchedules = sqliteTable("train_schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  crossingId: text("crossing_id").notNull(),
  trainNumber: text("train_number").notNull(),
  trainName: text("train_name"),
  expectedTime: text("expected_time").notNull(), // HH:MM
  daysOfWeek: text("days_of_week").notNull(), // JSON array of numbers
  avgClosureMinutes: real("avg_closure_minutes").default(8),
  isActive: integer("is_active").default(1), // 0=false, 1=true
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  endpoint: text("endpoint").notNull().unique(),
  keysJson: text("keys_json").notNull(), // JSON with p256dh and auth keys
  crossingIds: text("crossing_ids"), // JSON array of crossing IDs, null = all
  alertOnClose: integer("alert_on_close").default(1),
  alertOnOpen: integer("alert_on_open").default(0),
  commuteTime: text("commute_time"), // HH:MM
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastNotifiedAt: text("last_notified_at"),
});
