import { NextRequest } from "next/server";
import { getDb } from "../../../db";
import { gateReports } from "../../../db/schema";
import { desc, sql } from "drizzle-orm";
import crossingsData from "../../../public/jharkhand_level_crossings.json";

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      crossingId?: string;
      status?: "OPEN" | "CLOSED";
      latitude?: number;
      longitude?: number;
    };

    const crossingId = payload.crossingId;
    const status = payload.status;
    const latitude = payload.latitude;
    const longitude = payload.longitude;

    if (!crossingId || !status || latitude === undefined || longitude === undefined) {
      return Response.json({ error: "Missing required parameters" }, { status: 400 });
    }

    if (status !== "OPEN" && status !== "CLOSED") {
      return Response.json({ error: "Invalid status value" }, { status: 400 });
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return Response.json({ error: "Latitude and longitude must be valid coordinates" }, { status: 400 });
    }

    // This header gives clients a stable identifier for retry-safe reporting. A
    // Durable Object should enforce it globally in production; the edge route
    // also checks for an immediate duplicate to protect normal retries today.
    const idempotencyKey = request.headers.get("Idempotency-Key");

    // Find crossing coordinates
    const crossing = crossingsData.crossings.find((c) => c.id === crossingId);
    if (!crossing) {
      return Response.json({ error: "Crossing not found" }, { status: 404 });
    }

    const distance = haversineMeters(latitude, longitude, crossing.lat, crossing.lng);
    if (distance > 500) {
      return Response.json(
        { error: "Reporter is too far from the crossing (max 500m)" },
        { status: 400 }
      );
    }

    const db = getDb();
    if (idempotencyKey) {
      const duplicateCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const duplicate = await db
        .select()
        .from(gateReports)
        .where(sql`${gateReports.crossingId} = ${crossingId} AND ${gateReports.reportedStatus} = ${status} AND ${gateReports.createdAt} >= ${duplicateCutoff}`)
        .orderBy(desc(gateReports.createdAt))
        .limit(1);
      if (duplicate.length > 0) {
        return Response.json({ success: true, duplicate: true, report: duplicate[0] });
      }
    }
    const [inserted] = await db
      .insert(gateReports)
      .values({
        crossingId,
        reportedStatus: status,
        reporterLat: latitude,
        reporterLng: longitude,
        distanceMeters: distance,
        credibilityWeight: 1.0,
      })
      .returning();

    return Response.json({ success: true, report: inserted }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const crossingId = searchParams.get("crossingId");
    const hoursParam = searchParams.get("hours") || "1";
    const hours = parseInt(hoursParam, 10);

    if (!crossingId) {
      return Response.json({ error: "crossingId parameter is required" }, { status: 400 });
    }

    const db = getDb();
    const limitTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const reports = await db
      .select()
      .from(gateReports)
      .where(sql`${gateReports.crossingId} = ${crossingId} AND ${gateReports.createdAt} >= ${limitTime}`)
      .orderBy(desc(gateReports.createdAt));

    let openWeight = 0;
    let closedWeight = 0;

    for (const r of reports) {
      const weight = r.credibilityWeight ?? 1.0;
      if (r.reportedStatus === "OPEN") {
        openWeight += weight;
      } else if (r.reportedStatus === "CLOSED") {
        closedWeight += weight;
      }
    }

    const totalWeight = openWeight + closedWeight;
    const consensus = openWeight >= closedWeight ? "OPEN" : "CLOSED";
    const confidence = totalWeight > 0 ? Math.max(openWeight, closedWeight) / totalWeight : 0.5;

    return Response.json({
      crossingId,
      consensus,
      confidence: Math.round(confidence * 100) / 100,
      recentReports: reports,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
