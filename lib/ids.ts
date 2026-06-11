import { randomBytes, randomInt } from "node:crypto";

export function reservationId(): string {
  return `res_${randomBytes(6).toString("hex")}`;
}

// Confirmation codes are spoken over the phone and then transcribed twice
// (receptionist -> caller's voice agent -> transcript), so: digits only,
// four of them, no letters that mishear.
export function confirmationCode(): string {
  return String(randomInt(0, 10000)).padStart(4, "0");
}

// Deterministic PRNG for seeding — same hotels.json in, same inventory out.
export function seededRandom(key: string): () => number {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
