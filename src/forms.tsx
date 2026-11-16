import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { TextField } from "./cargo/text-field/TextField";
import { api } from "./api";
import { ClockIcon, DateField, ListField } from "./pickers";
import { ROOMS, DAY_START, DAY_END, STEP, DEFAULT_LENGTH, PALETTE, fmt, type Booking, type RoomId } from "./rooms";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Range = { room: RoomId; start: number; end: number };
/** color "" means automatic: the company's usual color. */
export type Who = { company: string; email: string; emailOpen: boolean; color: string };

export const overlapOf = (r: Range, list: Booking[]) => list.find((b) => b.room === r.room && b.start < r.end && r.start < b.end) ?? null;

export const whoReady = (w: Who) => w.company.trim().length > 0 && (!w.email.trim() || EMAIL_RE.test(w.email.trim()));

const COLS = 10;

/** A swatch button that opens 30 preset colors. Arrows move, Enter/Space pick, Esc closes. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const swRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const i = Math.max(0, PALETTE.indexOf(value));
    swRefs.current[i]?.focus({ preventScroll: true });
    const close = (e: PointerEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
      return;
    }
    const i = swRefs.current.findIndex((el) => el === document.activeElement);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key];
    if (step === undefined || i < 0) return;
    e.preventDefault();
    swRefs.current[(i + step + PALETTE.length) % PALETTE.length]?.focus();
  };

  return (
    <div ref={rootRef} className="cp" data-open={open || undefined}>
      <button
        ref={btnRef}
        type="button"
        className="cp__btn"
        aria-label="Booking color"
        aria-haspopup="true"
        aria-expanded={open}
        style={{ ["--sw" as string]: value }}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="cp__dot" />
        <svg className="cp__chev" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5 6.5 8 9.5l3-3" />
        </svg>
      </button>
      <div className="cp__panel" role="group" aria-label="Pick a color" onKeyDown={onKeyDown}>
        {PALETTE.map((c, i) => (
          <button
            key={c}
            ref={(el) => {
              swRefs.current[i] = el;
            }}
            type="button"
            className="cp__sw"
            style={{ ["--sw" as string]: c }}
            aria-label={`Color ${i + 1}`}
            aria-pressed={c === value}
            tabIndex={open ? 0 : -1}
            onClick={() => {
              onChange(c);
              setOpen(false);
              btnRef.current?.focus();
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 8.5 6.8 11.2 12 5.5" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Company (with its color swatch), plus an "Add email" link that opens the email field.
 * Shared by the new-booking panel, the edit panel and the dialog.
 * `autoColor` is what the swatch shows until a color is picked.
 */
export function WhoFields({ who, onChange, suggestions, autoColor }: { who: Who; onChange: (w: Who) => void; suggestions: string[]; autoColor: string }) {
  return (
    <div className="who-fields">
      <div className="company-row">
        {/* The label sits above both boxes, so the field and the swatch share one top edge */}
        <span className="fld__label company-row__label" aria-hidden="true">
          Company
        </span>
        <TextField
          label="Company"
          defaultValue={who.company}
          placeholder="e.g. Prompt Journey"
          maxLength={60}
          list="companies"
          autoComplete="organization"
          autoFocus={!who.company}
          onChange={(company) => onChange({ ...who, company })}
        />
        <ColorPicker value={who.color || autoColor} onChange={(color) => onChange({ ...who, color })} />
      </div>
      <datalist id="companies">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {who.emailOpen ? (
        <TextField
          label="Email"
          type="email"
          defaultValue={who.email}
          placeholder="you@company.com"
          maxLength={100}
          autoComplete="email"
          autoFocus={!who.email}
          helper="Shown on the booking so others can reach you."
          validate={(v) => (EMAIL_RE.test(v.trim()) ? null : "That email doesn't look right")}
          onChange={(email) => onChange({ ...who, email })}
        />
      ) : (
        <button type="button" className="addmail" onClick={() => onChange({ ...who, emailOpen: true })}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
          Add email
        </button>
      )}
    </div>
  );
}

export const TIMES =Array.from({ length: (DAY_END - DAY_START) / STEP + 1 }, (_, i) => DAY_START + i * STEP);

/** "Book a room" without the grid: pick a day, time and room, then book. */
export function BookDialog({
  initialDate,
  today,
  earliestToday,
  who,
  onWho,
  suggestions,
  autoColor,
  onBook,
  onClose,
}: {
  initialDate: string;
  today: string;
  earliestToday: number;
  who: Who;
  onWho: (w: Who) => void;
  suggestions: string[];
  autoColor: string;
  onBook: (date: string, r: Range) => Promise<boolean>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate < today ? today : initialDate);
  const minStart = date === today ? earliestToday : DAY_START;
  const [start, setStart] = useState(() => Math.max(minStart, date === today ? minStart : 9 * 60));
  const [end, setEnd] = useState(() => Math.min(DAY_END, Math.max(minStart, date === today ? minStart : 9 * 60) + DEFAULT_LENGTH));
  const [room, setRoom] = useState<RoomId | null>(null);
  const [dayBookings, setDayBookings] = useState<Booking[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setDayBookings(null);
    api
      .list(date)
      .then((l) => live && setDayBookings(l))
      .catch(() => live && setDayBookings([]));
    return () => {
      live = false;
    };
  }, [date]);

  // Keep the times valid when the day changes (e.g. to today, where the morning has passed).
  useEffect(() => {
    if (start < minStart) {
      const len = end - start;
      setStart(minStart);
      setEnd(Math.min(DAY_END, minStart + len));
    }
  }, [minStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = useMemo(
    () => Object.fromEntries(ROOMS.map((r) => [r.id, dayBookings ? overlapOf({ room: r.id, start, end }, dayBookings) : null])) as Record<RoomId, Booking | null>,
    [dayBookings, start, end],
  );

  /** For a busy room: the first start at or after the asked time where a meeting of the same length fits. */
  const nextFree = useMemo(() => {
    const len = end - start;
    const out = {} as Record<RoomId, number | null>;
    for (const r of ROOMS) {
      out[r.id] = null;
      if (!dayBookings || !status[r.id]) continue;
      for (let t = Math.max(start, minStart); t + len <= DAY_END; t += STEP) {
        if (!overlapOf({ room: r.id, start: t, end: t + len }, dayBookings)) {
          out[r.id] = t;
          break;
        }
      }
    }
    return out;
  }, [dayBookings, status, start, end, minStart]);

  // Pick the first free room by default, and move off a room that becomes busy.
  useEffect(() => {
    if (!dayBookings) return;
    if (!room || status[room]) setRoom(ROOMS.find((r) => !status[r.id])?.id ?? room);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const roomBusy = room ? status[room] : null;
  const canBook = !!room && !roomBusy && !!dayBookings && end > start && whoReady(who) && !busy;
  const allBusy = !!dayBookings && ROOMS.every((r) => status[r.id]);

  const submit = async () => {
    if (!canBook || !room) return;
    setBusy(true);
    const ok = await onBook(date, { room, start, end });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Book a room"
        onSubmit={(e) => (e.preventDefault(), submit())}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="sheet__head">
          <p className="sheet__title">Book a room</p>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
            </svg>
          </button>
        </div>

        <div className="row3">
          <div className="fld--date">
            <DateField label="Day" value={date} min={today} onChange={setDate} />
          </div>
          <ListField
            label="From"
            icon={<ClockIcon />}
            value={start}
            options={TIMES.filter((t) => t >= minStart && t < DAY_END).map((t) => ({ value: t, label: fmt(t) }))}
            onChange={(s) => {
              const len = end - start;
              setStart(s);
              setEnd(Math.min(DAY_END, s + len));
            }}
          />
          <ListField label="To" icon={<ClockIcon />} value={end} options={TIMES.filter((t) => t > start).map((t) => ({ value: t, label: fmt(t) }))} onChange={setEnd} />
        </div>

        <div className="fld">
          <span className="fld__label">Room</span>
          <div className="rooms-pick" role="radiogroup" aria-label="Room">
            {ROOMS.map((r) => {
              const clash = status[r.id];
              const next = nextFree[r.id];
              const len = end - start;
              return (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={room === r.id}
                  aria-label={`${r.name}, ${r.detail}: ${
                    !dayBookings ? "checking" : clash ? `busy, ${clash.company}. ${next !== null ? `Select to book ${fmt(next)} to ${fmt(next + len)} instead` : "No free time later today"}` : "free"
                  }`}
                  disabled={!dayBookings || (!!clash && next === null)}
                  className="rp"
                  data-busy={clash ? true : undefined}
                  onClick={() => {
                    // A busy room jumps to its next free time, same length.
                    if (clash && next !== null) {
                      setStart(next);
                      setEnd(next + len);
                    }
                    setRoom(r.id);
                  }}
                >
                  <span className="rp__name">{r.name}</span>
                  <span className="rp__detail">{r.detail}</span>
                  <span className="rp__status" data-busy={!!clash || undefined}>
                    {!dayBookings ? "Checking…" : clash ? `Busy · ${clash.company}` : "Free"}
                  </span>
                  {clash && dayBookings ? (
                    <span className="rp__next" data-action={next !== null || undefined}>
                      {next !== null ? `Book ${fmt(next)}–${fmt(next + len)} instead` : "No free time later today"}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {allBusy ? <p className="note-err">Every room is taken then. Try another time.</p> : null}
        </div>

        <WhoFields who={who} onChange={onWho} suggestions={suggestions} autoColor={autoColor} />

        <button type="submit" className="primary" disabled={!canBook}>
          {busy ? "Booking…" : `Book ${fmt(start)}–${fmt(end)}`}
        </button>
      </form>
    </>
  );
}
