/* Provisions Dial phone lines for the "live" hotels and compiles each
 * hotel's persona into its number's inboundInstruction.
 *
 * Usage:
 *   pnpm provision                       # the 3 default demo hotels
 *   pnpm provision the-fado-house        # add/refresh specific slugs
 *
 * Buying a number costs Dial credit — the default list stays small.
 * Re-running PATCHes instructions on already-wired hotels (no new cost).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const DEFAULT_LIVE = [
  "hotel-miradouro-azul", // the winner: rooms tonight at fair prices
  "pensao-estrela-do-tejo", // sold out tonight
  "grande-hotel-lusitania", // available but expensive
];

async function main() {
  const { db, hotels, roomTypes } = await import("../lib/db");
  const { buildInboundInstruction } = await import("../lib/persona");
  const { purchaseNumber, updateNumber } = await import("../lib/dial");
  const { eq } = await import("drizzle-orm");

  const slugs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_LIVE;

  for (const slug of slugs) {
    const hotelRows = await db.select().from(hotels).where(eq(hotels.id, slug)).limit(1);
    if (hotelRows.length === 0) {
      console.error(`SKIP ${slug}: not in DB (run pnpm seed first)`);
      continue;
    }
    const hotel = hotelRows[0];
    const rooms = await db.select().from(roomTypes).where(eq(roomTypes.hotelId, slug));
    const instruction = buildInboundInstruction(hotel, rooms);
    console.log(`${slug}: instruction ${instruction.length} chars`);

    if (hotel.phoneNumberId) {
      await updateNumber(hotel.phoneNumberId, {
        inboundInstruction: instruction,
        nickname: `Night Desk — ${hotel.name}`,
      });
      console.log(`  PATCHED ${hotel.phoneE164}`);
    } else {
      const num = await purchaseNumber({
        inboundInstruction: instruction,
        nickname: `Night Desk — ${hotel.name}`,
        country: "US",
      });
      await db
        .update(hotels)
        .set({ phoneNumberId: num.id, phoneE164: num.number, isLive: true })
        .where(eq(hotels.id, slug));
      console.log(`  PURCHASED ${num.number} (${num.id})`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
