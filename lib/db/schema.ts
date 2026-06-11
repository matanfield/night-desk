import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// One row per imaginary hotel. `phoneE164` links a Dial inbound line to this
// tenant: the MCP server resolves the hotel from X-Dial-Agent-Number.
export const hotels = pgTable("hotels", {
  id: text("id").primaryKey(), // slug, e.g. "hotel-miradouro-azul"
  name: text("name").notNull(),
  archetype: text("archetype").notNull(),
  neighborhood: text("neighborhood").notNull(),
  address: text("address").notNull(),
  stars: integer("stars").notNull(),
  shortDescription: text("short_description").notNull(),
  longDescription: text("long_description").notNull(),
  timezone: text("timezone").notNull().default("Europe/Lisbon"),
  currency: text("currency").notNull().default("EUR"),
  occupancyProfile: text("occupancy_profile").notNull().default("available"),
  persona: jsonb("persona").$type<{
    style: string;
    greeting: string;
    speech_quirks: string;
    escalation_line: string;
  }>().notNull(),
  policies: jsonb("policies").$type<{
    check_in_from: string;
    check_in_until: string;
    check_out_until: string;
    cancellation: string;
    pets: string;
    smoking: string;
    payment_methods: string;
    late_arrival_notes: string;
  }>().notNull(),
  amenities: jsonb("amenities").$type<string[]>().notNull(),
  // Dial wiring — null until scripts/provision.ts buys/assigns a line.
  phoneNumberId: text("phone_number_id"),
  phoneE164: text("phone_e164").unique(),
  isLive: boolean("is_live").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roomTypes = pgTable(
  "room_types",
  {
    id: text("id").primaryKey(), // `${hotelId}:${code}`
    hotelId: text("hotel_id").notNull().references(() => hotels.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    capacity: integer("capacity").notNull(),
    baseRateCents: integer("base_rate_cents").notNull(),
    totalUnits: integer("total_units").notNull(),
    features: jsonb("features").$type<string[]>().notNull(),
  },
  (t) => [index("room_types_hotel_idx").on(t.hotelId)],
);

// Per-night sellable stock. `unitsOpen` is the number of rooms the hotel
// releases for that night BEFORE counting reservations in this system —
// seeded occupancy is baked in here, live bookings are counted at query time.
export const inventory = pgTable(
  "inventory",
  {
    roomTypeId: text("room_type_id").notNull().references(() => roomTypes.id, { onDelete: "cascade" }),
    date: date("date").notNull(), // the night OF this date (D 14:00 -> D+1 noon)
    unitsOpen: integer("units_open").notNull(),
    rateCents: integer("rate_cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roomTypeId, t.date] })],
);

export const reservations = pgTable(
  "reservations",
  {
    id: text("id").primaryKey(), // res_xxxxxxxx
    hotelId: text("hotel_id").notNull().references(() => hotels.id, { onDelete: "cascade" }),
    roomTypeId: text("room_type_id").notNull().references(() => roomTypes.id, { onDelete: "cascade" }),
    status: text("status").notNull(), // hold | confirmed | cancelled | expired
    guestName: text("guest_name").notNull(),
    guestPhone: text("guest_phone"),
    checkIn: date("check_in").notNull(),
    checkOut: date("check_out").notNull(), // exclusive
    guests: integer("guests").notNull().default(2),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull().default("EUR"),
    confirmationCode: text("confirmation_code").notNull(),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    source: text("source").notNull().default("ai_receptionist"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reservations_hotel_idx").on(t.hotelId),
    index("reservations_room_dates_idx").on(t.roomTypeId, t.checkIn, t.checkOut),
  ],
);

export const calls = pgTable(
  "calls",
  {
    id: text("id").primaryKey(), // Dial call id
    hotelId: text("hotel_id").references(() => hotels.id, { onDelete: "set null" }),
    direction: text("direction").notNull().default("inbound"),
    fromE164: text("from_e164"),
    toE164: text("to_e164"),
    status: text("status").notNull().default("unknown"),
    durationSeconds: integer("duration_seconds"),
    transcript: text("transcript"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    raw: jsonb("raw"),
  },
  (t) => [index("calls_hotel_idx").on(t.hotelId)],
);

// The realtime "handbook": Q&A pairs the receptionist queries mid-call
// instead of carrying every policy in its prompt.
export const hotelFacts = pgTable(
  "hotel_facts",
  {
    id: serial("id").primaryKey(),
    hotelId: text("hotel_id").notNull().references(() => hotels.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    source: text("source").notNull().default("handbook"), // handbook | mined_from_calls
  },
  (t) => [index("hotel_facts_hotel_idx").on(t.hotelId)],
);

// Messages the receptionist takes for morning staff (take_message tool).
export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    hotelId: text("hotel_id").notNull().references(() => hotels.id, { onDelete: "cascade" }),
    guestName: text("guest_name"),
    guestPhone: text("guest_phone"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_hotel_idx").on(t.hotelId)],
);

// Every MCP tool call lands here. Dial emits NO event when an inbound call
// starts, so recent activity rows double as the dashboard's live-call beacon.
export const activity = pgTable(
  "activity",
  {
    id: serial("id").primaryKey(),
    hotelId: text("hotel_id").references(() => hotels.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // tool name or system event
    callerE164: text("caller_e164"),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_hotel_time_idx").on(t.hotelId, t.createdAt)],
);
