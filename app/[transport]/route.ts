import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, messages, roomTypes } from "@/lib/db";
import { availabilityForHotel, createHold, recordPaymentLink } from "@/lib/booking";
import { createReservationCheckout, stripeEnabled } from "@/lib/stripe";
import { sendSms } from "@/lib/dial";
import { localNow, prettyDate, resolveCheckIn, tonightDate, addDays, eur } from "@/lib/dates";
import { lookupFacts } from "@/lib/facts";
import { logActivity } from "@/lib/activity";
import { checkSharedSecret, resolveTenant, type TenantContext } from "@/lib/tenant";

export const maxDuration = 60;

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}
function refuse(s: string) {
  return { content: [{ type: "text" as const, text: s }], isError: true };
}

// One fresh McpServer per request (stateless Streamable HTTP), with the
// tenant context resolved from this request's X-Dial-* headers closed over
// by every tool. Dial's tool-discovery probe carries no call headers —
// tools/list works fine; tools/call without a valid inbound tenant refuses.
function buildHandler(ctx: TenantContext) {
  return createMcpHandler(
    (server) => {
      const hotel = ctx.hotel;

      server.registerTool(
        "get_hotel_info",
        {
          title: "Get hotel info",
          description:
            "ONLY for the AI receptionist during an inbound call to a hotel reception line. " +
            "Call this once at the START of every call: returns the hotel's identity, the current " +
            "local date and time, what 'tonight' means as a check-in date, and the room-type summary.",
          inputSchema: {},
        },
        async () => {
          if (!hotel) return refuse(ctx.refusal);
          const now = localNow(hotel.timezone);
          const tonight = tonightDate(hotel.timezone);
          const rooms = await db
            .select()
            .from(roomTypes)
            .where(eq(roomTypes.hotelId, hotel.id));
          void logActivity({
            hotelId: hotel.id,
            kind: "get_hotel_info",
            callerE164: ctx.callerE164,
          });
          return text(
            [
              `${hotel.name} — ${hotel.stars}-star ${hotel.archetype}`,
              `Address: ${hotel.address}, ${hotel.neighborhood}, Lisbon.`,
              `Local time now: ${now.pretty} (${hotel.timezone}).`,
              `"Tonight" = the night of ${prettyDate(tonight)} — pass check_in "tonight" for it. "Tomorrow" = the night of ${prettyDate(addDays(tonight, 1))}.`,
              ``,
              `Room types (use check_availability for live prices and stock):`,
              ...rooms.map(
                (r) =>
                  `- ${r.name} (room_code: ${r.code}, sleeps ${r.capacity}) from ${Math.round(r.baseRateCents / 100)} EUR/night`,
              ),
              ``,
              `Policies, parking, breakfast, directions: use lookup_hotel_info with the caller's question.`,
            ].join("\n"),
          );
        },
      );

      server.registerTool(
        "lookup_hotel_info",
        {
          title: "Look up hotel handbook",
          description:
            "ONLY for the AI receptionist during an inbound call to a hotel reception line. " +
            "Searches this hotel's handbook (policies, parking, breakfast, pets, directions, fees, " +
            "accessibility...). Pass the caller's question in natural language. Answer the caller " +
            "ONLY from what this returns — never guess hotel facts.",
          inputSchema: {
            question: z.string().min(3).describe("The caller's question, in natural language"),
          },
        },
        async ({ question }) => {
          if (!hotel) return refuse(ctx.refusal);
          const hits = await lookupFacts(hotel.id, question);
          void logActivity({
            hotelId: hotel.id,
            kind: "lookup_hotel_info",
            callerE164: ctx.callerE164,
            detail: { question, hits: hits.length },
          });
          if (hits.length === 0) {
            return text(
              `No handbook entry found for: "${question}". Do NOT improvise an answer. ` +
                `Tell the caller you'll leave a note for the morning team and use take_message.`,
            );
          }
          return text(
            hits
              .map((h) => `[${h.topic}] Q: ${h.question}\nA: ${h.answer}`)
              .join("\n\n") +
              `\n\nAnswer the caller in your own short words, but keep every fact, number and time exactly as written above.`,
          );
        },
      );

      server.registerTool(
        "check_availability",
        {
          title: "Check room availability",
          description:
            "ONLY for the AI receptionist during an inbound call to a hotel reception line. " +
            "Live availability and total prices for this hotel. Defaults: tonight, 1 night, 2 guests.",
          inputSchema: {
            check_in: z
              .string()
              .optional()
              .describe('"tonight" (default), "tomorrow", or a date like 2026-06-14'),
            nights: z.coerce.number().int().min(1).max(14).optional().describe("Number of nights, default 1"),
            guests: z.coerce.number().int().min(1).max(8).optional().describe("Number of guests, default 2"),
          },
        },
        async ({ check_in, nights, guests }) => {
          if (!hotel) return refuse(ctx.refusal);
          const checkIn = resolveCheckIn(check_in, hotel.timezone);
          if (!checkIn) {
            return text(
              `Could not understand check_in "${check_in}". Use "tonight", "tomorrow", or YYYY-MM-DD.`,
            );
          }
          const n = nights ?? 1;
          const g = guests ?? 2;
          const all = await availabilityForHotel(hotel.id, checkIn, n);
          void logActivity({
            hotelId: hotel.id,
            kind: "check_availability",
            callerE164: ctx.callerE164,
            detail: { checkIn, nights: n, guests: g },
          });

          const stay = `${prettyDate(checkIn)}, ${n} night${n > 1 ? "s" : ""}, ${g} guest${g > 1 ? "s" : ""}`;
          const open = all.filter((r) => r.available > 0 && r.nightsCovered === n);
          if (open.length === 0) {
            return text(
              `FULLY BOOKED for ${stay} — no rooms available. Apologize warmly. ` +
                `Offer to check a different night, or take a message for the morning team (take_message).`,
            );
          }
          const fits = open.filter((r) => r.capacity >= g);
          const list = (fits.length > 0 ? fits : open)
            .map(
              (r) =>
                `- ${r.name} (room_code: ${r.code}): ${r.available} left, sleeps ${r.capacity}, total ${eur(r.totalCents)} for the stay`,
            )
            .join("\n");
          const capacityNote =
            fits.length === 0
              ? `\nNOTE: no single room sleeps ${g} — these are the available rooms; the caller would need more than one.`
              : "";
          return text(
            `AVAILABLE for ${stay}:\n${list}${capacityNote}\n\n` +
              `Quote at most the one or two best-fitting options, with the total in euros. ` +
              `To reserve: ask the caller's full name, then call hold_room with the room_code.`,
          );
        },
      );

      server.registerTool(
        "hold_room",
        {
          title: "Hold a room (reserve, no payment)",
          description:
            "ONLY for the AI receptionist during an inbound call to a hotel reception line. " +
            "Places a 30-minute hold on a room under the guest's name — no payment details, ever. " +
            "Returns a 4-digit confirmation code to read back digit by digit.",
          inputSchema: {
            room_code: z.string().min(2).describe("room_code from check_availability (room name also accepted)"),
            guest_name: z.string().min(2).describe("Guest's full name, as they said it"),
            check_in: z.string().optional().describe('"tonight" (default), "tomorrow", or YYYY-MM-DD'),
            nights: z.coerce.number().int().min(1).max(14).optional().describe("Number of nights, default 1"),
            guests: z.coerce.number().int().min(1).max(8).optional().describe("Number of guests, default 2"),
          },
        },
        async ({ room_code, guest_name, check_in, nights, guests }) => {
          if (!hotel) return refuse(ctx.refusal);
          const checkIn = resolveCheckIn(check_in, hotel.timezone);
          if (!checkIn) {
            return text(`Could not understand check_in "${check_in}". Use "tonight", "tomorrow", or YYYY-MM-DD.`);
          }
          const n = nights ?? 1;

          // Forgiving room resolution: exact code, then case-insensitive
          // code/name substring — voice models echo names, not codes.
          const rooms = await db.select().from(roomTypes).where(eq(roomTypes.hotelId, hotel.id));
          const wanted = room_code.trim().toLowerCase();
          const room =
            rooms.find((r) => r.code === wanted) ??
            rooms.find((r) => r.code.toLowerCase().includes(wanted.replace(/\s+/g, "_"))) ??
            rooms.find((r) => r.name.toLowerCase().includes(wanted));
          if (!room) {
            return text(
              `Unknown room "${room_code}". Valid room_codes: ${rooms.map((r) => r.code).join(", ")}. ` +
                `Run check_availability first and use a room_code it returned.`,
            );
          }

          const result = await createHold({
            hotelId: hotel.id,
            roomTypeId: room.id,
            guestName: guest_name.trim(),
            guestPhone: ctx.callerE164,
            checkIn,
            nights: n,
            guests: guests ?? 2,
            currency: hotel.currency,
          });
          void logActivity({
            hotelId: hotel.id,
            kind: "hold_room",
            callerE164: ctx.callerE164,
            detail: { room: room.code, checkIn, nights: n, ok: result.ok },
          });

          if (!result.ok) {
            return text(
              `Could NOT hold the ${room.name} — it just became unavailable for ${prettyDate(checkIn)}. ` +
                `Apologize, then run check_availability again and offer what remains.`,
            );
          }

          // Payment-link leg: Stripe Checkout (sandbox) + SMS from the hotel's
          // own Dial line. Best-effort by design — any failure (no Stripe key,
          // withheld caller ID, SMS error) falls back to the classic
          // pay-at-the-hotel hold. Never break a live call over a payment link.
          let paymentLinkSent = false;
          if (stripeEnabled() && ctx.callerE164 && hotel.phoneNumberId) {
            try {
              const checkout = await createReservationCheckout({
                reservationId: result.reservationId!,
                hotelId: hotel.id,
                hotelName: hotel.name,
                roomName: room.name,
                guestName: guest_name.trim(),
                checkInPretty: prettyDate(checkIn),
                nights: n,
                totalCents: result.totalCents!,
                currency: hotel.currency,
                holdExpiresAt: result.holdExpiresAt!,
              });
              await recordPaymentLink(result.reservationId!, checkout.sessionId, checkout.url);
              await sendSms({
                fromNumberId: hotel.phoneNumberId,
                to: ctx.callerE164,
                body:
                  `${hotel.name}: ${room.name}, ${prettyDate(checkIn)}, ` +
                  `${n} night${n > 1 ? "s" : ""}, total ${eur(result.totalCents!)}. ` +
                  `Pay within 30 min to confirm (code ${result.confirmationCode}): ${checkout.url}`,
              });
              paymentLinkSent = true;
              void logActivity({
                hotelId: hotel.id,
                kind: "payment_link_sent",
                callerE164: ctx.callerE164,
                detail: { reservationId: result.reservationId, totalCents: result.totalCents },
              });
            } catch (err) {
              console.warn("hold_room: payment link leg failed, falling back:", (err as Error).message);
            }
          }

          const expires = new Intl.DateTimeFormat("en-GB", {
            timeZone: hotel.timezone,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(new Date(result.holdExpiresAt!));
          const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
          const codeSpoken = result
            .confirmationCode!.split("")
            .map((d) => DIGIT_WORDS[Number(d)])
            .join("... ");
          return text(
            [
              `ROOM HELD.`,
              `Confirmation code ${result.confirmationCode} — speak it as: "${codeSpoken}".`,
              `Guest: ${guest_name.trim()} | ${room.name} | ${prettyDate(checkIn)}, ${n} night${n > 1 ? "s" : ""} | total ${eur(result.totalCents!)} | ${paymentLinkSent ? "payment link sent by SMS" : "payment at the hotel"}.`,
              paymentLinkSent
                ? `A payment link was JUST texted to the caller's phone. Tell them: "You've just received an SMS with a secure payment link — the room is reserved for you for the next 30 minutes to complete the payment, and paying confirms the booking." Card details go only to the payment page, never over the phone. They'll get a confirmation text once paid.`
                : `Hold expires at ${expires} local time (30 minutes).`,
              `Arrival instructions for the caller: ${hotel.policies.late_arrival_notes}`,
              `Follow your hold read-back sequence now.`,
            ].join("\n"),
          );
        },
      );

      server.registerTool(
        "take_message",
        {
          title: "Take a message for the morning staff",
          description:
            "ONLY for the AI receptionist during an inbound call to a hotel reception line. " +
            "Records a message for the hotel's morning team — use when the caller needs something " +
            "the night desk cannot do (group bookings, complaints, special requests, callbacks).",
          inputSchema: {
            message: z.string().min(5).describe("The message, including what the caller needs and any details"),
            guest_name: z.string().optional().describe("Caller's name if given"),
          },
        },
        async ({ message, guest_name }) => {
          if (!hotel) return refuse(ctx.refusal);
          await db.insert(messages).values({
            hotelId: hotel.id,
            guestName: guest_name ?? null,
            guestPhone: ctx.callerE164,
            body: message,
          });
          void logActivity({
            hotelId: hotel.id,
            kind: "take_message",
            callerE164: ctx.callerE164,
          });
          return text(
            `Message saved for the morning team. Tell the caller someone will get back to them after 08:00.`,
          );
        },
      );
    },
    {},
    { basePath: "", maxDuration: 60, verboseLogs: false },
  );
}

export async function POST(req: Request) {
  try {
    if (!checkSharedSecret(req.headers)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const ctx = await resolveTenant(req.headers);
    const handler = buildHandler(ctx);
    return await handler(req);
  } catch (err) {
    console.error("mcp: request failed:", err);
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null },
      { status: 500 },
    );
  }
}

// Stateless server: no SSE stream to resume, no session to delete.
export function GET() {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: POST only" }, id: null },
    { status: 405 },
  );
}
export const DELETE = GET;
