import { activity, db } from "./db";

// Dial emits no event when an inbound call STARTS — only call.ended later.
// Tool calls are therefore the dashboard's only live signal: every one of
// them lands here, and mission control treats "activity in the last 90s"
// as "on a call right now".
export async function logActivity(args: {
  hotelId: string | null;
  kind: string;
  callerE164?: string | null;
  detail?: unknown;
}): Promise<void> {
  try {
    await db.insert(activity).values({
      hotelId: args.hotelId,
      kind: args.kind,
      callerE164: args.callerE164 ?? null,
      detail: args.detail ?? null,
    });
  } catch (err) {
    // Telemetry must never break a live phone call.
    console.warn("activity log failed:", (err as Error).message);
  }
}
