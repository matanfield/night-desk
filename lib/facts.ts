import { sql } from "./db";

export interface FactHit {
  topic: string;
  question: string;
  answer: string;
}

// Handbook lookup: Postgres full-text search over ~25 Q&A pairs per hotel.
// Tool latency is dead air on a live phone call, so this stays a single
// fast query with a keyword fallback — no embeddings, no LLM hop.
export async function lookupFacts(hotelId: string, question: string): Promise<FactHit[]> {
  const fts = (await sql`
    SELECT topic, question, answer
    FROM hotel_facts,
         websearch_to_tsquery('english', ${question}) AS q
    WHERE hotel_id = ${hotelId}
      AND to_tsvector('english', topic || ' ' || question || ' ' || answer) @@ q
    ORDER BY ts_rank(to_tsvector('english', topic || ' ' || question || ' ' || answer), q) DESC
    LIMIT 3
  `) as Array<Record<string, unknown>>;

  if (fts.length > 0) {
    return fts.map((r) => ({
      topic: String(r.topic),
      question: String(r.question),
      answer: String(r.answer),
    }));
  }

  // Fallback: OR-match individual keywords (FTS misses misspellings and
  // very short queries like "parking?").
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 6);
  if (words.length === 0) return [];

  const loose = (await sql`
    SELECT topic, question, answer
    FROM hotel_facts
    WHERE hotel_id = ${hotelId}
      AND (topic || ' ' || question || ' ' || answer) ~* ${`(${words.join("|")})`}
    LIMIT 3
  `) as Array<Record<string, unknown>>;

  return loose.map((r) => ({
    topic: String(r.topic),
    question: String(r.question),
    answer: String(r.answer),
  }));
}
