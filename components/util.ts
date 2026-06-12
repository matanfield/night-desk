export function eur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `€${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function stars(n: number): string {
  return "★".repeat(n);
}

export const KIND_LABEL: Record<string, string> = {
  get_hotel_info: "answered a call",
  lookup_hotel_info: "checked the handbook",
  check_availability: "checked availability",
  hold_room: "placed a hold",
  take_message: "took a message",
  call_ended: "call ended",
  payment_link_sent: "texted a payment link",
  payment_completed: "payment received — booking confirmed",
  payment_link_expired: "payment link expired",
};
