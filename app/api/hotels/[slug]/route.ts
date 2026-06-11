import { asc, desc, eq } from "drizzle-orm";
import {
  calls,
  db,
  hotelFacts,
  hotels,
  messages,
  reservations,
  roomTypes,
  sql,
} from "@/lib/db";
import { addDays, tonightDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

const GRID_DAYS = 14;

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const hotelRows = await db.select().from(hotels).where(eq(hotels.id, slug)).limit(1);
  if (hotelRows.length === 0) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const hotel = hotelRows[0];
  const tonight = tonightDate(hotel.timezone);
  const gridEnd = addDays(tonight, GRID_DAYS);

  const [rooms, grid, resRows, callRows, factRows, messageRows] = await Promise.all([
    db.select().from(roomTypes).where(eq(roomTypes.hotelId, slug)).orderBy(asc(roomTypes.baseRateCents)),
    sql`
      SELECT rt.id AS room_type_id, inv.date::text AS date,
        (inv.units_open - used.cnt)::int AS available,
        inv.rate_cents
      FROM room_types rt
      JOIN inventory inv ON inv.room_type_id = rt.id
        AND inv.date >= ${tonight} AND inv.date < ${gridEnd}
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt FROM reservations r
        WHERE r.room_type_id = rt.id
          AND r.check_in <= inv.date AND r.check_out > inv.date
          AND (r.status = 'confirmed' OR (r.status = 'hold' AND r.hold_expires_at > now()))
      ) used
      WHERE rt.hotel_id = ${slug}
      ORDER BY inv.date
    ` as Promise<Array<Record<string, unknown>>>,
    db.select().from(reservations).where(eq(reservations.hotelId, slug)).orderBy(desc(reservations.createdAt)).limit(30),
    db
      .select({
        id: calls.id,
        status: calls.status,
        fromE164: calls.fromE164,
        durationSeconds: calls.durationSeconds,
        transcript: calls.transcript,
        createdAt: calls.createdAt,
        endedAt: calls.endedAt,
      })
      .from(calls)
      .where(eq(calls.hotelId, slug))
      .orderBy(desc(calls.createdAt))
      .limit(20),
    db.select().from(hotelFacts).where(eq(hotelFacts.hotelId, slug)).orderBy(asc(hotelFacts.topic)),
    db.select().from(messages).where(eq(messages.hotelId, slug)).orderBy(desc(messages.createdAt)).limit(20),
  ]);

  return Response.json({
    hotel,
    tonight,
    rooms,
    grid,
    reservations: resRows,
    calls: callRows,
    facts: factRows,
    messages: messageRows,
  });
}
