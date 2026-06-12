import { confirmReservationPaid } from "@/lib/booking";
import { sendSms } from "@/lib/dial";
import { prettyDate, usd } from "@/lib/dates";
import { verifyStripeWebhook } from "@/lib/stripe";
import { logActivity } from "@/lib/activity";

export const maxDuration = 60;

// checkout.session.completed is the ONLY path that finalizes a reservation:
// hold -> confirmed (idempotent, see confirmReservationPaid), an activity row
// for the hotel dashboard, and a confirmation SMS back to the guest from the
// hotel's own line. Signature verification fails closed — without a valid
// STRIPE_WEBHOOK_SECRET every event is refused.

interface SessionPayload {
  id?: string;
  client_reference_id?: string | null;
  metadata?: { reservationId?: string; hotelId?: string } | null;
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  let event: ReturnType<typeof verifyStripeWebhook>;
  try {
    event = verifyStripeWebhook(rawBody, req.headers.get("stripe-signature"));
  } catch (err) {
    console.warn("stripe webhook: rejected:", (err as Error).message);
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  const session = event.data.object as SessionPayload;
  const reservationId = session.metadata?.reservationId ?? session.client_reference_id ?? null;

  if (event.type === "checkout.session.expired" && reservationId) {
    void logActivity({
      hotelId: session.metadata?.hotelId ?? null,
      kind: "payment_link_expired",
      detail: { reservationId },
    });
    return Response.json({ received: true });
  }

  if (event.type !== "checkout.session.completed" || !reservationId) {
    return Response.json({ received: true });
  }

  const paid = await confirmReservationPaid(reservationId);
  if (!paid) {
    // Duplicate delivery or unknown id — already confirmed (or never ours).
    return Response.json({ received: true, ignored: "no matching hold" });
  }

  void logActivity({
    hotelId: paid.hotelId,
    kind: "payment_completed",
    callerE164: paid.guestPhone,
    detail: {
      reservationId: paid.reservationId,
      totalCents: paid.totalCents,
      confirmationCode: paid.confirmationCode,
    },
  });

  // Guest-facing confirmation SMS — best-effort: the booking is already
  // confirmed; a failed text must not make Stripe retry the whole event.
  if (paid.guestPhone && paid.hotelPhoneNumberId) {
    try {
      await sendSms({
        fromNumberId: paid.hotelPhoneNumberId,
        to: paid.guestPhone,
        body:
          `${paid.hotelName}: payment received — your booking is confirmed. ` +
          `${paid.roomName}, check-in ${prettyDate(paid.checkIn)}, ${usd(paid.totalCents)}. ` +
          `Confirmation code: ${paid.confirmationCode}. See you tonight!`,
      });
    } catch (err) {
      console.warn("stripe webhook: confirmation SMS failed:", (err as Error).message);
    }
  }

  return Response.json({ received: true });
}
