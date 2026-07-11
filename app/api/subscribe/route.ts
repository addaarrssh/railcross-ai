import { getDb } from "../../../db";
import { pushSubscriptions } from "../../../db/schema";
import { eq } from "drizzle-orm";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      endpoint?: string;
      keys?: {
        p256dh: string;
        auth: string;
      };
      crossingIds?: string[];
      commuteTime?: string;
      alertOnClose?: number;
      alertOnOpen?: number;
    };

    const endpoint = payload.endpoint;
    const keys = payload.keys;

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return Response.json({ error: "Missing required subscription parameters" }, { status: 400 });
    }

    const db = getDb();

    // Check if subscription already exists
    const existing = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .limit(1);

    const values = {
      endpoint,
      keysJson: JSON.stringify(keys),
      crossingIds: payload.crossingIds ? JSON.stringify(payload.crossingIds) : null,
      commuteTime: payload.commuteTime || null,
      alertOnClose: payload.alertOnClose !== undefined ? payload.alertOnClose : 1,
      alertOnOpen: payload.alertOnOpen !== undefined ? payload.alertOnOpen : 0,
    };

    let resultId;

    if (existing.length > 0) {
      // Update
      await db
        .update(pushSubscriptions)
        .set(values)
        .where(eq(pushSubscriptions.endpoint, endpoint));
      resultId = existing[0].id;
    } else {
      // Insert
      const [inserted] = await db.insert(pushSubscriptions).values(values).returning();
      resultId = inserted.id;
    }

    return Response.json({ success: true, subscriptionId: resultId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = (await request.json()) as {
      endpoint?: string;
    };

    const endpoint = payload.endpoint;
    if (!endpoint) {
      return Response.json({ error: "Missing endpoint parameter" }, { status: 400 });
    }

    const db = getDb();
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));

    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
