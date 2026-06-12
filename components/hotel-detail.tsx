"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { stars, timeAgo, usd } from "./util";

interface Room {
  id: string;
  code: string;
  name: string;
  capacity: number;
  baseRateCents: number;
  totalUnits: number;
}
interface GridCell {
  room_type_id: string;
  date: string;
  available: number;
  rate_cents: number;
}
interface Reservation {
  id: string;
  roomTypeId: string;
  status: string;
  guestName: string;
  guestPhone: string | null;
  checkIn: string;
  checkOut: string;
  guests: number;
  totalCents: number;
  confirmationCode: string;
  holdExpiresAt: string | null;
  source: string;
  createdAt: string;
}
interface CallRow {
  id: string;
  status: string;
  fromE164: string | null;
  durationSeconds: number | null;
  transcript: string | null;
  createdAt: string;
}
interface Fact {
  id: number;
  topic: string;
  question: string;
  answer: string;
  source: string;
}
interface Message {
  id: number;
  guestName: string | null;
  guestPhone: string | null;
  body: string;
  createdAt: string;
}
interface HotelPayload {
  hotel: {
    id: string;
    name: string;
    archetype: string;
    neighborhood: string;
    address: string;
    stars: number;
    shortDescription: string;
    isLive: boolean;
    phoneE164: string | null;
    persona: { style: string; greeting: string; speech_quirks: string; escalation_line: string };
    policies: Record<string, string>;
  };
  tonight: string;
  rooms: Room[];
  grid: GridCell[];
  reservations: Reservation[];
  calls: CallRow[];
  facts: Fact[];
  messages: Message[];
}

const POLL_MS = 4000;

export default function HotelDetail({ slug }: { slug: string }) {
  const [data, setData] = useState<HotelPayload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/hotels/${slug}`, { cache: "no-store" });
        if (res.status === 404) {
          if (alive) setMissing(true);
          return;
        }
        if (!res.ok) return;
        const payload = (await res.json()) as HotelPayload;
        if (alive) setData(payload);
      } catch {
        // transient poll failure — keep last state
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [slug]);

  const dates = useMemo(() => {
    if (!data) return [];
    const uniq = [...new Set(data.grid.map((g) => g.date))];
    uniq.sort();
    return uniq;
  }, [data]);

  const cellBy = useMemo(() => {
    const m = new Map<string, GridCell>();
    for (const g of data?.grid ?? []) m.set(`${g.room_type_id}|${g.date}`, g);
    return m;
  }, [data]);

  if (missing) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="font-display text-3xl italic">Unknown hotel</h1>
        <Link className="mt-4 inline-block text-sm text-lamp" href="/">
          ← back to the network
        </Link>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="card h-40 animate-pulse" />
      </main>
    );
  }

  const { hotel } = data;
  const roomName = (id: string) => data.rooms.find((r) => r.id === id)?.name ?? id;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <Link href="/" className="text-xs uppercase tracking-[0.16em] text-fg-faint hover:text-fg-dim">
        ← night desk network
      </Link>

      <header className="mt-3 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="font-display text-4xl italic tracking-tight">{hotel.name}</h1>
          <p className="mt-1 text-sm text-fg-dim">
            <span className="text-lamp">{stars(hotel.stars)}</span> · {hotel.archetype} · {hotel.address}
          </p>
          <p className="mt-2 max-w-2xl text-sm text-fg-dim">{hotel.shortDescription}</p>
        </div>
        <div className="text-right">
          {hotel.isLive && hotel.phoneE164 ? (
            <>
              <div className="flex items-center justify-end gap-2">
                <span className="lamp lamp-live" />
                <span className="text-xs uppercase tracking-[0.16em] text-ok">line live</span>
              </div>
              <a href={`tel:${hotel.phoneE164}`} className="font-mono text-xl text-fg hover:text-lamp">
                {hotel.phoneE164}
              </a>
              <div className="text-xs text-fg-faint">call it — the AI night desk answers</div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <span className="lamp lamp-dark" />
              <span className="text-xs uppercase tracking-[0.16em] text-fg-faint">directory only</span>
            </div>
          )}
        </div>
      </header>

      <section className="mt-8">
        <h2 className="text-xs uppercase tracking-[0.18em] text-fg-faint">
          Availability — next {dates.length} nights
        </h2>
        <div className="card mt-3 overflow-x-auto p-4">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="pb-2 pr-3 text-left font-normal text-fg-faint">room</th>
                {dates.map((d) => (
                  <th key={d} className="pb-2 text-center font-normal text-fg-faint">
                    <span className="font-mono">{d.slice(8)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rooms.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-2 pr-3">
                    <div className="text-sm text-fg">{r.name}</div>
                    <div className="text-fg-faint">
                      sleeps {r.capacity} · from <span className="font-mono">{usd(r.baseRateCents)}</span>
                    </div>
                  </td>
                  {dates.map((d) => {
                    const c = cellBy.get(`${r.id}|${d}`);
                    const avail = c?.available ?? 0;
                    const cls =
                      avail <= 0
                        ? "text-bad/70 bg-[rgba(240,114,110,0.06)]"
                        : avail <= 2
                          ? "text-lamp bg-[rgba(240,179,94,0.07)]"
                          : "text-ok bg-[rgba(110,231,168,0.05)]";
                    return (
                      <td key={d} className={`py-2 text-center font-mono ${cls}`} title={c ? `${usd(c.rate_cents)}/night` : ""}>
                        {avail <= 0 ? "·" : avail}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="text-xs uppercase tracking-[0.18em] text-fg-faint">Reservations</h2>
          <ul className="mt-3 divide-y divide-line">
            {data.reservations.map((r) => (
              <li key={r.id} className="feed-row py-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    {r.guestName}
                    <span className="text-fg-faint"> · {roomName(r.roomTypeId)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono">{usd(r.totalCents)}</span>
                    <span
                      className={`pill ${
                        r.status === "hold"
                          ? "text-lamp border-[rgba(240,179,94,0.4)]"
                          : r.status === "confirmed"
                            ? "text-ok border-[rgba(110,231,168,0.4)]"
                            : "text-fg-faint"
                      }`}
                    >
                      {r.status}
                    </span>
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-fg-faint">
                  {r.checkIn} → {r.checkOut} · {r.guests} guests · code{" "}
                  <span className="font-mono text-fg-dim">{r.confirmationCode}</span>
                  {r.source === "ai_receptionist" ? (
                    <span className="text-lamp"> · booked by AI receptionist {timeAgo(r.createdAt)}</span>
                  ) : (
                    <span> · seeded</span>
                  )}
                </div>
              </li>
            ))}
            {data.reservations.length === 0 ? (
              <li className="py-3 text-sm text-fg-faint">No reservations on the books.</li>
            ) : null}
          </ul>
        </div>

        <div className="card p-5">
          <h2 className="text-xs uppercase tracking-[0.18em] text-fg-faint">Call log</h2>
          <ul className="mt-3 divide-y divide-line">
            {data.calls.map((c) => (
              <li key={c.id} className="py-2.5 text-sm">
                <details>
                  <summary className="flex cursor-pointer items-center justify-between gap-3">
                    <span className="font-mono text-xs text-fg-dim">{c.fromE164 ?? "unknown caller"}</span>
                    <span className="flex items-center gap-2 text-xs text-fg-faint">
                      {c.durationSeconds != null ? `${c.durationSeconds}s` : ""} · {c.status} ·{" "}
                      {timeAgo(c.createdAt)}
                    </span>
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[rgba(0,0,0,0.3)] p-3 font-mono text-xs leading-relaxed text-fg-dim">
                    {c.transcript ?? "Transcript not ready yet."}
                  </pre>
                </details>
              </li>
            ))}
            {data.calls.length === 0 ? (
              <li className="py-3 text-sm text-fg-faint">No calls logged yet.</li>
            ) : null}
          </ul>

          {data.messages.length > 0 ? (
            <>
              <h2 className="mt-6 text-xs uppercase tracking-[0.18em] text-fg-faint">For the morning team</h2>
              <ul className="mt-2 divide-y divide-line">
                {data.messages.map((m) => (
                  <li key={m.id} className="py-2.5 text-sm">
                    <div className="text-fg-dim">{m.body}</div>
                    <div className="mt-0.5 text-xs text-fg-faint">
                      {m.guestName ?? "anonymous"} {m.guestPhone ? `· ${m.guestPhone}` : ""} ·{" "}
                      {timeAgo(m.createdAt)}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </section>

      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="text-xs uppercase tracking-[0.18em] text-fg-faint">Night receptionist</h2>
          <p className="mt-3 font-display text-lg italic leading-snug text-fg">
            “{hotel.persona.greeting}”
          </p>
          <p className="mt-3 text-sm text-fg-dim">{hotel.persona.speech_quirks}</p>
          <p className="mt-2 text-xs text-fg-faint">Style: {hotel.persona.style}</p>
          <div className="mt-4 border-t border-line pt-3 text-xs text-fg-faint">
            Arrivals after midnight: {hotel.policies.late_arrival_notes}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-xs uppercase tracking-[0.18em] text-fg-faint">
            Handbook — {data.facts.length} entries the receptionist can quote
          </h2>
          <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto pr-2">
            {data.facts.map((f) => (
              <li key={f.id}>
                <details className="rounded-lg px-2 py-1.5 hover:bg-[rgba(255,255,255,0.03)]">
                  <summary className="cursor-pointer text-sm text-fg-dim">
                    <span className="pill mr-2 text-fg-faint">{f.topic}</span>
                    {f.question}
                  </summary>
                  <p className="mt-1.5 pl-1 text-sm leading-relaxed text-fg-dim">{f.answer}</p>
                </details>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
