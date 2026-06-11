/* One-time (re-runnable) injection of the imaginary hotel network.
 *
 * Reads data/hotels.json (generated synthetically), wipes the business
 * tables, and rebuilds: hotels, room types, 21 nights of inventory with
 * deterministic rates/occupancy, and the Q&A handbook. Dial line wiring
 * (phone_number_id / phone_e164 / is_live) survives re-seeding.
 *
 * Run: pnpm seed
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  // Imported after dotenv so DATABASE_URL is set when lib/db initializes.
  const { db, sql, hotels, roomTypes, inventory, hotelFacts } = await import("../lib/db");
  const { seededRandom } = await import("../lib/ids");
  const { addDays, tonightDate } = await import("../lib/dates");

  interface HotelJson {
    slug: string;
    name: string;
    archetype: string;
    neighborhood: string;
    address: string;
    stars: number;
    short_description: string;
    long_description: string;
    occupancy_profile: "sold_out_tonight" | "scarce_tonight" | "available";
    policies: Record<string, string>;
    amenities: string[];
    persona: { style: string; greeting: string; speech_quirks: string; escalation_line: string };
    room_types: Array<{
      code: string;
      name: string;
      description: string;
      capacity: number;
      base_rate_eur: number;
      total_units: number;
      features: string[];
    }>;
    facts: Array<{ topic: string; question: string; answer: string }>;
  }

  const data: HotelJson[] = JSON.parse(
    readFileSync(join(process.cwd(), "data", "hotels.json"), "utf8"),
  );
  console.log(`Seeding ${data.length} hotels...`);

  // Preserve Dial line wiring across re-seeds.
  const wiring = (await sql`
    SELECT id, phone_number_id, phone_e164, is_live FROM hotels WHERE phone_number_id IS NOT NULL
  `) as Array<{ id: string; phone_number_id: string; phone_e164: string; is_live: boolean }>;

  await sql`TRUNCATE hotels, room_types, inventory, reservations, calls, hotel_facts, messages, activity CASCADE`;

  const tonight = tonightDate("Europe/Lisbon");
  const NIGHTS = 21;

  for (const h of data) {
    const wired = wiring.find((w) => w.id === h.slug);
    await db.insert(hotels).values({
      id: h.slug,
      name: h.name,
      archetype: h.archetype,
      neighborhood: h.neighborhood,
      address: h.address,
      stars: h.stars,
      shortDescription: h.short_description,
      longDescription: h.long_description,
      occupancyProfile: h.occupancy_profile,
      persona: h.persona,
      policies: h.policies as typeof hotels.$inferInsert.policies,
      amenities: h.amenities,
      phoneNumberId: wired?.phone_number_id ?? null,
      phoneE164: wired?.phone_e164 ?? null,
      isLive: wired?.is_live ?? false,
    });

    const cheapest = [...h.room_types].sort((a, b) => a.base_rate_eur - b.base_rate_eur)[0];

    for (const rt of h.room_types) {
      const rtId = `${h.slug}:${rt.code}`;
      await db.insert(roomTypes).values({
        id: rtId,
        hotelId: h.slug,
        code: rt.code,
        name: rt.name,
        description: rt.description,
        capacity: rt.capacity,
        baseRateCents: rt.base_rate_eur * 100,
        totalUnits: rt.total_units,
        features: rt.features,
      });

      const rows: Array<typeof inventory.$inferInsert> = [];
      for (let day = 0; day < NIGHTS; day++) {
        const date = addDays(tonight, day);
        const rng = seededRandom(`${h.slug}:${rt.code}:${date}`);

        // Weekend bump + mild noise, rounded to whole euros.
        const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
        const weekend = dow === 5 || dow === 6;
        const rate = Math.round(rt.base_rate_eur * (weekend ? 1.18 : 1) * (0.95 + rng() * 0.2));

        // Occupancy: tonight is scripted by the demo profile, later nights relax.
        let open: number;
        if (day === 0) {
          if (h.occupancy_profile === "sold_out_tonight") open = 0;
          else if (h.occupancy_profile === "scarce_tonight")
            open = rt.code === cheapest.code ? 1 : 0;
          else open = Math.max(1, Math.round(rt.total_units * (0.25 + rng() * 0.35)));
        } else if (day <= 2 && h.occupancy_profile !== "available") {
          open = Math.round(rt.total_units * rng() * 0.25);
        } else {
          open = Math.max(1, Math.round(rt.total_units * (0.2 + rng() * 0.5)));
        }

        rows.push({ roomTypeId: rtId, date, unitsOpen: open, rateCents: rate * 100 });
      }
      await db.insert(inventory).values(rows);
    }

    await db.insert(hotelFacts).values(
      h.facts.map((f) => ({
        hotelId: h.slug,
        topic: f.topic,
        question: f.question,
        answer: f.answer,
        source: "handbook",
      })),
    );

    console.log(
      `  ${h.slug.padEnd(26)} ${h.occupancy_profile.padEnd(17)} rooms:${h.room_types.length} facts:${h.facts.length}${wired ? `  line:${wired.phone_e164}` : ""}`,
    );
  }

  const counts = (await sql`
    SELECT (SELECT COUNT(*) FROM hotels) AS hotels,
           (SELECT COUNT(*) FROM room_types) AS room_types,
           (SELECT COUNT(*) FROM inventory) AS inventory,
           (SELECT COUNT(*) FROM hotel_facts) AS facts
  `) as Array<Record<string, unknown>>;
  console.log("Done:", counts[0]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
