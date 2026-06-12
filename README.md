See second complementary product - Claude calling agent extension: https://github.com/matanfield/dial-hack


# Night Desk

After-hours AI receptionist network for hotels — the answering side of the
[dial-hack](https://github.com/matanfield/dial-hack) availability concierge.

Twelve imaginary San Francisco hotels live in Postgres with rooms, nightly
rates, inventory and a Q&A handbook. A few of them get real phone numbers:
Dial answers each line with that hotel's compiled persona, and mid-call the
voice agent uses this app's MCP tools to check live availability, quote
prices, place 30-minute holds, answer handbook questions, and take messages.
When a room is held, the hotel's line texts the caller a Stripe Checkout
link — paying it within the 30-minute hold confirms the booking and texts
back the confirmation code. No card details ever cross the phone or this
app. Dashboards watch it all happen in real time.

Demo scenario: a traveler steps off at the Caltrain station (4th & King) at
2 AM and needs a 3-4 star room under $200/night within a 15-minute walk,
with A/C and an in-room shower. The synthetic network is built around that
search — perfect matches, a sold-out conference hotel, a grand dame over
budget, a charming inn with no A/C, a hostel, and a hotel on the wrong side
of town — so the concierge's calls always have somewhere interesting to land.

## Architecture

```
caller (dial-hack concierge / any phone)
   │  PSTN
   ▼
Dial hotel line  ──  AI receptionist (inboundInstruction = compiled persona)
   │  Context MCP tool calls mid-call (X-Dial-* headers)
   ▼
/mcp  (this app, multi-tenant by X-Dial-Agent-Number)
   │            └─ hold_room → Stripe Checkout link → SMS to caller
   ▼
Neon Postgres  ◄──  /api/webhooks/dial (call.ended, call.transcribed)
   ▲           ◄──  /api/webhooks/stripe (checkout.session.completed
   │                 → hold becomes confirmed → confirmation SMS)
dashboards: /  (mission control)   /hotels/[slug]  (per-hotel)
```

- `app/[transport]/route.ts` — MCP server (5 tools), tenant resolved per
  request from Dial's live-call headers; refuses outbound/unknown callers.
- `app/api/webhooks/dial/route.ts` — HMAC-verified call events → call log.
- `app/api/webhooks/stripe/route.ts` — signature-verified payment events →
  confirms the reservation + texts the guest their confirmation code.
- `lib/booking.ts` — availability + race-guarded hold insert (single SQL).
- `lib/stripe.ts` — sandbox Checkout sessions on ONE platform account (ours,
  transacting for the demo hotels); reservation/hotel ride in metadata.
- `lib/persona.ts` — hotel row → ~2.5KB `inboundInstruction`.
- `scripts/seed.ts` — injects `data/hotels.json` (synthetic, generated).
- `scripts/provision.ts` — buys/refreshes Dial lines for live hotels.
- `scripts/attach-mcp.ts` — connects /mcp as a Dial Context MCP + webhook.

## Setup

```bash
pnpm install
vercel link && vercel integration add neon   # DATABASE_URL
# .env.local additionally needs: DIAL_API_KEY, APP_URL, MCP_SHARED_SECRET
# and for the payment-link flow: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
pnpm db:push      # create schema
pnpm seed         # inject the imaginary hotels
vercel --prod     # deploy (APP_URL must point at it)
pnpm provision    # buy Dial lines for the 3 demo hotels (costs credit)
pnpm attach-mcp   # connect Context MCP + webhook; set DIAL_WEBHOOK_SECRET
```

### Stripe sandbox (payment links)

1. Create a sandbox in the Stripe Dashboard (test mode) and copy the secret
   key (`sk_test_...`) into `STRIPE_SECRET_KEY`. Without it the receptionist
   silently falls back to name-only, pay-at-the-hotel holds.
2. Register a webhook endpoint for `checkout.session.completed` (and
   optionally `checkout.session.expired`) at
   `$APP_URL/api/webhooks/stripe`, and put its signing secret (`whsec_...`)
   into `STRIPE_WEBHOOK_SECRET`. For local dev:
   `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
3. Pay test links with card `4242 4242 4242 4242`, any future expiry, any CVC.

Then phone a live hotel line at 2 AM, ask for a room near the Caltrain
station, and pay the link that lands in your texts.

## Notes

- One shared Dial account runs both the concierge (outbound) and the hotels
  (inbound). Context MCPs attach account-wide, so every tool here authorizes
  per request: inbound direction + a registered hotel line, or refusal.
- Dial emits no event when an inbound call starts — only when it ends. The
  dashboards' live "on a call" signal is MCP tool activity (90s window).
- Holds expire after 30 minutes; expired holds free their rooms automatically
  at query time. Paying the texted Stripe link within that window flips the
  hold to confirmed (via webhook); otherwise it lapses like any hold. No
  payment details ever cross the phone or touch this app — the caller pays on
  Stripe-hosted Checkout, in sandbox/test mode for the demo.
