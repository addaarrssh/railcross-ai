import { NextRequest } from "next/server";
import { getDb } from "../../../db";
import { crossingHistory } from "../../../db/schema";
import { eq } from "drizzle-orm";
import predictionsData from "../../../public/jharkhand_crossing_predictions.json";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const crossingId = searchParams.get("crossingId");

    const db = getDb();
    let rows;
    if (crossingId) {
      rows = await db.select().from(crossingHistory).where(eq(crossingHistory.crossingId, crossingId));
    } else {
      rows = await db.select().from(crossingHistory);
    }

    if (rows && rows.length > 0) {
      return Response.json({ crossings: rows });
    }

    // Explicit demo fallback: these are not historical observations.
    const crossings = predictionsData.crossings || [];
    const mockCrossings = crossings
      .filter((c) => !crossingId || c.id === crossingId)
      .map((c) => {
        // Generate deterministic mock numbers based on crossing ID characters
        const hash = c.id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const closuresCount = (hash % 5) + 2;
        const avgDuration = (hash % 10) + 6; // minutes
        const reportCount = (hash % 15) + 3;

        return {
          id: hash,
          crossingId: c.id,
          date: new Date().toISOString().split("T")[0],
          hour: 8,
          closureCount: closuresCount,
          totalClosureMinutes: closuresCount * avgDuration,
          avgClosureDuration: avgDuration,
          reportCount: reportCount,
          updatedAt: new Date().toISOString(),
        };
      });

    return Response.json({ crossings: mockCrossings, data_mode: "synthetic_demo" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
