import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import "./segmented.css";

export type SegmentedProps = {
  options: string[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  label: string;
};

/**
 * Pick one of a few options. The selected pill slides between them.
 * A second, "selected" copy of the labels sits on top and is clipped to the pill,
 * so the text color flips exactly at the pill's edge, mid-slide.
 */
export function Segmented({ options, value, defaultValue, onChange, label }: SegmentedProps) {
  const [inner, setInner] = useState(defaultValue ?? options[0]);
  const active = value ?? inner;
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [clip, setClip] = useState<string>();

  const place = () => {
    const root = rootRef.current;
    const btn = btnRefs.current[options.indexOf(active)];
    if (!root || !btn) return;
    const left = btn.offsetLeft;
    const right = root.clientWidth - left - btn.offsetWidth;
    setClip(`inset(4px ${right}px 4px ${left}px round 999px)`);
  };

  useLayoutEffect(() => {
    place();
    const ro = new ResizeObserver(place);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, [active, options.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (v: string) => {
    if (value === undefined) setInner(v);
    onChange?.(v);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const i = options.indexOf(active);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : -2;
    if (next === -2) return;
    e.preventDefault();
    const n = (next + options.length) % options.length;
    select(options[n]);
    btnRefs.current[n]?.focus();
  };

  return (
    <div ref={rootRef} className="seg" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o}
          ref={(el) => {
            btnRefs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o === active}
          tabIndex={o === active ? 0 : -1}
          className="seg__opt"
          onClick={() => select(o)}
        >
          {o}
        </button>
      ))}
      {/* The selected look, clipped to the active option */}
      <div className="seg__active" style={{ clipPath: clip }} aria-hidden="true">
        {options.map((o) => (
          <span key={o} className="seg__opt">
            {o}
          </span>
        ))}
      </div>
    </div>
  );
}
