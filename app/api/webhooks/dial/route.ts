import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { calls, db, hotels } from "@/lib/db";
import { fetchCall, normalizeStatus } from "@/lib/dial";
import { logActivity } from "@/lib/activity";

export const maxDuration = 60;

// Dial webhooks are ACCOUNT-level: this endpoint also receives events for
// the caller-side concierge's outbound calls (same shared Dial account).
// We keep only events whose call terminates at one of OUR hotel lines.

function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.DIAL_WEBHOOK_SECRET;
  if (!secret) return true; // opt-in: set DIAL_WEBHOOK_SECRET to enforce
  const match = /t=(\d+),v1=([0-9a-f]+)/.exec(header ?? "");
  if (!match) return false;
  const [, timestamp, signature] = match;
  if (Math.abs(Date.now() - Number(timestamp) * 1000) > 5 * 60 * 1000) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return (
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"))
  );
}

async function hotelByLine(e164: string | null | undefined): Promise<string | null> {
  if (!e164) return null;
  const rows = await db
    .select({ id: hotels.id })
    .from(hotels)
    .where(eq(hotels.phoneE164, e164))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers.get("X-Dial-Signature"))) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const type = event.type ?? "unknown";
  const callId = event.data?.callId ? String(event.data.callId) : undefined;
  if (!callId || (type !== "call.ended" && type !== "call.transcribed")) {
    return Response.json({ received: true });
  }

  try {
    // The event payload is thin; the call object has direction/from/to/
    // transcript. Fetch it once and decide ownership from `to`.
    const call = await fetchCall(callId);
    if (call.direction !== "inbound") return Response.json({ received: true, ignored: "outbound" });
    const hotelId = await hotelByLine(call.to);
    if (!hotelId) return Response.json({ received: true, ignored: "not a hotel line" });

    const { status } = normalizeStatus(call.status);
    const endedAt = call.terminatedAt ? new Date(call.terminatedAt) : type === "call.ended" ? new Date() : null;

    await db
      .insert(calls)
      .values({
        id: call.id,
        hotelId,
        direction: "inbound",
        fromE164: call.from ?? null,
        toE164: call.to ?? null,
        status,
        durationSeconds: call.duration ?? null,
        transcript: call.transcript ?? null,
        endedAt,
        raw: { lastEvent: type },
      })
      .onConflictDoUpdate({
        target: calls.id,
        set: {
          status,
          durationSeconds: call.duration ?? null,
          transcript: call.transcript ?? null,
          ...(endedAt ? { endedAt } : {}),
          raw: { lastEvent: type },
        },
      });

    if (type === "call.ended") {
      void logActivity({ hotelId, kind: "call_ended", callerE164: call.from ?? null, detail: { status } });
    }
  } catch (err) {
    // Ack anyway: Dial retries failed deliveries and the dashboard data is
    // best-effort; a failed enrich shouldn't poison the retry queue.
    console.warn("webhook: processing failed:", (err as Error).message);
  }

  return Response.json({ received: true });
}
