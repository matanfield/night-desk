import { eq } from "drizzle-orm";
import { db, hotels } from "./db";

// Dial adds these to EVERY request to a Context MCP server during a call:
//   X-Dial-Direction:    "inbound" | "outbound"
//   X-Dial-User-Number:  the other party (caller, on inbound)  E.164
//   X-Dial-Agent-Number: our Dial number (the hotel line)      E.164
// On the tool-discovery probe (no live call) they are absent or arrive as
// unsubstituted templates — so authorize on presence AND value, per request.
//
// This guard is what makes a single shared Dial account safe: Context MCPs
// attach account-wide, so the concierge's OUTBOUND calls see these tools
// too. They resolve no hotel here and every tool refuses.

export type Hotel = typeof hotels.$inferSelect;

export interface TenantContext {
  ok: boolean;
  hotel: Hotel | null;
  direction: string | null;
  callerE164: string | null;
  refusal: string; // model-facing explanation when ok=false
}

function cleanE164(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.replace(/[\s\-().]/g, "");
  if (/^\+\d{7,15}$/.test(v)) return v;
  return null; // covers "" and "{{agentNumber}}"-style templates
}

export async function resolveTenant(headers: Headers): Promise<TenantContext> {
  const direction = headers.get("x-dial-direction")?.toLowerCase() ?? null;
  const agent = cleanE164(headers.get("x-dial-agent-number"));
  const caller = cleanE164(headers.get("x-dial-user-number"));

  const refusalBase =
    "This tool only works during a live INBOUND call to one of this system's hotel reception lines. ";

  if (direction !== "inbound") {
    return {
      ok: false,
      hotel: null,
      direction,
      callerE164: caller,
      refusal:
        refusalBase +
        "This request did not come from an inbound hotel call, so no hotel data can be accessed. Do not call this tool again on this call.",
    };
  }
  if (!agent) {
    return {
      ok: false,
      hotel: null,
      direction,
      callerE164: caller,
      refusal: refusalBase + "The hotel line could not be identified from the call headers.",
    };
  }

  const rows = await db.select().from(hotels).where(eq(hotels.phoneE164, agent)).limit(1);
  if (rows.length === 0) {
    return {
      ok: false,
      hotel: null,
      direction,
      callerE164: caller,
      refusal: refusalBase + `No hotel is registered for the line ${agent}.`,
    };
  }

  return { ok: true, hotel: rows[0], direction, callerE164: caller, refusal: "" };
}

// Static shared secret configured on the Dial Context MCP connection,
// so only Dial (and us) can reach the tool server at all.
export function checkSharedSecret(headers: Headers): boolean {
  const expected = process.env.MCP_SHARED_SECRET;
  if (!expected) return true; // unset = open (local dev)
  return headers.get("x-nightdesk-secret") === expected;
}
