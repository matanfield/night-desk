import { desc, sql as dsql } from "drizzle-orm";
import { activity, calls, db, hotels, reservations, sql } from "@/lib/db";
import { localNow, tonightDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

// Mission-control poll: one payload with everything the network view needs.
// "On a call" = any MCP tool activity in the last 90 seconds (Dial emits no
// call-started event, so tool traffic IS the live signal).
export async function GET() {
  const tz = "Europe/Lisbon";
  const tonight = tonightDate(tz);

  const [tonightRows, liveRows, feed, recentReservations, recentCalls] = await Promise.all([
    sql`
      SELECT h.id,
        SUM(GREATEST(inv.units_open - used.cnt, 0))::int AS rooms_tonight,
        MIN(inv.rate_cents) FILTER (WHERE inv.units_open - used.cnt > 0)::int AS from_cents
      FROM hotels h
      JOIN room_types rt ON rt.hotel_id = h.id
      JOIN inventory inv ON inv.room_type_id = rt.id AND inv.date = ${tonight}
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt FROM reservations r
        WHERE r.room_type_id = rt.id
          AND r.check_in <= inv.date AND r.check_out > inv.date
          AND (r.status = 'confirmed' OR (r.status = 'hold' AND r.hold_expires_at > now()))
      ) used
      GROUP BY h.id
    ` as Promise<Array<Record<string, unknown>>>,
    sql`
      SELECT DISTINCT ON (hotel_id) hotel_id, kind, created_at
      FROM activity
      WHERE hotel_id IS NOT NULL
      ORDER BY hotel_id, created_at DESC
    ` as Promise<Array<Record<string, unknown>>>,
    db
      .select({
        kind: activity.kind,
        hotelId: activity.hotelId,
        createdAt: activity.createdAt,
        detail: activity.detail,
      })
      .from(activity)
      .orderBy(desc(activity.createdAt))
      .limit(20),
    db
      .select({
        id: reservations.id,
        hotelId: reservations.hotelId,
        status: reservations.status,
        guestName: reservations.guestName,
        checkIn: reservations.checkIn,
        checkOut: reservations.checkOut,
        totalCents: reservations.totalCents,
        confirmationCode: reservations.confirmationCode,
        holdExpiresAt: reservations.holdExpiresAt,
        source: reservations.source,
        createdAt: reservations.createdAt,
      })
      .from(reservations)
      .where(dsql`${reservations.source} = 'ai_receptionist'`)
      .orderBy(desc(reservations.createdAt))
      .limit(12),
    db
      .select({
        id: calls.id,
        hotelId: calls.hotelId,
        status: calls.status,
        durationSeconds: calls.durationSeconds,
        endedAt: calls.endedAt,
        hasTranscript: dsql<boolean>`${calls.transcript} IS NOT NULL`,
      })
      .from(calls)
      .orderBy(desc(calls.createdAt))
      .limit(8),
  ]);

  const allHotels = await db
    .select({
      id: hotels.id,
      name: hotels.name,
      neighborhood: hotels.neighborhood,
      stars: hotels.stars,
      isLive: hotels.isLive,
      phoneE164: hotels.phoneE164,
      occupancyProfile: hotels.occupancyProfile,
    })
    .from(hotels)
    .orderBy(desc(hotels.isLive), hotels.name);

  const tonightBy = new Map(tonightRows.map((r) => [String(r.id), r]));
  const liveBy = new Map(liveRows.map((r) => [String(r.hotel_id), r]));
  const nowMs = Date.now();

  return Response.json({
    now: localNow(tz).pretty,
    tonight,
    hotels: allHotels.map((h) => {
      const t = tonightBy.get(h.id);
      const l = liveBy.get(h.id);
      const lastSeenMs = l ? new Date(String(l.created_at)).getTime() : null;
      return {
        ...h,
        roomsTonight: t ? Number(t.rooms_tonight) : 0,
        fromCents: t?.from_cents == null ? null : Number(t.from_cents),
        lastKind: l ? String(l.kind) : null,
        lastSeenSecs: lastSeenMs ? Math.round((nowMs - lastSeenMs) / 1000) : null,
        onCall: lastSeenMs !== null && nowMs - lastSeenMs < 90_000 && String(l!.kind) !== "call_ended",
      };
    }),
    feed,
    reservations: recentReservations,
    calls: recentCalls,
  });
}
