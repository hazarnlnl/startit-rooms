import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Segmented } from "./cargo/segmented/Segmented";
import { UndoToast } from "./cargo/undo-toast/UndoToast";
import { api } from "./api";
import { ClockIcon, DateField, ListField, RoomIcon } from "./pickers";
import { BookDialog, WhoFields, TIMES, overlapOf, whoReady, type Range, type Who } from "./forms";
import { ROOMS, DAY_START, DAY_END, STEP, DEFAULT_LENGTH, fmt, roomLabel, isoDate, addDays, parseDate, colorOf, PALETTE, type Booking, type RoomId } from "./rooms";

const ROW = 14; // px per 15 minutes
const SLOTS = (DAY_END - DAY_START) / STEP;
const COMPANY_KEY = "startit.company";
const EMAIL_KEY = "startit.email";
const COLOR_KEY = "startit.color";

const shortDay = (iso: string) => parseDate(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const sameCompany = (a: string, b: string) => norm(a) === norm(b);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const readStored = (key: string) => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};
const writeStored = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode: it just won't be remembered */
  }
};

const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

/** A dashed box on the grid: a new booking, or (with id) an existing one being edited. */
type Draft = Range & { id?: string };

/** What the pointer is doing right now on the grid. */
type Gesture =
  | { kind: "create"; id: number; anchor: number; room: RoomId; mouse: boolean; x0: number; y0: number; moved: boolean }
  | { kind: "move" | "top" | "bottom"; id: number; orig: Draft; y0: number };
type Toast = { key: number; message: string; open: boolean; onUndo?: () => void };

export function App() {
  const [today, setToday] = useState(() => isoDate(new Date()));
  const [now, setNow] = useState(nowMinutes);
  const [date, setDate] = useState(today);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [who, setWho] = useState<Who>(() => {
    const email = readStored(EMAIL_KEY);
    return { company: readStored(COMPANY_KEY), email, emailOpen: !!email, color: readStored(COLOR_KEY) };
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editWho, setEditWho] = useState<Who>({ company: "", email: "", emailOpen: false, color: "" });
  const [editDate, setEditDate] = useState(today);
  const [otherDay, setOtherDay] = useState<Booking[] | null>(null);
  // Colors companies have picked, learned from bookings seen so far, so a company keeps its color.
  // Until someone picks a color, new bookings get one fixed color chosen when the page opens.
  // It never follows the company name, so the swatch doesn't change while typing.
  const [defaultColor] = useState(() => PALETTE[Math.floor(Math.random() * PALETTE.length)]);
  const [dialog, setDialog] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef(new Map<RoomId, HTMLDivElement>());
  const gesture = useRef<Gesture | null>(null);
  const dateRef = useRef(date);
  dateRef.current = date;

  // Clock: keeps "now" and "today" fresh
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(nowMinutes());
      setToday(isoDate(new Date()));
    }, 30_000);
    return () => window.clearInterval(t);
  }, []);

  const load = useCallback(async (d: string) => {
    try {
      const list = await api.list(d);
      if (dateRef.current !== d) return;
      setBookings(list);
      setLoaded(true);
      setKnown((k) => Array.from(new Set([...k, ...list.map((b) => b.company)])).sort());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    setLoaded(false);
    setSelectedId(null);
    setDraft(null);
    load(date);
  }, [date, load]);

  // Live: the server pings whenever a day changes; refetch if it's the day on screen.
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      const { date: changed } = JSON.parse(e.data);
      if (changed === dateRef.current) load(changed);
    };
    es.onopen = () => load(dateRef.current); // catch up after a reconnect
    return () => es.close();
  }, [load]);

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(t);
  }, [error]);

  // Esc drops the draft or closes the booking panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || dialog) return;
      setDraft(null);
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  // Scroll to the useful part of the day: now (minus a bit) today, 8:00 otherwise.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = date === today ? clamp(now - 60, DAY_START, DAY_END - 4 * 60) : 8 * 60;
    el.scrollTop = ((target - DAY_START) / STEP) * ROW;
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const earliestToday = Math.ceil(now / STEP) * STEP;
  const earliest = date === today ? earliestToday : date < today ? DAY_END : DAY_START;

  /** The free window around minute t in a room, or null if t is booked or in the past. */
  const freeAround = (room: RoomId, t: number) => {
    if (t < earliest) return null;
    let lo = Math.max(DAY_START, earliest);
    let hi = DAY_END;
    for (const b of bookings) {
      if (b.room !== room) continue;
      if (b.start <= t && t < b.end) return null;
      if (b.end <= t) lo = Math.max(lo, b.end);
      if (b.start > t) hi = Math.min(hi, b.start);
    }
    return { lo, hi };
  };

  const minuteAt = (clientY: number) => {
    const top = bodyRef.current!.getBoundingClientRect().top;
    return DAY_START + clamp(Math.floor((clientY - top) / ROW), 0, SLOTS - 1) * STEP;
  };
  const roomAt = (clientX: number): RoomId | null => {
    for (const [id, el] of colRefs.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) return id;
    }
    return null;
  };

  const placeDraft = (room: RoomId, t: number) => {
    const f = freeAround(room, t);
    if (!f) return;
    setDraft({ room, start: t, end: Math.min(t + DEFAULT_LENGTH, f.hi) });
    // The panel covers the lower part of the screen: bring the draft up above it.
    const el = scrollRef.current;
    const body = bodyRef.current;
    if (!el || !body) return;
    const panelTop = window.innerHeight - 380;
    const draftTop = body.getBoundingClientRect().top + ((t - DAY_START) / STEP) * ROW;
    const draftBottom = draftTop + ((Math.min(t + DEFAULT_LENGTH, f.hi) - t) / STEP) * ROW;
    if (draftBottom > panelTop) {
      const headH = el.querySelector(".board__head")?.getBoundingClientRect().height ?? 0;
      const want = el.getBoundingClientRect().top + headH + 16;
      requestAnimationFrame(() => el.scrollBy({ top: draftTop - want, behavior: "smooth" }));
    }
  };

  // Empty grid: click places a dashed draft; with a mouse you can also drag out a range.
  const onColDown = (room: RoomId) => (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".bk, .draft")) return;
    const t = minuteAt(e.clientY);
    setSelectedId(null);
    if (!freeAround(room, t)) return;
    const mouse = e.pointerType === "mouse";
    if (mouse) {
      e.preventDefault(); // no text selection while dragging
      placeDraft(room, t);
    }
    gesture.current = { kind: "create", id: e.pointerId, anchor: t, room, mouse, x0: e.clientX, y0: e.clientY, moved: false };
  };

  // Moving or resizing the draft (mouse and touch alike: the draft blocks scrolling).
  const onDraftDown = (kind: "move" | "top" | "bottom") => (e: RPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !draft) return;
    e.stopPropagation();
    e.preventDefault();
    document.body.setAttribute("data-dragging", kind);
    gesture.current = { kind, id: e.pointerId, orig: draft, y0: e.clientY };
  };

  const onPointerMove = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    if (g.kind === "create") {
      if (!g.mouse) {
        // A moving finger on the grid means "scroll", not "book".
        if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 8) gesture.current = null;
        return;
      }
      const t = minuteAt(e.clientY);
      if (t === g.anchor && !g.moved) return;
      g.moved = true;
      const f = freeAround(g.room, g.anchor);
      if (!f) return;
      setDraft({ room: g.room, start: Math.max(Math.min(g.anchor, t), f.lo), end: Math.min(Math.max(g.anchor, t) + STEP, f.hi) });
      return;
    }
    const d = Math.round((e.clientY - g.y0) / ROW) * STEP;
    const o = g.orig;
    // Can't move into the past, but a meeting that's already running keeps its start.
    const minStart = Math.max(DAY_START, Math.min(earliest, o.start));
    if (g.kind === "move") {
      const len = o.end - o.start;
      const start = clamp(o.start + d, minStart, DAY_END - len);
      setDraft({ ...o, room: roomAt(e.clientX) ?? o.room, start, end: start + len });
    } else if (g.kind === "top") {
      setDraft({ ...o, start: clamp(o.start + d, minStart, o.end - STEP) });
    } else {
      setDraft({ ...o, end: clamp(o.end + d, o.start + STEP, DAY_END) });
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    gesture.current = null;
    document.body.removeAttribute("data-dragging");
    if (g.kind === "create" && !g.mouse) placeDraft(g.room, g.anchor);
  };

  // Gestures are tracked on the window: the draft can move between rooms, which re-mounts it
  // in another column, so element-level pointer capture would be lost mid-drag.
  const handlers = useRef({ onPointerMove, onPointerUp });
  handlers.current = { onPointerMove, onPointerUp };
  useEffect(() => {
    const move = (e: PointerEvent) => handlers.current.onPointerMove(e);
    const up = (e: PointerEvent) => handlers.current.onPointerUp(e);
    const cancel = () => {
      gesture.current = null;
      document.body.removeAttribute("data-dragging");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, []);

  const showToast = (message: string, onUndo?: () => void) => setToast({ key: Date.now(), message, open: true, onUndo });
  const closeToast = () => setToast((t) => (t ? { ...t, open: false } : t));

  const remember = (w: Who) => {
    writeStored(COMPANY_KEY, w.company.trim());
    writeStored(EMAIL_KEY, w.email.trim());
    writeStored(COLOR_KEY, w.color);
  };

  /** Books a range on any day. Returns whether it worked. */
  const book = async (d: string, r: Range): Promise<boolean> => {
    const company = who.company.trim().replace(/\s+/g, " ");
    const email = who.email.trim();
    const color = who.color || defaultColor;
    remember(who);
    const onScreen = d === dateRef.current;
    const tmp: Booking = { id: `tmp-${Date.now()}`, date: d, company, email, color, ...r };
    if (onScreen) setBookings((bs) => [...bs, tmp]); // show it right away
    try {
      const b = await api.create({ date: d, company, email, color, ...r });
      if (onScreen) setBookings((bs) => bs.map((x) => (x.id === tmp.id ? b : x)));
      showToast(`${roomLabel(b.room)} booked, ${fmt(b.start)}–${fmt(b.end)}`, () => {
        api.remove(b.id).catch((e) => setError(e.message));
        setBookings((bs) => bs.filter((x) => x.id !== b.id));
      });
      return true;
    } catch (e) {
      if (onScreen) setBookings((bs) => bs.filter((x) => x.id !== tmp.id));
      setError((e as Error).message);
      load(dateRef.current);
      return false;
    }
  };

  const bookDraft = async () => {
    if (!draft) return;
    const r = draft;
    setDraft(null);
    if (!(await book(date, r))) setDraft(r);
  };

  const remove = async (b: Booking) => {
    setSelectedId(null);
    setBookings((bs) => bs.filter((x) => x.id !== b.id));
    try {
      await api.remove(b.id);
      showToast(`Deleted ${b.company}, ${fmt(b.start)}–${fmt(b.end)}`, () => {
        api
          .create(b)
          .then(() => load(dateRef.current))
          .catch((e) => setError(`Couldn't restore: ${e.message}`));
      });
    } catch (e) {
      setError((e as Error).message);
      load(date);
    }
  };

  const hasEnded = (b: Booking) => b.date < today || (b.date === today && b.end <= now);

  /** Clicking a booking shows its info first; Edit (for bookings that haven't ended) opens edit mode. */
  const openBooking = (b: Booking) => {
    if (b.id.startsWith("tmp-")) return;
    setDraft(null);
    setSelectedId(b.id === selectedId ? null : b.id);
  };

  const startEdit = (b: Booking) => {
    setSelectedId(null);
    setDraft({ room: b.room, start: b.start, end: b.end, id: b.id });
    setEditDate(b.date);
    setEditWho({ company: b.company, email: b.email ?? "", emailOpen: !!b.email, color: colorOf(b) });
  };

  const editing = draft?.id ? bookings.find((b) => b.id === draft.id) ?? null : null;
  const movingDay = !!editing && editDate !== date;

  // Moving a booking to another day: load that day's bookings to check for overlaps.
  useEffect(() => {
    if (!movingDay) {
      setOtherDay(null);
      return;
    }
    let live = true;
    setOtherDay(null);
    api
      .list(editDate)
      .then((l) => live && setOtherDay(l))
      .catch(() => live && setOtherDay([]));
    return () => {
      live = false;
    };
  }, [movingDay, editDate]);

  const changed =
    !!editing &&
    !!draft &&
    (editing.date !== editDate ||
      editing.room !== draft.room ||
      editing.start !== draft.start ||
      editing.end !== draft.end ||
      editing.company !== editWho.company.trim().replace(/\s+/g, " ") ||
      (editing.email ?? "") !== editWho.email.trim() ||
      colorOf(editing) !== editWho.color);

  const saveEdit = async () => {
    if (!draft || !editing) return;
    const before = editing;
    const company = editWho.company.trim().replace(/\s+/g, " ");
    const patch = { date: editDate, room: draft.room, start: draft.start, end: draft.end, company, email: editWho.email.trim(), color: editWho.color || defaultColor };
    setDraft(null);
    // Moved to another day: it leaves this day's grid.
    setBookings((bs) => (patch.date !== date ? bs.filter((x) => x.id !== before.id) : bs.map((x) => (x.id === before.id ? { ...x, ...patch } : x))));
    try {
      await api.update(before.id, patch);
      const dayNote = patch.date !== before.date ? `${shortDay(patch.date)}, ` : "";
      showToast(`Updated: ${roomLabel(patch.room)}, ${dayNote}${fmt(patch.start)}–${fmt(patch.end)}`, () => {
        const { date: d0, room, start, end, company, email, color } = before;
        api
          .update(before.id, { date: d0, room, start, end, company, email: email ?? "", color: color ?? "" })
          .then(() => load(dateRef.current))
          .catch((e) => setError(`Couldn't undo: ${e.message}`));
      });
    } catch (e) {
      setError((e as Error).message);
      load(date);
      setDraft(draft);
    }
  };

  // Someone else deleted the booking being edited: close the editor.
  useEffect(() => {
    if (draft?.id && loaded && !editing) {
      setDraft(null);
      setError("That booking was just deleted by someone else.");
    }
  }, [draft?.id, editing, loaded]);

  // The draft shows the color it will get: the picked one, or the company's usual one once a name is typed.
  const draftColor = !draft ? undefined : draft.id ? editWho.color || defaultColor : who.color || defaultColor;

  const selected = bookings.find((b) => b.id === selectedId) ?? null;
  const clash = draft ? overlapOf(draft, (movingDay ? otherDay ?? [] : bookings).filter((b) => b.id !== draft.id)) : null;
  // Earliest start the edit fields offer: not in the past, but a running meeting keeps its start.
  const editMin = editing ? Math.max(DAY_START, Math.min(editDate === today ? earliestToday : DAY_START, editDate === editing.date ? editing.start : DAY_END)) : DAY_START;
  const suggestions = useMemo(() => known.filter((k) => !sameCompany(k, who.company)), [known, who.company]);

  // Week strip
  const day = parseDate(date);
  const monday = addDays(date, -((day.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const dayLabel = (iso: string) => (iso === today ? "Today" : parseDate(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" }));
  const labels = week.map(dayLabel);
  const longDate = day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="app">
      <header className="top">
        <div className="top__row">
          <h1 className="top__title">
            startit <span>rooms</span>
          </h1>
          <button
            type="button"
            className="cta"
            data-hidden={draft || dialog || selected ? true : undefined}
            aria-hidden={draft || dialog || selected ? true : undefined}
            tabIndex={draft || dialog || selected ? -1 : undefined}
            onClick={() => (setDraft(null), setSelectedId(null), setDialog(true))}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 3.5v9M3.5 8h9" />
            </svg>
            Book a room
          </button>
        </div>
        <div className="top__row">
          <div className="days">
            <button type="button" className="icon" aria-label="Previous week" onClick={() => setDate(addDays(date, -7))}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M10 3.5 5.5 8l4.5 4.5" />
              </svg>
            </button>
            <div className="days__strip">
              <Segmented label="Day" options={labels} value={dayLabel(date)} onChange={(l) => setDate(week[labels.indexOf(l)])} />
            </div>
            <button type="button" className="icon" aria-label="Next week" onClick={() => setDate(addDays(date, 7))}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 3.5 10.5 8 6 12.5" />
              </svg>
            </button>
          </div>
          <p className="top__date">
            {longDate}
            {!week.includes(today) ? (
              <button type="button" className="link" onClick={() => setDate(today)}>
                Back to today
              </button>
            ) : null}
          </p>
        </div>
      </header>

      <main className="board" ref={scrollRef} data-loading={!loaded || undefined}>
        <div className="board__head">
          <span />
          {ROOMS.map((r) => (
            <div key={r.id} className="room">
              <span className="room__name">{r.name}</span>
              <span className="room__detail">{r.detail}</span>
            </div>
          ))}
        </div>

        <div className="board__body" ref={bodyRef} style={{ height: SLOTS * ROW }}>
          <div className="gutter">
            {Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, i) => (
              <span key={i} style={{ top: i * 4 * ROW }}>
                {fmt(DAY_START + i * 60)}
              </span>
            ))}
          </div>

          {ROOMS.map((r) => (
            <div
              key={r.id}
              ref={(el) => {
                if (el) colRefs.current.set(r.id, el);
                else colRefs.current.delete(r.id);
              }}
              className="col"
              style={{ ["--row" as string]: `${ROW}px` }}
              onPointerDown={onColDown(r.id)}
              aria-label={`${roomLabel(r.id)}: click to start a booking`}
            >
              {earliest > DAY_START ? <div className="past" style={{ height: ((Math.min(earliest, DAY_END) - DAY_START) / STEP) * ROW }} /> : null}

              {bookings
                .filter((b) => b.room === r.id && b.id !== draft?.id)
                .map((b) => {
                  const h = ((b.end - b.start) / STEP) * ROW;
                  const mine = !!who.company && sameCompany(b.company, who.company);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      className="bk"
                      data-mine={mine || undefined}
                      data-size={h < 2 * ROW ? "xs" : h < 3 * ROW ? "s" : h < 4 * ROW ? "m" : undefined}
                      data-selected={b.id === selectedId || undefined}
                      data-saving={b.id.startsWith("tmp-") || undefined}
                      title={`${b.company}${b.email ? ` · ${b.email}` : ""} · ${fmt(b.start)}–${fmt(b.end)}`}
                      style={{ top: ((b.start - DAY_START) / STEP) * ROW, height: h, ["--hue" as string]: colorOf(b) }}
                      onClick={() => openBooking(b)}
                    >
                      <span className="bk__who">{b.company}</span>
                      {b.email ? <span className="bk__mail">{b.email}</span> : null}
                      <span className="bk__time">
                        {fmt(b.start)}–{fmt(b.end)}
                      </span>
                    </button>
                  );
                })}

              {draft && draft.room === r.id && !movingDay ? (
                <div
                  className="draft"
                  data-picked={draftColor ? true : undefined}
                  data-conflict={clash ? true : undefined}
                  data-short={draft.end - draft.start < 30 || undefined}
                  style={{ top: ((draft.start - DAY_START) / STEP) * ROW, height: ((draft.end - draft.start) / STEP) * ROW, ["--pick" as string]: draftColor }}
                  onPointerDown={onDraftDown("move")}
                  aria-label={`New booking ${fmt(draft.start)} to ${fmt(draft.end)}. Drag to move, drag the edges to change the time.`}
                >
                  <span className="draft__h draft__h--top" onPointerDown={onDraftDown("top")} />
                  <span className="draft__time">
                    {fmt(draft.start)}–{fmt(draft.end)}
                  </span>
                  <span className="draft__h draft__h--bottom" onPointerDown={onDraftDown("bottom")} />
                </div>
              ) : null}
            </div>
          ))}

          {date === today && now >= DAY_START && now <= DAY_END ? <div className="now" style={{ top: ((now - DAY_START) / STEP) * ROW }} /> : null}
        </div>
        {draft ? <div className="board__spacer" /> : null}
      </main>

      {draft && editing ? (
        <form className="sheet" aria-label="Edit booking" onSubmit={(e) => (e.preventDefault(), changed && !clash && whoReady(editWho) && saveEdit())}>
          <div className="sheet__head">
            <div>
              <p className="sheet__title">
                Edit booking
                {changed ? (
                  <span className="was">
                    was {editing.date !== editDate ? `${shortDay(editing.date)}, ` : ""}
                    {fmt(editing.start)}–{fmt(editing.end)}
                  </span>
                ) : null}
              </p>
              <p className="sheet__sub">{movingDay ? `Moving to ${shortDay(editDate)}. Save to confirm.` : "Change it here, or drag the box on the grid."}</p>
            </div>
            <button type="button" className="icon" aria-label="Close without saving" onClick={() => setDraft(null)}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
              </svg>
            </button>
          </div>
          <div className="edit-grid">
            <DateField
              label="Day"
              value={editDate}
              min={editing.date < today ? editing.date : today}
              onChange={(d) => {
                setEditDate(d);
                // Today's past hours can't be booked: push the time forward if needed.
                const min = d === today ? Math.min(earliestToday, d === editing.date ? editing.start : DAY_END) : DAY_START;
                if (draft.start < min) {
                  const len = draft.end - draft.start;
                  const start = Math.min(min, DAY_END - STEP);
                  setDraft({ ...draft, start, end: Math.min(DAY_END, start + len) });
                }
              }}
            />
            <ListField
              label="Room"
              icon={<RoomIcon />}
              value={draft.room}
              options={ROOMS.map((r) => ({ value: r.id as RoomId, label: roomLabel(r.id) }))}
              onChange={(room) => setDraft({ ...draft, room })}
            />
            <ListField
              label="From"
              icon={<ClockIcon />}
              value={draft.start}
              options={TIMES.filter((t) => (t >= editMin || t === draft.start) && t < DAY_END).map((t) => ({ value: t, label: fmt(t) }))}
              onChange={(start) => {
                const len = draft.end - draft.start;
                setDraft({ ...draft, start, end: Math.min(DAY_END, start + len) });
              }}
            />
            <ListField
              label="To"
              icon={<ClockIcon />}
              value={draft.end}
              options={TIMES.filter((t) => t > draft.start).map((t) => ({ value: t, label: fmt(t) }))}
              onChange={(end) => setDraft({ ...draft, end })}
            />
          </div>
          <WhoFields key={editing.id} who={editWho} onChange={setEditWho} suggestions={suggestions} autoColor={defaultColor} />
          {clash ? (
            <p className="note-err" role="alert">
              Overlaps {clash.company}, {fmt(clash.start)}–{fmt(clash.end)}. Move it or change the time.
            </p>
          ) : null}
          <div className="sheet__row">
            <button type="button" className="danger" onClick={() => (setDraft(null), remove(editing))}>
              Delete
            </button>
            <button type="submit" className="primary" disabled={!changed || !!clash || !whoReady(editWho) || (movingDay && !otherDay)}>
              Save changes
            </button>
          </div>
        </form>
      ) : draft ? (
        <form className="sheet" aria-label="New booking" onSubmit={(e) => (e.preventDefault(), !clash && whoReady(who) && bookDraft())}>
          <div className="sheet__head">
            <div>
              <p className="sheet__title">
                {fmt(draft.start)}–{fmt(draft.end)}
              </p>
              <p className="sheet__sub">
                {roomLabel(draft.room)} · drag the box to move it, or its edges to change the time
              </p>
            </div>
            <button type="button" className="icon" aria-label="Cancel" onClick={() => setDraft(null)}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
              </svg>
            </button>
          </div>
          <WhoFields key="new" who={who} onChange={setWho} suggestions={suggestions} autoColor={defaultColor} />
          {clash ? (
            <p className="note-err" role="alert">
              Overlaps {clash.company}, {fmt(clash.start)}–{fmt(clash.end)}. Move it or change the time.
            </p>
          ) : null}
          <button type="submit" className="primary" disabled={!!clash || !whoReady(who)}>
            Book {fmt(draft.start)}–{fmt(draft.end)}
          </button>
        </form>
      ) : null}

      {selected && !selected.id.startsWith("tmp-") ? (
        <div className="sheet" role="dialog" aria-label="Booking">
          <div className="sheet__head">
            <p className="sheet__title info__title">
              <span className="info__dot" style={{ background: colorOf(selected) }} aria-hidden="true" />
              {selected.company}
            </p>
            <button type="button" className="icon" aria-label="Close" onClick={() => setSelectedId(null)} autoFocus>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
              </svg>
            </button>
          </div>
          <dl className="info">
            <dt>Day</dt>
            <dd>{parseDate(selected.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</dd>
            <dt>Time</dt>
            <dd>
              {fmt(selected.start)}–{fmt(selected.end)}
            </dd>
            <dt>Room</dt>
            <dd>{roomLabel(selected.room)}</dd>
            <dt>Email</dt>
            <dd>
              {selected.email ? (
                <a className="sheet__mail" href={`mailto:${selected.email}`}>
                  {selected.email}
                </a>
              ) : (
                <span className="info__none">Not added</span>
              )}
            </dd>
          </dl>
          {hasEnded(selected) ? (
            <p className="sheet__note">This booking has ended.</p>
          ) : (
            <div className="sheet__row">
              <button type="button" className="danger" onClick={() => remove(selected)}>
                Delete
              </button>
              <button type="button" className="primary" onClick={() => startEdit(selected)}>
                Edit
              </button>
            </div>
          )}
        </div>
      ) : null}

      {dialog ? (
        <BookDialog
          initialDate={date}
          today={today}
          earliestToday={earliestToday}
          who={who}
          onWho={setWho}
          suggestions={suggestions}
          autoColor={defaultColor}
          onBook={async (d, r) => {
            const ok = await book(d, r);
            if (ok && d !== date) setDate(d);
            return ok;
          }}
          onClose={() => setDialog(false)}
        />
      ) : null}

      <div className="toasts" aria-live="polite">
        {error ? (
          <div className="err" role="alert" key={error}>
            {error}
          </div>
        ) : null}
        {toast ? (
          <UndoToast
            key={toast.key}
            open={toast.open}
            message={toast.message}
            duration={3000}
            onUndo={() => {
              toast.onUndo?.();
              window.setTimeout(closeToast, 800);
            }}
            onExpire={closeToast}
          />
        ) : null}
      </div>
    </div>
  );
}
