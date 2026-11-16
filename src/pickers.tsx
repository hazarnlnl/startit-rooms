// Date and list pickers in the Cargo style (the calendar follows Cargo's DateRange block).
// They replace the browser's own date input and <select>, whose icons and sizing vary by browser.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { isoDate, parseDate } from "./rooms";
import "./pickers.css";

/** Open/close with outside-click and Esc; flips upward when there's no room below. */
function usePopover(panelHeight: number) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setUp(window.innerHeight - r.bottom < panelHeight + 16 && r.top > window.innerHeight - r.bottom);
  }, [open, panelHeight]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };
  return { open, setOpen, up, rootRef, btnRef, close };
}

const Chevron = () => (
  <svg className="pk__chev" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5 6.5 8 9.5l3-3" />
  </svg>
);

const CalendarIcon = () => (
  <svg className="pk__icon" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
    <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
  </svg>
);

export const ClockIcon = () => (
  <svg className="pk__icon" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3l2 1.5" />
  </svg>
);

export const RoomIcon = () => (
  <svg className="pk__icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 13.5V3.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v10M1.5 13.5h13M10 8.2v.1" />
  </svg>
);

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** A day field that opens a month calendar. Arrows move a day, Enter picks, Esc closes. */
export function DateField({ label, value, min, onChange }: { label: string; value: string; min?: string; onChange: (iso: string) => void }) {
  const pop = usePopover(330);
  const selected = parseDate(value);
  const minDate = min ? parseDate(min) : null;
  const today = parseDate(isoDate(new Date()));
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const [dir, setDir] = useState(0);
  const [focusDay, setFocusDay] = useState(selected);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pop.open) return;
    setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setFocusDay(selected);
    setDir(0);
    requestAnimationFrame(() => gridRef.current?.focus({ preventScroll: true }));
  }, [pop.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const page = (n: number) => {
    setDir(n);
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  };
  const disabled = (d: Date) => !!minDate && d < minDate;
  const pick = (d: Date) => {
    if (disabled(d)) return;
    onChange(isoDate(d));
    pop.close();
  };

  const first = (month.getDay() + 6) % 7; // Monday first
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  while (cells.length < 42) cells.push(null); // same height every month

  const onKeyDown = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) {
      e.preventDefault();
      const n = addDays(focusDay, step);
      setFocusDay(n);
      if (n.getMonth() !== month.getMonth() || n.getFullYear() !== month.getFullYear()) page(n > month ? 1 : -1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(focusDay);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      pop.close();
    }
  };

  const atMinMonth = !!minDate && month <= new Date(minDate.getFullYear(), minDate.getMonth(), 1);

  return (
    <div className="fld">
      <span className="fld__label">{label}</span>
      <div ref={pop.rootRef} className="pk" data-open={pop.open || undefined} data-up={pop.up || undefined}>
        <button ref={pop.btnRef} type="button" className="pk__btn" aria-haspopup="dialog" aria-expanded={pop.open} aria-label={`${label}: ${selected.toDateString()}`} onClick={() => pop.setOpen(!pop.open)}>
          <CalendarIcon />
          <span className="pk__val">{selected.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
          <Chevron />
        </button>
        <div className="pk__panel pk__panel--cal" role="dialog" aria-label="Choose a day">
          <div className="dp__top">
            <span className="dp__month" key={month.toISOString()} data-dir={dir}>
              {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
            </span>
            <div className="dp__nav">
              <button type="button" aria-label="Previous month" onClick={() => page(-1)} disabled={atMinMonth} tabIndex={pop.open ? 0 : -1}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M10 4 6 8l4 4" />
                </svg>
              </button>
              <button type="button" aria-label="Next month" onClick={() => page(1)} tabIndex={pop.open ? 0 : -1}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m6 4 4 4-4 4" />
                </svg>
              </button>
            </div>
          </div>
          <div className="dp__dow" aria-hidden="true">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div
            ref={gridRef}
            key={month.toISOString()}
            className="dp__grid"
            data-dir={dir}
            role="grid"
            aria-label="Calendar"
            tabIndex={pop.open ? 0 : -1}
            onKeyDown={onKeyDown}
          >
            {cells.map((d, i) =>
              !d ? (
                <span key={i} />
              ) : (
                <button
                  key={i}
                  type="button"
                  tabIndex={-1}
                  className="dp__day"
                  data-selected={sameDay(d, selected) || undefined}
                  data-today={sameDay(d, today) || undefined}
                  data-focus={sameDay(d, focusDay) || undefined}
                  disabled={disabled(d)}
                  aria-label={d.toDateString()}
                  aria-pressed={sameDay(d, selected)}
                  onClick={() => (setFocusDay(d), pick(d))}
                >
                  <span>{d.getDate()}</span>
                </button>
              ),
            )}
          </div>
          <div className="dp__foot">
            <button type="button" className="dp__today" disabled={disabled(today)} onClick={() => pick(today)} tabIndex={pop.open ? 0 : -1}>
              Today
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export type ListOption<T> = { value: T; label: string };

/** A select in the Cargo style: a field button that opens a scrolling list. Arrows move, Enter picks. */
export function ListField<T extends string | number>({
  label,
  value,
  options,
  onChange,
  icon,
}: {
  label: string;
  value: T;
  options: ListOption<T>[];
  onChange: (v: T) => void;
  icon?: ReactNode;
}) {
  const pop = usePopover(240);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  // Option position inside the scrolling list (its offsetParent is the panel, not the list).
  const optionBox = (i: number) => {
    const list = listRef.current;
    const el = list?.children[i] as HTMLElement | undefined;
    return list && el ? { list, top: el.offsetTop - list.offsetTop, h: el.offsetHeight } : null;
  };

  // Opening: the current value sits in the middle of the list.
  useLayoutEffect(() => {
    if (!pop.open) return;
    const i = Math.max(0, options.findIndex((o) => o.value === value));
    setActive(i);
    const b = optionBox(i);
    if (b) b.list.scrollTop = b.top - b.list.clientHeight / 2 + b.h / 2;
    listRef.current?.focus({ preventScroll: true });
  }, [pop.open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arrow keys: scroll only as much as needed to keep the active option visible.
  const moveTo = (i: number) => {
    setActive(i);
    const b = optionBox(i);
    if (!b) return;
    if (b.top < b.list.scrollTop) b.list.scrollTop = b.top;
    else if (b.top + b.h > b.list.scrollTop + b.list.clientHeight) b.list.scrollTop = b.top + b.h - b.list.clientHeight;
  };

  const pick = (v: T) => {
    onChange(v);
    pop.close();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") (e.preventDefault(), moveTo(Math.min(options.length - 1, active + 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), moveTo(Math.max(0, active - 1)));
    else if ((e.key === "Enter" || e.key === " ") && options[active]) (e.preventDefault(), pick(options[active].value));
    else if (e.key === "Escape") (e.stopPropagation(), pop.close());
  };

  return (
    <div className="fld">
      <span className="fld__label">{label}</span>
      <div ref={pop.rootRef} className="pk" data-open={pop.open || undefined} data-up={pop.up || undefined}>
        <button ref={pop.btnRef} type="button" className="pk__btn" aria-haspopup="listbox" aria-expanded={pop.open} aria-label={`${label}: ${current?.label ?? ""}`} onClick={() => pop.setOpen(!pop.open)}>
          {icon}
          <span className="pk__val">{current?.label ?? "—"}</span>
          <Chevron />
        </button>
        <div className="pk__panel">
          <div ref={listRef} className="pk__list" role="listbox" aria-label={label} tabIndex={pop.open ? 0 : -1} onKeyDown={onKeyDown} aria-activedescendant={undefined}>
            {options.map((o, i) => (
              <div
                key={String(o.value)}
                role="option"
                aria-selected={o.value === value}
                data-active={i === active || undefined}
                className="pk__opt"
                onMouseMove={() => setActive(i)}
                onClick={() => pick(o.value)}
              >
                <span>{o.label}</span>
                <svg className="pk__check" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 8.5 6.8 11.2 12 5.5" />
                </svg>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
