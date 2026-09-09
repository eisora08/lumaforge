import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

type SourceDropdownOption = {
  value: string;
  label: string;
};

type SourceDropdownProps = {
  value: string;
  onChange: (v: string) => void;
  options: SourceDropdownOption[];
  label?: string;
  className?: string;
  /** Render dropdown menu via portal to escape overflow containers */
  portal?: boolean;
};

export default function SourceDropdown({
  value,
  onChange,
  options,
  label,
  className = "",
  portal = false,
}: SourceDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });

  const updateMenuPos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        ref.current && !ref.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Recalculate position on scroll/resize while open
  useEffect(() => {
    if (!open || !portal) return;
    const recalc = () => updateMenuPos();
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
    };
  }, [open, portal, updateMenuPos]);

  const selected = options.find((o) => o.value === value);

  const menuContent = open && (
    <div
      ref={menuRef}
      className={`lf-dropdown-menu z-50 mt-1 min-w-full max-h-60 overflow-y-auto rounded-lg border border-(--surface-active-border) bg-(--surface-active) shadow-lg backdrop-blur-md ${
        portal ? "fixed" : "absolute"
      }`}
      style={portal ? {
        top: menuPos.top,
        left: menuPos.left,
        minWidth: menuPos.width,
      } : undefined}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => {
            onChange(opt.value);
            setOpen(false);
          }}
          className={`flex w-full items-center whitespace-nowrap px-3 py-1.5 text-sm transition-colors duration-100 cursor-pointer ${
            opt.value === value
              ? "text-(--color-accent) bg-(--color-accent)/10"
              : "text-(--color-text) hover:bg-white/[0.06]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  const isFullWidth = className.includes("w-full");

  return (
    <div ref={ref} className={`relative ${isFullWidth ? "block" : "inline-block"} ${className}`}>
      {label && (
        <span className="mr-1.5 text-[10px] font-medium text-(--color-muted) uppercase tracking-wider">
          {label}
        </span>
      )}
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (!open) updateMenuPos();
          setOpen(!open);
        }}
        className={`flex items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-(--color-surface)/50 px-3 py-2 text-sm text-(--color-text) backdrop-blur-sm transition hover:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-(--color-accent)/50 cursor-pointer ${isFullWidth ? "w-full justify-between" : ""}`}
      >
        <span>{selected?.label}</span>
        <ChevronDown
          className={`h-3 w-3 text-(--color-muted) transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {portal ? createPortal(menuContent, document.body) : menuContent}
    </div>
  );
}
