/* Wires Dial to the deployed Night Desk server:
 *   1. Connects APP_URL/mcp as an account-level Context MCP (with the
 *      shared-secret header) so the voice agent can use the PMS tools.
 *   2. Subscribes APP_URL/api/webhooks/dial to call.ended/call.transcribed
 *      and prints the signing secret to set as DIAL_WEBHOOK_SECRET.
 *
 * Requires env: DIAL_API_KEY, APP_URL, MCP_SHARED_SECRET.
 * Re-runnable: replaces an existing connection for the same URL.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { createContextMcp, deleteContextMcp, listContextMcps, listWebhooks, createWebhook, revealWebhookSecret } =
    await import("../lib/dial");

  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  const secret = process.env.MCP_SHARED_SECRET;
  if (!appUrl) throw new Error("APP_URL is not set");
  if (!secret) throw new Error("MCP_SHARED_SECRET is not set");

  const mcpUrl = `${appUrl}/mcp`;
  const webhookUrl = `${appUrl}/api/webhooks/dial`;

  // --- Context MCP ---------------------------------------------------
  const existing = await listContextMcps();
  for (const c of existing) {
    if (c.url === mcpUrl) {
      console.log(`Replacing existing Context MCP ${c.id} (${c.url})`);
      await deleteContextMcp(c.id);
    }
  }
  const created = (await createContextMcp({
    name: "Night Desk PMS",
    url: mcpUrl,
    headers: { "X-NightDesk-Secret": secret },
  })) as { contextMcp?: { id: string; status?: string; authMode?: string }; authorizationUrl?: string | null };
  console.log("Context MCP connected:", JSON.stringify(created.contextMcp ?? created, null, 2));
  if (created.authorizationUrl) {
    console.log("OAuth consent needed (unexpected for static headers):", created.authorizationUrl);
  }

  // --- Webhook --------------------------------------------------------
  const hooks = await listWebhooks();
  let hookId = hooks.find((w) => w.targetUrl === webhookUrl)?.id;
  if (!hookId) {
    const created = await createWebhook({
      targetUrl: webhookUrl,
      eventTypes: ["call.ended", "call.transcribed"],
    });
    hookId = created.id;
    console.log(`Webhook created: ${hookId} -> ${webhookUrl}`);
  } else {
    console.log(`Webhook already exists: ${hookId} -> ${webhookUrl}`);
  }
  const signing = await revealWebhookSecret(hookId);
  console.log(`\nSet this on Vercel and .env.local:\n  DIAL_WEBHOOK_SECRET=${signing}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
