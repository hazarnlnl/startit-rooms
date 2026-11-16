import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";
import "./text-field.css";

export type FieldState = "idle" | "checking" | "valid" | "error";

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  label: string;
  helper?: string;
  /** Return an error message, or null when it's fine. Can be async (e.g. "is this name taken?"). */
  validate?: (value: string) => string | null | Promise<string | null>;
  validMessage?: string;
  prefix?: string;
  onChange?: (value: string) => void;
};

/**
 * A text field that validates kindly: never while you're still typing the first time,
 * only after you leave it; from then on it re-checks as you type (debounced).
 * The message under it slides open, and the icon morphs between check, spinner and alert.
 */
export function TextField({ label, helper, validate, validMessage, prefix, onChange, ...input }: TextFieldProps) {
  const id = useId();
  const [value, setValue] = useState(String(input.defaultValue ?? ""));
  const [touched, setTouched] = useState(false);
  const [state, setState] = useState<FieldState>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const run = useRef(0);

  useEffect(() => {
    if (!touched || !validate) return;
    if (!value) {
      setState("idle");
      setMsg(null);
      return;
    }
    const id = ++run.current;
    const t = window.setTimeout(() => {
      const r = validate(value);
      if (r instanceof Promise) {
        setState("checking");
        r.then((m) => {
          if (run.current !== id) return;
          setState(m ? "error" : "valid");
          setMsg(m);
        });
      } else {
        setState(r ? "error" : "valid");
        setMsg(r);
      }
    }, 280);
    return () => window.clearTimeout(t);
  }, [value, touched]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = state === "error" ? msg : state === "valid" ? validMessage ?? null : state === "checking" ? "Checking…" : helper ?? null;

  return (
    <div className="tf" data-state={state}>
      <label className="tf__label" htmlFor={id}>
        {label}
      </label>
      <div className="tf__box">
        {prefix ? <span className="tf__prefix">{prefix}</span> : null}
        <input
          {...input}
          id={id}
          className="tf__input"
          value={value}
          aria-invalid={state === "error" || undefined}
          aria-describedby={`${id}-msg`}
          onChange={(e) => {
            setValue(e.target.value);
            onChange?.(e.target.value);
          }}
          onBlur={() => setTouched(true)}
        />
        <span className="tf__icon" aria-hidden="true">
          <svg className="tf__i tf__i--ok" viewBox="0 0 16 16">
            <path d="M4 8.5 6.8 11.2 12 5.5" />
          </svg>
          <svg className="tf__i tf__i--err" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 5v3.4M8 10.8v.1" />
          </svg>
          <svg className="tf__i tf__i--spin" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="5.5" />
          </svg>
        </span>
      </div>
      <div className="tf__msgWrap" data-open={!!shown || undefined}>
        <p id={`${id}-msg`} className="tf__msg" role={state === "error" ? "alert" : undefined} key={shown ?? ""}>
          {shown}
        </p>
      </div>
    </div>
  );
}
