import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

type MenuPosition = {
  top: number;
  left: number;
  anchorRight?: boolean;
  openUpward?: boolean;
};

type CardActionMenuProps = {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
};

const VIEWPORT_MARGIN = 8;
const MENU_WIDTH = 184;

export default function CardActionMenu({
  open,
  anchorRef,
  onClose,
  children,
}: CardActionMenuProps) {
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const recalcPosition = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const spaceBelow = vh - rect.bottom;
    const spaceRight = vw - rect.right;
    const openUpward = spaceBelow < 180;
    const anchorRight = spaceRight < MENU_WIDTH + VIEWPORT_MARGIN;

    let top: number;
    let left: number;

    if (openUpward) {
      top = rect.top - VIEWPORT_MARGIN;
    } else {
      top = rect.bottom + VIEWPORT_MARGIN;
    }

    if (anchorRight) {
      left = rect.right - MENU_WIDTH + VIEWPORT_MARGIN;
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    } else {
      left = rect.left;
      if (left + MENU_WIDTH > vw - VIEWPORT_MARGIN) {
        left = vw - MENU_WIDTH - VIEWPORT_MARGIN;
      }
    }

    if (top < VIEWPORT_MARGIN) {
      top = VIEWPORT_MARGIN;
    }

    setPos({ top, left, anchorRight, openUpward });
  }, [anchorRef]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }

    recalcPosition();

    const handleResize = () => recalcPosition();
    const handleScroll = () => {
      onClose();
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, recalcPosition, onClose]);

  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[55] w-[184px] overflow-hidden rounded-xl border border-(--surface-active-border)/60 bg-(--color-bg) p-1 shadow-2xl lf-popover-enter"
      style={{ top: pos.top, left: pos.left }}
    >
      {children}
    </div>,
    document.body
  );
}

export function MenuItem({
  label,
  icon,
  disabled,
  subtitle,
  destructive,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  subtitle?: string;
  destructive?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition ${
        disabled
          ? "cursor-not-allowed text-(--color-muted)/40"
          : destructive
            ? "cursor-pointer text-red-400 hover:bg-red-500/10"
            : "cursor-pointer text-(--color-text) hover:bg-white/5"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {subtitle && (
        <span className="text-[10px] text-(--color-muted)">{subtitle}</span>
      )}
    </button>
  );
}
