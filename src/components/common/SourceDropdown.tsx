import { useState, useRef, useEffect } from "react";
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
};

export default function SourceDropdown({
  value,
  onChange,
  options,
  label,
  className = "",
}: SourceDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      {label && (
        <span className="mr-1.5 text-[10px] font-medium text-(--color-muted) uppercase tracking-wider">
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-(--color-surface)/50 px-2.5 py-1 text-[10px] text-(--color-text) backdrop-blur-sm transition hover:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-(--color-accent)/50 cursor-pointer"
      >
        <span>{selected?.label}</span>
        <ChevronDown
          className={`h-3 w-3 text-(--color-muted) transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="lf-dropdown-menu absolute z-50 mt-1 min-w-full overflow-hidden rounded-lg border border-(--surface-active-border) bg-(--surface-active) shadow-lg backdrop-blur-md">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`flex w-full items-center whitespace-nowrap px-2.5 py-1.5 text-[10px] transition-colors duration-100 cursor-pointer ${
                opt.value === value
                  ? "text-(--color-accent) bg-(--color-accent)/10"
                  : "text-(--color-text) hover:bg-white/[0.06]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
