import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// Neon's HTTP driver: one fetch per query, no connection pooling needed,
// safe across Fluid Compute instance reuse.
const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql, { schema });
export { sql };
export * from "./schema";
