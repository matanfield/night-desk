"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { eur, KIND_LABEL, stars, timeAgo } from "./util";

interface HotelCard {
  id: string;
  name: string;
  neighborhood: string;
  stars: number;
  isLive: boolean;
  phoneE164: string | null;
  roomsTonight: number;
  fromCents: number | null;
  lastKind: string | null;
  lastSeenSecs: number | null;
  onCall: boolean;
}

interface FeedRow {
  id: number;
  kind: string;
  hotelId: string | null;
  createdAt: string;
}

interface ReservationRow {
  id: string;
  hotelId: string;
  status: string;
  guestName: string;
  checkIn: string;
  totalCents: number;
  confirmationCode: string;
  createdAt: string;
}

interface State {
  now: string;
  tonight: string;
  hotels: HotelCard[];
  feed: FeedRow[];
  reservations: ReservationRow[];
}

const POLL_MS = 2500;

export default function MissionControl() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as State;
        if (alive) {
          setState(data);
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const hotelName = (id: string | null) => state?.hotels.find((h) => h.id === id)?.name ?? id ?? "—";
  const liveCount = state?.hotels.filter((h) => h.isLive).length ?? 0;
  const onCallCount = state?.hotels.filter((h) => h.onCall).length ?? 0;
  const holds = state?.reservations.filter((r) => r.status === "hold").length ?? 0;

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="font-display text-4xl italic tracking-tight">Night Desk</h1>
          <p className="mt-1 text-sm text-fg-dim">
            After-hours reception network · Lisbon
            {state ? <span className="ml-2 font-mono text-fg-faint">{state.now}</span> : null}
          </p>
        </div>
        <div className="flex gap-6 text-right">
          <Stat label="lines live" value={state ? String(liveCount) : "·"} />
          <Stat label="on a call" value={state ? String(onCallCount) : "·"} accent={onCallCount > 0} />
          <Stat label="active holds" value={state ? String(holds) : "·"} />
        </div>
      </header>

      {error ? <p className="mt-4 text-sm text-bad">Network error: {error} (retrying…)</p> : null}

      <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {(state?.hotels ?? []).map((h) => (
          <Link
            key={h.id}
            href={`/hotels/${h.id}`}
            className={`card card-link block p-4 ${h.onCall ? "oncall-card" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-display text-lg leading-tight">{h.name}</div>
                <div className="mt-0.5 text-xs text-fg-dim">
                  <span className="text-lamp">{stars(h.stars)}</span> · {h.neighborhood}
                </div>
              </div>
              <span
                className={`lamp mt-1.5 ${h.onCall ? "lamp-ringing" : h.isLive ? "lamp-live" : "lamp-dark"}`}
                title={h.onCall ? "On a call" : h.isLive ? "Line live" : "Directory only"}
              />
            </div>

            <div className="mt-4 flex items-baseline justify-between">
              <div className="text-sm">
                {h.roomsTonight > 0 ? (
                  <>
                    <span className="font-mono text-ok">{h.roomsTonight}</span>
                    <span className="text-fg-dim"> room{h.roomsTonight === 1 ? "" : "s"} tonight</span>
                  </>
                ) : (
                  <span className="text-bad">full tonight</span>
                )}
              </div>
              <div className="font-mono text-sm text-fg-dim">
                {h.fromCents != null ? `from ${eur(h.fromCents)}` : ""}
              </div>
            </div>

            <div className="mt-3 border-t border-line pt-2 text-xs text-fg-faint">
              {h.onCall ? (
                <span className="text-lamp">
                  ● on a call — {KIND_LABEL[h.lastKind ?? ""] ?? h.lastKind}
                </span>
              ) : h.lastKind ? (
                `${KIND_LABEL[h.lastKind] ?? h.lastKind} · ${h.lastSeenSecs != null ? `${fmtSecs(h.lastSeenSecs)}` : ""}`
              ) : h.isLive ? (
                <span className="font-mono">{h.phoneE164}</span>
              ) : (
                "directory listing — no line yet"
              )}
            </div>
          </Link>
        ))}
        {!state &&
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card h-36 animate-pulse p-4" />
          ))}
      </section>

      <section className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="text-xs uppercase tracking-[0.18em] text-fg-faint">Tonight&apos;s ledger</h2>
          <ul className="mt-3 divide-y divide-line">
            {(state?.reservations ?? []).map((r) => (
              <li key={r.id} className="feed-row flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className="text-fg">{r.guestName}</span>
                  <span className="text-fg-dim"> · {hotelName(r.hotelId)}</span>
                  <div className="text-xs text-fg-faint">
                    {r.checkIn} · code <span className="font-mono text-fg-dim">{r.confirmationCode}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm">{eur(r.totalCents)}</span>
                  <StatusPill status={r.status} />
                </div>
              </li>
            ))}
            {state && state.reservations.length === 0 ? (
              <li className="py-3 text-sm text-fg-faint">No reservations yet — the phones are quiet.</li>
            ) : null}
          </ul>
        </div>

        <div className="card p-5">
          <h2 className="text-xs uppercase tracking-[0.18em] text-fg-faint">Live wire</h2>
          <ul className="mt-3 divide-y divide-line">
            {(state?.feed ?? []).slice(0, 12).map((f) => (
              <li key={f.id} className="feed-row flex items-center justify-between py-2.5 text-sm">
                <div>
                  <span className="text-fg">{hotelName(f.hotelId)}</span>
                  <span className="text-fg-dim"> — {KIND_LABEL[f.kind] ?? f.kind}</span>
                </div>
                <span className="text-xs text-fg-faint">{timeAgo(f.createdAt)}</span>
              </li>
            ))}
            {state && state.feed.length === 0 ? (
              <li className="py-3 text-sm text-fg-faint">No activity yet tonight.</li>
            ) : null}
          </ul>
        </div>
      </section>

      <footer className="mt-10 pb-6 text-center text-xs text-fg-faint">
        Every hotel here is imaginary; every phone call is real.
      </footer>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className={`font-mono text-2xl ${accent ? "text-lamp" : ""}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-fg-faint">{label}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "hold"
      ? "text-lamp border-[rgba(240,179,94,0.4)]"
      : status === "confirmed"
        ? "text-ok border-[rgba(110,231,168,0.4)]"
        : "text-fg-faint";
  return <span className={`pill ${cls}`}>{status}</span>;
}

function fmtSecs(s: number): string {
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
