// Dial REST client (https://docs.getdial.ai) — same conventions as the
// dial-hack caller-side repo: REST over CLI, normalize the status shape the
// live API actually returns, never let third-party bodies leak numbers.

const DIAL_BASE = process.env.DIAL_BASE_URL ?? "https://getdial.ai";

interface DialStatusObject {
  state?: string;
  terminationType?: string | null;
  label?: string;
}

export interface DialCall {
  id: string;
  // Required per the Dial OpenAPI spec (direction: inbound|outbound, from/to E.164).
  direction: string;
  from: string;
  to: string;
  status: string | DialStatusObject;
  duration?: number;
  transcript?: string | null;
  createdAt?: string;
  terminatedAt?: string | null;
}

export interface DialNumber {
  id: string;
  number: string;
  country?: string;
  nickname?: string | null;
  inboundInstruction?: string | null;
}

export function normalizeStatus(raw: string | DialStatusObject | undefined): {
  status: string;
  isTerminal: boolean;
} {
  const TERMINAL = ["completed", "busy", "no-answer", "failed", "canceled"];
  if (typeof raw === "string") return { status: raw, isTerminal: TERMINAL.includes(raw) };
  if (raw && typeof raw === "object") {
    const terminated = raw.state === "Terminated";
    const status = terminated
      ? (raw.terminationType ?? "completed")
      : (raw.label ?? raw.state ?? "in-progress").toLowerCase();
    return { status, isTerminal: terminated };
  }
  return { status: "unknown", isTerminal: false };
}

function sanitize(s: string): string {
  return s.replace(/\+?\d(?:[\s-]?\d){6,14}/g, "[number]").slice(0, 300);
}

async function dialFetch(path: string, init?: RequestInit): Promise<unknown> {
  if (!process.env.DIAL_API_KEY) throw new Error("DIAL_API_KEY is not set");
  const res = await fetch(`${DIAL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.DIAL_API_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const bodyText = await res.text();
  if (!res.ok) {
    let message = bodyText;
    try {
      const parsed = JSON.parse(bodyText);
      message = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error ?? parsed);
    } catch {
      // keep raw text
    }
    throw new Error(`Dial API ${res.status}: ${sanitize(message)}`);
  }
  return bodyText ? JSON.parse(bodyText) : {};
}

export async function fetchCall(callId: string): Promise<DialCall> {
  const data = (await dialFetch(`/api/v1/calls/${encodeURIComponent(callId)}`)) as { call: DialCall };
  if (!data.call?.id) throw new Error("Dial returned an unexpected call shape");
  return data.call;
}

export async function listNumbers(): Promise<DialNumber[]> {
  const data = (await dialFetch("/api/v1/numbers")) as { numbers: DialNumber[] };
  return data.numbers ?? [];
}

export async function purchaseNumber(args: {
  inboundInstruction: string;
  nickname?: string;
  country?: string;
}): Promise<DialNumber> {
  const data = (await dialFetch("/api/v1/numbers", {
    method: "POST",
    body: JSON.stringify({
      country: args.country ?? "US",
      inboundInstruction: args.inboundInstruction,
      ...(args.nickname ? { nickname: args.nickname } : {}),
    }),
  })) as { number?: DialNumber } & DialNumber;
  const n = (data.number ?? data) as DialNumber;
  if (!n?.id) throw new Error("Dial returned an unexpected number shape");
  return n;
}

export async function updateNumber(
  numberId: string,
  patch: { inboundInstruction?: string; nickname?: string },
): Promise<void> {
  await dialFetch(`/api/v1/numbers/${encodeURIComponent(numberId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function listContextMcps(): Promise<Array<{ id: string; name: string; url: string }>> {
  const data = (await dialFetch("/api/v1/context-mcps")) as {
    contextMcps?: Array<{ id: string; name: string; url: string }>;
  };
  return data.contextMcps ?? [];
}

export async function createContextMcp(args: {
  name: string;
  url: string;
  headers?: Record<string, string>;
}): Promise<unknown> {
  return dialFetch("/api/v1/context-mcps", { method: "POST", body: JSON.stringify(args) });
}

export async function deleteContextMcp(id: string): Promise<void> {
  await dialFetch(`/api/v1/context-mcps/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listWebhooks(): Promise<Array<{ id: string; targetUrl: string }>> {
  const data = (await dialFetch("/api/v1/webhooks")) as {
    webhooks?: Array<{ id: string; targetUrl: string }>;
  };
  return data.webhooks ?? [];
}

export async function createWebhook(args: {
  targetUrl: string;
  eventTypes: string[];
}): Promise<{ id: string }> {
  const data = (await dialFetch("/api/v1/webhooks", {
    method: "POST",
    body: JSON.stringify(args),
  })) as { webhook?: { id: string } } & { id?: string };
  const w = (data.webhook ?? data) as { id: string };
  if (!w?.id) throw new Error("Dial returned an unexpected webhook shape");
  return w;
}

export async function revealWebhookSecret(webhookId: string): Promise<string> {
  const data = (await dialFetch(
    `/api/v1/webhooks/${encodeURIComponent(webhookId)}/secret`,
  )) as { secret?: string; signingSecret?: string };
  const secret = data.secret ?? data.signingSecret;
  if (!secret) throw new Error("Dial did not return a webhook secret");
  return secret;
}
