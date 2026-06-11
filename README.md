# Night Desk

After-hours AI receptionist network for hotels — the answering side of the
[dial-hack](https://github.com/matanfield/dial-hack) availability concierge.

Twelve imaginary Lisbon hotels live in Postgres with rooms, nightly rates,
inventory and a Q&A handbook. A few of them get real phone numbers: Dial
answers each line with that hotel's compiled persona, and mid-call the voice
agent uses this app's MCP tools to check live availability, quote prices,
place 30-minute name-holds (never payment), answer handbook questions, and
take messages. Dashboards watch it all happen in real time.

## Architecture

```
caller (dial-hack concierge / any phone)
   │  PSTN
   ▼
Dial hotel line  ──  AI receptionist (inboundInstruction = compiled persona)
   │  Context MCP tool calls mid-call (X-Dial-* headers)
   ▼
/mcp  (this app, multi-tenant by X-Dial-Agent-Number)
   ▼
Neon Postgres  ◄──  /api/webhooks/dial (call.ended, call.transcribed)
   ▲
dashboards: /  (mission control)   /hotels/[slug]  (per-hotel)
```

- `app/[transport]/route.ts` — MCP server (5 tools), tenant resolved per
  request from Dial's live-call headers; refuses outbound/unknown callers.
- `app/api/webhooks/dial/route.ts` — HMAC-verified call events → call log.
- `lib/booking.ts` — availability + race-guarded hold insert (single SQL).
- `lib/persona.ts` — hotel row → ~2.5KB `inboundInstruction`.
- `scripts/seed.ts` — injects `data/hotels.json` (synthetic, generated).
- `scripts/provision.ts` — buys/refreshes Dial lines for live hotels.
- `scripts/attach-mcp.ts` — connects /mcp as a Dial Context MCP + webhook.

## Setup

```bash
pnpm install
vercel link && vercel integration add neon   # DATABASE_URL
# .env.local additionally needs: DIAL_API_KEY, APP_URL, MCP_SHARED_SECRET
pnpm db:push      # create schema
pnpm seed         # inject the imaginary hotels
vercel --prod     # deploy (APP_URL must point at it)
pnpm provision    # buy Dial lines for the 3 demo hotels (costs credit)
pnpm attach-mcp   # connect Context MCP + webhook; set DIAL_WEBHOOK_SECRET
```

Then phone a live hotel line at 2 AM and ask for a room.

## Notes

- One shared Dial account runs both the concierge (outbound) and the hotels
  (inbound). Context MCPs attach account-wide, so every tool here authorizes
  per request: inbound direction + a registered hotel line, or refusal.
- Dial emits no event when an inbound call starts — only when it ends. The
  dashboards' live "on a call" signal is MCP tool activity (90s window).
- Holds are name-only and expire after 30 minutes; expired holds free their
  rooms automatically at query time. No payment details ever cross the phone.
