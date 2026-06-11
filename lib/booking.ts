import { sql } from "./db";
import { addDays } from "./dates";
import { confirmationCode, reservationId } from "./ids";

export interface RoomAvailability {
  roomTypeId: string;
  code: string;
  name: string;
  description: string;
  capacity: number;
  available: number; // min over the requested nights
  totalCents: number; // sum of nightly rates for the stay
  nightsCovered: number;
}

// Availability for one night D = inventory.units_open(D) minus reservations
// covering D that are confirmed or still-live holds. Expired holds drop out
// by timestamp — no sweeper required for correctness.
export async function availabilityForHotel(
  hotelId: string,
  checkIn: string,
  nights: number,
): Promise<RoomAvailability[]> {
  const checkOut = addDays(checkIn, nights);
  const rows = (await sql`
    SELECT
      rt.id AS room_type_id,
      rt.code,
      rt.name,
      rt.description,
      rt.capacity,
      MIN(inv.units_open - used.cnt)::int AS available,
      SUM(inv.rate_cents)::int AS total_cents,
      COUNT(*)::int AS nights_covered
    FROM room_types rt
    JOIN inventory inv
      ON inv.room_type_id = rt.id
      AND inv.date >= ${checkIn} AND inv.date < ${checkOut}
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
      FROM reservations r
      WHERE r.room_type_id = rt.id
        AND r.check_in <= inv.date AND r.check_out > inv.date
        AND (r.status = 'confirmed' OR (r.status = 'hold' AND r.hold_expires_at > now()))
    ) used
    WHERE rt.hotel_id = ${hotelId}
    GROUP BY rt.id, rt.code, rt.name, rt.description, rt.capacity
    ORDER BY total_cents ASC
  `) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    roomTypeId: String(r.room_type_id),
    code: String(r.code),
    name: String(r.name),
    description: String(r.description),
    capacity: Number(r.capacity),
    available: Number(r.available),
    totalCents: Number(r.total_cents),
    nightsCovered: Number(r.nights_covered),
  }));
}

export interface HoldResult {
  ok: boolean;
  reason?: string;
  reservationId?: string;
  confirmationCode?: string;
  totalCents?: number;
  holdExpiresAt?: string;
}

// Guarded INSERT ... SELECT in one statement: the availability re-check and
// the insert happen atomically inside Postgres. The `lock` CTE takes a
// transaction-scoped advisory lock on the room type (a single statement IS
// a transaction on the Neon HTTP driver), so two simultaneous holds for the
// last room serialize: the second waits, then sees the first's row and fails
// the min_avail check instead of double-booking.
export async function createHold(args: {
  hotelId: string;
  roomTypeId: string;
  guestName: string;
  guestPhone: string | null;
  checkIn: string;
  nights: number;
  guests: number;
  currency: string;
}): Promise<HoldResult> {
  const checkOut = addDays(args.checkIn, args.nights);
  const id = reservationId();
  const code = confirmationCode();

  const rows = (await sql`
    WITH lock AS (
      SELECT pg_advisory_xact_lock(hashtext(${args.roomTypeId})) AS locked
    ),
    nights AS (
      SELECT inv.date, inv.units_open, inv.rate_cents,
        (SELECT COUNT(*)::int FROM reservations r
          WHERE r.room_type_id = ${args.roomTypeId}
            AND r.check_in <= inv.date AND r.check_out > inv.date
            AND (r.status = 'confirmed' OR (r.status = 'hold' AND r.hold_expires_at > now()))
        ) AS used
      FROM inventory inv, lock
      WHERE inv.room_type_id = ${args.roomTypeId}
        AND inv.date >= ${args.checkIn} AND inv.date < ${checkOut}
    ),
    ok AS (
      SELECT MIN(units_open - used) AS min_avail,
             SUM(rate_cents)::int AS total_cents,
             COUNT(*)::int AS n
      FROM nights
    )
    INSERT INTO reservations
      (id, hotel_id, room_type_id, status, guest_name, guest_phone,
       check_in, check_out, guests, total_cents, currency,
       confirmation_code, hold_expires_at)
    SELECT ${id}, ${args.hotelId}, ${args.roomTypeId}, 'hold', ${args.guestName}, ${args.guestPhone},
           ${args.checkIn}, ${checkOut}, ${args.guests}, ok.total_cents, ${args.currency},
           ${code}, now() + interval '30 minutes'
    FROM ok
    WHERE ok.min_avail > 0 AND ok.n = ${args.nights}
    RETURNING id, total_cents, confirmation_code, hold_expires_at
  `) as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    return { ok: false, reason: "no_availability" };
  }
  const r = rows[0];
  return {
    ok: true,
    reservationId: String(r.id),
    confirmationCode: String(r.confirmation_code),
    totalCents: Number(r.total_cents),
    holdExpiresAt: new Date(String(r.hold_expires_at)).toISOString(),
  };
}
