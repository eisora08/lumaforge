import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";

type MenuPosition = {
  top: number;
  left: number;
};

export type MenuItemProps = {
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  subtitle?: string;
  destructive?: boolean;
  onClick?: () => void;
  children?: MenuItemProps[];
};

type CardActionMenuProps = {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  cursorPos?: { x: number; y: number } | null;
  gameId?: string;
};

const VIEWPORT_MARGIN = 8;
const MENU_WIDTH = 184;
const MENU_HEIGHT = 180;
const SUBMENU_WIDTH = 172;
const SUBMENU_DELAY = 200;
const EXIT_MS = 140;

export default function CardActionMenu({
  open,
  anchorRef,
  onClose,
  children,
  cursorPos,
  gameId: _gameId,
}: CardActionMenuProps) {
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const wasOpenRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      setClosing(false);
      return;
    }

    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      setClosing(true);
      closeTimerRef.current = setTimeout(() => {
        setClosing(false);
        setPos(null);
      }, EXIT_MS);
    }
  }, [open]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    []
  );

  const recalcPosition = useCallback(() => {
    if (cursorPos) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = cursorPos.y;
      let left = cursorPos.x;

      if (vh - top < MENU_HEIGHT) {
        top -= MENU_HEIGHT;
      }

      if (left + MENU_WIDTH > vw - VIEWPORT_MARGIN) {
        left = vw - MENU_WIDTH - VIEWPORT_MARGIN;
      }

      if (top < VIEWPORT_MARGIN) {
        top = VIEWPORT_MARGIN;
      }
      if (top + MENU_HEIGHT > vh - VIEWPORT_MARGIN) {
        top = vh - MENU_HEIGHT - VIEWPORT_MARGIN;
      }
      if (left < VIEWPORT_MARGIN) {
        left = VIEWPORT_MARGIN;
      }

      setPos({ top, left });
      return;
    }

    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const spaceBelow = vh - rect.bottom;
    const openUpward = spaceBelow < 180;

    let top: number;
    let left: number;

    if (openUpward) {
      top = rect.top - VIEWPORT_MARGIN;
    } else {
      top = rect.bottom + VIEWPORT_MARGIN;
    }

    if (rect.right + MENU_WIDTH > vw - VIEWPORT_MARGIN) {
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

    setPos({ top, left });
  }, [anchorRef, cursorPos]);

  useEffect(() => {
    if (!open) {
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
      const target = e.target as HTMLElement;
      if (target.closest("[data-submenu]")) return;
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

  if ((!open && !closing) || !pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className={`fixed z-[100000] w-[184px] overflow-hidden rounded-xl border border-(--surface-active-border)/60 lf-surface p-1 shadow-2xl ${closing ? "lf-popover-exit" : "lf-popover-enter"}`}
      style={{ top: pos.top, left: pos.left }}
    >
      {children}
    </div>,
    document.body
  );
}

function SubmenuPanel({
  items,
  anchorRect,
  onItemClick,
}: {
  items: MenuItemProps[];
  anchorRect: DOMRect;
  onItemClick: () => void;
}) {
  const [pos, setPos] = useState<MenuPosition | null>(null);

  useEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = anchorRect.right + 4;
    let top = anchorRect.top;
    const estimatedHeight = items.length * 32 + 8;

    if (left + SUBMENU_WIDTH > vw - VIEWPORT_MARGIN) {
      left = anchorRect.left - SUBMENU_WIDTH - 4;
    }
    if (top + estimatedHeight > vh - VIEWPORT_MARGIN) {
      top = vh - estimatedHeight - VIEWPORT_MARGIN;
    }
    if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

    setPos({ top, left });
  }, [anchorRect, items.length]);

  if (!pos) return null;

  return createPortal(
    <div
      data-submenu
      className="fixed z-[100001] w-[172px] overflow-hidden rounded-xl border border-(--surface-active-border)/60 lf-surface p-1 shadow-2xl lf-popover-enter"
      style={{ top: pos.top, left: pos.left }}
    >
      {items.map((item, i) => (
        <SubmenuItem key={i} {...item} onClose={onItemClick} />
      ))}
    </div>,
    document.body
  );
}

function SubmenuItem({
  label,
  icon,
  disabled,
  subtitle,
  destructive,
  onClick,
  onClose,
}: MenuItemProps & { onClose: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onClick?.();
        onClose();
      }}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition ${
        disabled
          ? "cursor-not-allowed text-(--color-muted)/40"
          : destructive
            ? "cursor-pointer text-red-400 hover:bg-red-500/10"
            : "cursor-pointer text-(--color-text) hover:bg-white/5"
      }`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="flex-1">{label}</span>
      {subtitle && (
        <span className="text-[10px] text-(--color-muted)">{subtitle}</span>
      )}
    </button>
  );
}

export function MenuItem({
  label,
  icon,
  disabled,
  subtitle,
  destructive,
  onClick,
  children,
}: MenuItemProps) {
  const [subOpen, setSubOpen] = useState(false);
  const [subAnchorRect, setSubAnchorRect] = useState<DOMRect | null>(null);
  const itemRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!children || !itemRef.current) return;
    setSubAnchorRect(itemRef.current.getBoundingClientRect());
    setSubOpen(true);
  }, [children]);

  const handleMouseLeave = useCallback(() => {
    if (children) {
      hideTimer.current = setTimeout(() => {
        setSubOpen(false);
        setSubAnchorRect(null);
      }, SUBMENU_DELAY);
    }
  }, [children]);

  const handleSubEnter = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const handleSubLeave = useCallback(() => {
    setSubOpen(false);
    setSubAnchorRect(null);
  }, []);

  const handleItemClick = useCallback(() => {
    setSubOpen(false);
    setSubAnchorRect(null);
  }, []);

  if (children) {
    return (
      <div
        ref={itemRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="relative"
      >
        <button
          type="button"
          role="menuitem"
          disabled={disabled}
          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition ${
            disabled
              ? "cursor-not-allowed text-(--color-muted)/40"
              : destructive
                ? "cursor-pointer text-red-400 hover:bg-red-500/10"
                : "cursor-pointer text-(--color-text) hover:bg-white/5"
          }`}
        >
          {icon && <span className="shrink-0">{icon}</span>}
          <span className="flex-1">{label}</span>
          {subtitle && (
            <span className="text-[10px] text-(--color-muted)">{subtitle}</span>
          )}
          <ChevronRight className="h-3 w-3 text-(--color-muted)" />
        </button>
        {subOpen && subAnchorRect && (
          <div onMouseEnter={handleSubEnter} onMouseLeave={handleSubLeave}>
            <SubmenuPanel
              items={children}
              anchorRect={subAnchorRect}
              onItemClick={handleItemClick}
            />
          </div>
        )}
      </div>
    );
  }

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
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="flex-1">{label}</span>
      {subtitle && (
        <span className="text-[10px] text-(--color-muted)">{subtitle}</span>
      )}
    </button>
  );
}
