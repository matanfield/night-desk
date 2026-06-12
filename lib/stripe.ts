// Stripe sandbox client for the payment-link flow. ONE platform account (ours)
// transacts on behalf of every demo hotel — no Connect, no per-hotel keys; the
// hotel/reservation ride along as session metadata. Card details never touch
// Night Desk: the caller pays on Stripe-hosted Checkout, we only handle the
// URL and the completed-payment webhook.

import Stripe from "stripe";

let cached: Stripe | null = null;

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function client(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  cached ??= new Stripe(key);
  return cached;
}

export interface ReservationCheckout {
  sessionId: string;
  url: string;
}

// Checkout sessions must live >= 30 minutes (Stripe minimum), and the hold is
// exactly 30 minutes — created a moment earlier. Clamp to now+31min so the
// session never expires BEFORE the hold it pays for; the ~1 min overhang is
// an accepted demo-scale race (a late payment still confirms, see booking.ts).
function sessionExpiry(holdExpiresAt: string): number {
  const min = Math.floor(Date.now() / 1000) + 31 * 60;
  const hold = Math.floor(new Date(holdExpiresAt).getTime() / 1000);
  return Math.max(min, hold);
}

export async function createReservationCheckout(args: {
  reservationId: string;
  hotelId: string;
  hotelName: string;
  roomName: string;
  guestName: string;
  checkInPretty: string;
  nights: number;
  totalCents: number;
  currency: string;
  holdExpiresAt: string;
}): Promise<ReservationCheckout> {
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const session = await client().checkout.sessions.create({
    mode: "payment",
    client_reference_id: args.reservationId,
    metadata: { reservationId: args.reservationId, hotelId: args.hotelId },
    expires_at: sessionExpiry(args.holdExpiresAt),
    success_url: `${appUrl}/pay/success`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: args.currency.toLowerCase(),
          unit_amount: args.totalCents,
          product_data: {
            name: `${args.roomName} — ${args.nights} night${args.nights > 1 ? "s" : ""}`,
            description: `${args.hotelName}, check-in ${args.checkInPretty}. Guest: ${args.guestName}.`,
          },
        },
      },
    ],
  });
  if (!session.url) throw new Error("Stripe returned a session without a URL");
  return { sessionId: session.id, url: session.url };
}

// Signature verification for /api/webhooks/stripe. Fails closed: a missing
// STRIPE_WEBHOOK_SECRET refuses every event rather than trusting the network.
export function verifyStripeWebhook(rawBody: string, signatureHeader: string | null): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  if (!signatureHeader) throw new Error("missing stripe-signature header");
  return client().webhooks.constructEvent(rawBody, signatureHeader, secret);
}
