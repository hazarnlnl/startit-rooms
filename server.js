// startit rooms: a tiny server with no dependencies.
// Stores bookings in data/bookings.json, rejects overlaps, and pushes changes to every open
// screen over Server-Sent Events. In production it also serves the built app from dist/.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, createReadStream, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.DATA_FILE || join(ROOT, "data", "bookings.json");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT || 8787);

// Keep in sync with src/rooms.ts
const ROOMS = ["conference", "kitchen", "small-window", "small-nowindow"];
const DAY_START = 7 * 60;
const DAY_END = 22 * 60;
const STEP = 15;

let bookings = [];
try {
  bookings = JSON.parse(readFileSync(DATA, "utf8"));
} catch {
  bookings = [];
}

function save() {
  mkdirSync(dirname(DATA), { recursive: true });
  const tmp = DATA + ".tmp";
  writeFileSync(tmp, JSON.stringify(bookings, null, 2));
  renameSync(tmp, DATA);
}

const clients = new Set();
function broadcast(date) {
  const msg = `data: ${JSON.stringify({ date })}\n\n`;
  for (const res of clients) res.write(msg);
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => {
      s += c;
      if (s.length > 10_000) reject(new Error("too large"));
    });
    req.on("end", () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const isSlot = (m) => Number.isInteger(m) && m % STEP === 0 && m >= DAY_START && m <= DAY_END;

/** Returns an error message, or null when the booking is valid and free. */
function check(b, ignoreId) {
  if (!ROOMS.includes(b.room)) return "Unknown room";
  if (!isDate(b.date)) return "Bad date";
  if (!isSlot(b.start) || !isSlot(b.end) || b.end <= b.start) return "Bad time";
  if (typeof b.company !== "string" || !b.company.trim() || b.company.length > 60) return "Company name is needed";
  if (b.color && (typeof b.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(b.color))) return "Bad color";
  if (b.email && (typeof b.email !== "string" || b.email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email))) return "That email doesn't look right";
  const clash = bookings.find((o) => o.id !== ignoreId && o.room === b.room && o.date === b.date && o.start < b.end && b.start < o.end);
  return clash ? `Already booked by ${clash.company}` : null;
}

async function api(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "bookings", id?]

  if (parts[1] === "events" && req.method === "GET") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(": hi\n\n");
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => (clearInterval(ping), clients.delete(res)));
    return;
  }

  if (parts[1] !== "bookings") return json(res, 404, { error: "Not found" });
  const id = parts[2];

  if (req.method === "GET" && !id) {
    const date = url.searchParams.get("date");
    if (!isDate(date)) return json(res, 400, { error: "Bad date" });
    return json(res, 200, bookings.filter((b) => b.date === date).sort((a, b) => a.start - b.start));
  }

  if (req.method === "POST" && !id) {
    const body = await readBody(req);
    const b = {
      // An id is accepted so "Undo" after a delete can put the same booking back.
      id: typeof body.id === "string" && /^[\w-]{8,40}$/.test(body.id) && !bookings.some((o) => o.id === body.id) ? body.id : randomUUID(),
      room: body.room,
      date: body.date,
      start: body.start,
      end: body.end,
      company: typeof body.company === "string" ? body.company.trim() : body.company,
      email: typeof body.email === "string" ? body.email.trim() : "",
      color: typeof body.color === "string" ? body.color : "",
      createdAt: new Date().toISOString(),
    };
    const err = check(b);
    if (err) return json(res, 409, { error: err });
    bookings.push(b);
    save();
    broadcast(b.date);
    return json(res, 201, b);
  }

  const i = bookings.findIndex((b) => b.id === id);
  if (i < 0) return json(res, 404, { error: "That booking no longer exists" });

  if (req.method === "PATCH") {
    const body = await readBody(req);
    const next = { ...bookings[i] };
    for (const k of ["date", "room", "start", "end", "company", "email", "color"]) if (k in body) next[k] = ["company", "email", "color"].includes(k) ? String(body[k]).trim() : body[k];
    const err = check(next, id);
    if (err) return json(res, 409, { error: err });
    const oldDate = bookings[i].date;
    bookings[i] = next;
    save();
    broadcast(next.date);
    if (oldDate !== next.date) broadcast(oldDate);
    return json(res, 200, next);
  }

  if (req.method === "DELETE") {
    const [gone] = bookings.splice(i, 1);
    save();
    broadcast(gone.date);
    return json(res, 204);
  }

  json(res, 405, { error: "Method not allowed" });
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function serveStatic(res, pathname) {
  let file = join(DIST, pathname);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  if (!existsSync(file)) return json(res, 404, { error: "Run npm run build first" });
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else serveStatic(res, decodeURIComponent(url.pathname));
  } catch {
    json(res, 400, { error: "Bad request" });
  }
}).listen(PORT, () => console.log(`startit rooms on http://localhost:${PORT}`));
