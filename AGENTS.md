# Night Desk Agent Instructions

## Project Intent

- This is a hackathon product built around Dial's inbound voice-agent stack: hotel phone lines answer calls, resolve tenant context from Dial headers, and use this app's MCP tools during the call.
- Keep the repo demo-oriented and explainable. Prefer small, direct changes over framework-heavy abstractions.
- This project is the hotel receptionist side of the broader Dial hackathon flow. Do not copy Rather architecture or unrelated Dial demo code; borrow only focused habits and proven integration patterns.
- Use Stripe only where it directly supports the Night Desk demo, hackathon prize criteria, or a clearly separated follow-up flow. Holds in the current product are name-only and must not collect payment details.

## Working Rules

- Before implementing, inspect the existing files, scripts, and README sections relevant to the task.
- Preserve unrelated local work. Do not revert files you did not change.
- Never commit secrets, real API keys, private phone numbers, payment identifiers, recordings, transcripts, or customer data.
- Use sandbox/test modes for Dial and Stripe unless the user explicitly asks for a live action.
- Keep external API integrations behind small local modules such as `lib/dial.ts`, `lib/booking.ts`, and `lib/tenant.ts`; do not scatter provider calls through pages or route handlers.
- Treat MCP tools and webhook handlers as untrusted network boundaries. Validate headers/payloads, keep tenant resolution explicit, and fail closed for unknown phone numbers or outbound contexts.
- Keep `README.md`, `.env.example`, and `package.json` scripts in sync when setup steps, required environment variables, or commands change.
- Add dependencies only when they clearly speed up the hackathon build or reduce integration risk. Prefer boring, well-supported packages.

## Git Workflow

- Work on `main` unless the user explicitly asks for a branch.
- If `origin` exists, sync before substantial work with `git pull --ff-only origin main`.
- Every completed code/docs task should end with a commit and `git push origin main`.
- If `origin` is missing or unavailable, still commit locally and report the exact push blocker.

## Stack Defaults

- Package manager: `pnpm`.
- App framework: Next.js App Router on Next 16. This version may differ from familiar Next.js behavior; read the relevant file in `node_modules/next/dist/docs/` before touching Next APIs or conventions.
- Database: Neon Postgres through Drizzle. Schema lives in `lib/db/schema.ts`; schema push is `pnpm db:push`.
- Seed/provision flow: `scripts/seed.ts`, `scripts/provision.ts`, and `scripts/attach-mcp.ts`.
- Runtime surfaces:
  - `app/[transport]/route.ts` is the MCP server.
  - `app/api/webhooks/dial/route.ts` receives Dial call events.
  - `app/api/state/route.ts` and `app/api/hotels/[slug]/route.ts` support dashboards.
  - `app/page.tsx` and `app/hotels/[slug]/page.tsx` are the operator UI surfaces.

## Verification

- For docs/config-only changes, inspect the diff before handing off.
- For code changes, run the narrowest meaningful local checks first, usually `pnpm lint` and then `pnpm build` when shared routes, DB code, or Next behavior changed.
- For DB changes, verify generated SQL/schema intent before pushing to a shared database.
- For Dial or Stripe flows, prefer a real sandbox smoke test when safe; otherwise document exactly what was not exercised.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
