import { getDb } from "../../../db";
import { predictionsLog } from "../../../db/schema";
import predictionsData from "../../../public/jharkhand_crossing_predictions.json";

export async function GET() {
  try {
    const db = getDb();
    
    // Demo data must never be represented as operational telemetry. Logging is
    // deliberately best-effort and does not change the returned prediction set.
    void (async () => {
      try {
        const crossings = predictionsData.crossings || [];
        for (const crossing of crossings) {
          const features = crossing.traffic_snapshot || {};
          await db.insert(predictionsLog).values({
            crossingId: crossing.id,
            predictedStatus: crossing.prediction.predicted_status,
            closedProbability: crossing.prediction.closed_probability,
            adjustedProbability: crossing.prediction.closed_probability, // default same as closed_probability initially
            featuresJson: JSON.stringify(features),
            dataSource: "synthetic",
          });
        }
      } catch (err) {
        console.error("Failed to log predictions to database:", err);
      }
    })();

    return Response.json({ ...predictionsData, data_mode: "synthetic_demo" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
