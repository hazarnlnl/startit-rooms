import { useEffect, useState } from "react";
import "./undo-toast.css";

export type UndoToastProps = {
  /** Shown while true. Set false to dismiss it. */
  open: boolean;
  message: string;
  actionLabel?: string;
  /** Shown briefly after Undo, before it leaves. */
  undoneMessage?: string;
  /** How long Undo stays available, in ms. */
  duration?: number;
  onUndo?: () => void;
  /** Time ran out: the action is final now. */
  onExpire?: () => void;
};

/**
 * "3 emails archived · Undo", with a line that drains while Undo is still possible.
 * The timer pauses while you hover it or the tab is hidden, so it never expires unseen.
 * The drain is a CSS animation; when it ends, the toast expires.
 */
export function UndoToast({ open, message, actionLabel = "Undo", undoneMessage = "Undone", duration = 5000, onUndo, onExpire }: UndoToastProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [undone, setUndone] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Mount, then show on the next frame so the enter transition runs; hide, then unmount after the exit.
  useEffect(() => {
    if (open) {
      setUndone(false);
      setMounted(true);
      // A tick after mounting, so the enter transition has a start state (works in background tabs too).
      const r = window.setTimeout(() => setVisible(true), 20);
      return () => window.clearTimeout(r);
    }
    setVisible(false);
    const t = window.setTimeout(() => setMounted(false), 200);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  if (!mounted) return null;

  return (
    <div className="ut" data-visible={visible || undefined} data-undone={undone || undefined} data-paused={hidden || undefined} role="status">
      <span className="ut__msg" key={undone ? "undone" : "msg"}>
        {undone ? (
          <>
            <svg className="ut__check" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.5 8.5 6.5 11.5 12.5 5" />
            </svg>
            {undoneMessage}
          </>
        ) : (
          message
        )}
      </span>
      {!undone ? (
        <button
          type="button"
          className="ut__action"
          onClick={() => {
            setUndone(true);
            onUndo?.();
          }}
        >
          {actionLabel}
        </button>
      ) : null}
      {!undone ? <span className="ut__drain" style={{ animationDuration: `${duration}ms` }} onAnimationEnd={onExpire} aria-hidden="true" /> : null}
    </div>
  );
}
