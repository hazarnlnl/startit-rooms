// Keep the ids and the day window in sync with server.js
export const ROOMS = [
  { id: "conference", name: "Conference room", detail: "Projector" },
  { id: "kitchen", name: "Meeting room", detail: "Next to the kitchen" },
  { id: "small-window", name: "Small room", detail: "With window" },
  { id: "small-nowindow", name: "Small room", detail: "No window" },
] as const;

export type RoomId = (typeof ROOMS)[number]["id"];

export const DAY_START = 7 * 60;
export const DAY_END = 22 * 60;
export const STEP = 15;
export const DEFAULT_LENGTH = 60;

export type Booking = {
  id: string;
  room: RoomId;
  date: string;
  start: number;
  end: number;
  company: string;
  email?: string;
  /** #rrggbb from PALETTE; empty means "pick one from the company name". */
  color?: string;
  createdAt?: string;
};

/** 30 preset booking colors: vivid, then deeper, then muted. Mid-tones that read on light and dark. */
export const PALETTE = [
  "#e5484d", "#f76b15", "#f5a623", "#c9a400", "#7cb518", "#30a46c", "#12a594", "#05a2c2", "#3e63dd", "#6e56cf",
  "#d6409f", "#e93d82", "#ab4aba", "#8e4ec6", "#5b5bd6", "#0090ff", "#0d74ce", "#29a383", "#46a758", "#978365",
  "#a18072", "#ad7f58", "#c2410c", "#be123c", "#9d174d", "#7c3aed", "#4338ca", "#0f766e", "#4d7c0f", "#6b7280",
];

/** The color a company gets until someone picks one. */
export const autoColor = (company: string) => {
  let h = 0;
  for (const ch of company.toLowerCase().replace(/\s+/g, "")) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
};

export const colorOf = (b: Pick<Booking, "company" | "color">) => b.color || autoColor(b.company);

export const fmt =(m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const roomLabel = (id: RoomId) => {
  const r = ROOMS.find((r) => r.id === id)!;
  return r.name === "Small room" ? `${r.name} (${r.detail.toLowerCase()})` : r.name;
};

/** Local date as YYYY-MM-DD (not UTC, so late evening doesn't jump to tomorrow). */
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + n));
};

export const parseDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
