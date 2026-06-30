import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

type TooltipProps = {
  children: React.ReactNode;
  label: string;
  delay?: number;
  disabled?: boolean;
};

export default function Tooltip({
  children,
  label,
  delay = 300,
  disabled = false,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  function show() {
    if (disabled) return;
    clearTimer();
    timerRef.current = setTimeout(() => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 6,
        left: rect.left + rect.width / 2,
      });
      setVisible(true);
    }, delay);
  }

  function hide() {
    clearTimer();
    setVisible(false);
  }

  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  return (
    <div
      ref={triggerRef}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}

      {visible && createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-1 rounded-lg bg-(--color-surface) px-2.5 py-1 text-[11px] font-medium text-(--color-text) shadow-lg lf-tooltip-enter"
          style={{ top: pos.top, left: pos.left }}
        >
          {label}
        </div>,
        document.body
      )}
    </div>
  );
}
