import { useEffect, useRef } from "react";
import { setGamepadDetected } from "./consoleInputHints";

export const DEBUG_CONSOLE_GAMEPAD = false;

/* ── Standard Gamepad mapping button indices ── */
const B = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, LS: 10, RS: 11,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
} as const;

const AXIS_THRESHOLD = 0.4;
const REPEAT_INITIAL_MS = 280;
const REPEAT_INTERVAL_MS = 110;

type Dir = "up" | "down" | "left" | "right";

/**
 * Dispatch a synthetic keyboard event.
 *
 * CRITICAL: dispatch on `document.body` (not `window`) so that
 * `event.target` is an actual DOM Element. Handlers that call
 * `.closest()` or `.tagName` on the target will crash when the
 * target is `window`, because `Window` does not have `.closest()`.
 */
let _globalOnGamepadAction: (() => void) | null = null;

export function setOnGamepadAction(cb: (() => void) | null): void {
  _globalOnGamepadAction = cb;
}

/* ── Right-stick scroll target registration ── */
const _scrollTargetRef: { current: HTMLElement | null } = { current: null };

export function setScrollTarget(el: HTMLElement | null): HTMLElement | null {
  const prev = _scrollTargetRef.current;
  _scrollTargetRef.current = el;
  return prev;
}

export function getScrollTarget(): HTMLElement | null {
  return _scrollTargetRef.current;
}

function dispatchKey(key: string): void {
  const target = document.body ?? document.documentElement ?? window;
  if (DEBUG_CONSOLE_GAMEPAD) {
    const isWindow = (target as any) === window;
    console.log(`[CONSOLE_GAMEPAD][DISPATCH] key=${key} target=${isWindow ? "window" : (target as HTMLElement).tagName}`);
  }
  target.dispatchEvent(new KeyboardEvent("keydown", {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
  }));
  _globalOnGamepadAction?.();
}

type GamepadInputOptions = {
  suppressHeldOnEnable?: boolean;
};

export function useConsoleGamepadInput(enabled: boolean, options?: GamepadInputOptions): void {
  const lastConnectedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const heldButtonsRef = useRef(new Set<number>());
  const dirStateRef = useRef<Map<string, { firstPress: number; lastDispatch: number }>>(new Map());
  const gamepadIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (DEBUG_CONSOLE_GAMEPAD) {
      console.log(`[CONSOLE_GAMEPAD][HOOK_MOUNT] enabled=${enabled}`);
    }

    if (!enabled) {
      setGamepadDetected(false);
      lastConnectedRef.current = false;
      return;
    }

    if (DEBUG_CONSOLE_GAMEPAD) {
      console.log(`[CONSOLE_GAMEPAD][POLL_START]`);
    }

    const dispatchMap: Array<[number, string]> = [
      [B.A, "Enter"],
      [B.B, "Escape"],
      [B.X, "x"],
      [B.Y, "y"],
      [B.LB, "q"],
      [B.RB, "e"],
      [B.LT, "PageUp"],
      [B.RT, "PageDown"],
      [B.BACK, "v"],
      [B.START, "o"],
      [B.DPAD_UP, "ArrowUp"],
      [B.DPAD_DOWN, "ArrowDown"],
      [B.DPAD_LEFT, "ArrowLeft"],
      [B.DPAD_RIGHT, "ArrowRight"],
    ];

    const dirMap: Array<[Dir, number, number, string]> = [
      ["up", B.DPAD_UP, 1, "ArrowUp"],
      ["down", B.DPAD_DOWN, 1, "ArrowDown"],
      ["left", B.DPAD_LEFT, 0, "ArrowLeft"],
      ["right", B.DPAD_RIGHT, 0, "ArrowRight"],
    ];

    /* ── suppressHeldOnEnable: pre-populate heldButtons with already-pressed buttons ── */
    if (options?.suppressHeldOnEnable) {
      const gamepads = navigator.getGamepads?.();
      if (gamepads) {
        for (let i = 0; i < gamepads.length; i++) {
          const gp = gamepads[i];
          if (!gp) continue;
          for (let b = 0; b < gp.buttons.length; b++) {
            if (gp.buttons[b]?.pressed) {
              heldButtonsRef.current.add(b);
              if (DEBUG_CONSOLE_GAMEPAD) {
                console.log(`[INSTALL_MODAL][SUPPRESS_HELD_ON_ENABLE] button=${b}`);
              }
            }
          }
          break; // Only need one connected gamepad
        }
      }
    }

    let _getGamepadLogCount = 0;
    function getGamepad(): Gamepad | null {
      const gamepads = navigator.getGamepads?.();
      if (DEBUG_CONSOLE_GAMEPAD && (_getGamepadLogCount % 60) === 0) {
        console.log(`[CONSOLE_GAMEPAD][GET_GAMEPADS] count=${gamepads?.length ?? "undefined"}`);
      }
      _getGamepadLogCount++;
      if (!gamepads) return null;
      const idx = gamepadIndexRef.current;
      if (idx !== null && gamepads[idx]) {
        return gamepads[idx];
      }
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
          gamepadIndexRef.current = i;
          if (DEBUG_CONSOLE_GAMEPAD) {
            console.log(`[CONSOLE_GAMEPAD][CONNECTED] index=${i} id="${gamepads[i]!.id}" mapping="${gamepads[i]!.mapping}"`);
          }
          return gamepads[i];
        }
      }
      return null;
    }

    function checkConnection(): Gamepad | null {
      const gp = getGamepad();
      const connected = gp !== null;
      if (connected !== lastConnectedRef.current) {
        lastConnectedRef.current = connected;
        setGamepadDetected(connected);
        if (DEBUG_CONSOLE_GAMEPAD) {
          if (connected) {
            console.log(`[CONSOLE_GAMEPAD][CONNECTED] index=${gp!.index} id="${gp!.id}" mapping="${gp!.mapping}"`);
          } else {
            console.log(`[CONSOLE_GAMEPAD][DISCONNECTED]`);
          }
        }
      }
      return gp;
    }

    function getStickDir(gp: Gamepad): { x: number; y: number } {
      let x = 0;
      let y = 0;
      if (gp.axes.length >= 2) {
        if (Math.abs(gp.axes[0]) > AXIS_THRESHOLD) x = gp.axes[0] > 0 ? 1 : -1;
        if (Math.abs(gp.axes[1]) > AXIS_THRESHOLD) y = gp.axes[1] > 0 ? 1 : -1;
      }
      return { x, y };
    }

    function poll(): void {
      const gp = checkConnection();
      if (!gp) {
        if (DEBUG_CONSOLE_GAMEPAD) {
          // Log once per ~50 polls at most (spam reduction)
          if ((Math.floor(Date.now() / 1000) % 5) === 0 && !_lastPollLog) {
            _lastPollLog = true;
            console.log(`[CONSOLE_GAMEPAD][POLL] no-gamepad`);
          }
        }
        rafRef.current = requestAnimationFrame(poll);
        return;
      }

      // Log raw button state on frame (throttled)
      if (DEBUG_CONSOLE_GAMEPAD) {
        for (let i = 0; i <= 15; i++) {
          const btn = gp.buttons[i];
          if (btn?.pressed) {
            console.log(`[CONSOLE_GAMEPAD][RAW_BUTTON] index=${i} pressed=true value=${btn.value}`);
          }
        }
        for (let a = 0; a < Math.min(gp.axes.length, 2); a++) {
          if (Math.abs(gp.axes[a]) > AXIS_THRESHOLD) {
            console.log(`[CONSOLE_GAMEPAD][RAW_AXIS] axis=${a} value=${gp.axes[a].toFixed(3)}`);
          }
        }
      }

      const stick = getStickDir(gp);
      const now = Date.now();
      const ds = dirStateRef.current;

      for (const [dirName, dirBtn, axisIdx, arrowKey] of dirMap) {
        let pressed = false;

        // D-pad
        if (gp.buttons[dirBtn]?.pressed) pressed = true;

        // Left stick
        if (axisIdx === 0 && stick.x !== 0) pressed = true;
        if (axisIdx === 1 && stick.y !== 0) pressed = true;

        if (pressed) {
          const state = ds.get(dirName) ?? { firstPress: 0, lastDispatch: 0 };
          if (state.lastDispatch === 0) {
            if (DEBUG_CONSOLE_GAMEPAD) console.log(`[CONSOLE_GAMEPAD][NAV] direction=${dirName} zone=pressed`);
            dispatchKey(arrowKey);
            ds.set(dirName, { firstPress: now, lastDispatch: now });
          } else {
            const elapsed = now - state.firstPress;
            const sinceLast = now - state.lastDispatch;
            if (elapsed >= REPEAT_INITIAL_MS && sinceLast >= REPEAT_INTERVAL_MS) {
              if (DEBUG_CONSOLE_GAMEPAD) console.log(`[CONSOLE_GAMEPAD][NAV] direction=${dirName} zone=repeat`);
              dispatchKey(arrowKey);
              ds.set(dirName, { ...state, lastDispatch: now });
            }
          }
        } else {
          const state = ds.get(dirName);
          if (state && state.lastDispatch !== 0) {
            ds.set(dirName, { firstPress: 0, lastDispatch: 0 });
          }
        }
      }

      // ── Right-stick scroll (axes 2/3) ──
      if (gp.axes.length >= 4) {
        const rx = Math.abs(gp.axes[2]) > AXIS_THRESHOLD ? gp.axes[2] : 0;
        const ry = Math.abs(gp.axes[3]) > AXIS_THRESHOLD ? gp.axes[3] : 0;
        if (rx !== 0 || ry !== 0) {
          const target = _scrollTargetRef.current;
          if (target) {
            const speed = 16;
            target.scrollBy({ left: Math.round(rx * speed), top: Math.round(ry * speed) });
            _globalOnGamepadAction?.();
          } else if (DEBUG_CONSOLE_GAMEPAD) {
            console.log(`[CONSOLE_GAMEPAD][RIGHT_STICK] axes=(rx=${rx.toFixed(2)} ry=${ry.toFixed(2)}) no-scroll-target`);
          }
        }
      }

      // Log unmapped pressed buttons (for debugging unexpected dispatches like Alt)
      if (DEBUG_CONSOLE_GAMEPAD) {
        const _nowSec = Math.floor(Date.now() / 2000);
        for (let i = 0; i <= 16; i++) {
          if (i >= B.DPAD_UP && i <= B.DPAD_RIGHT) continue;
          const mapped = dispatchMap.some(([idx]) => idx === i);
          if (!mapped && gp.buttons[i]?.pressed) {
            if ((_nowSec % 5) === 0) {
              console.log(`[CONSOLE_GAMEPAD][IGNORED_BUTTON] index=${i} value=${gp.buttons[i]!.value}`);
            }
          }
        }
      }

      // Buttons
      for (const [btnIdx, key] of dispatchMap) {
        const btn = gp.buttons[btnIdx];
        if (!btn) continue;

        // Skip D-pad buttons (handled as directions above)
        if (btnIdx >= B.DPAD_UP && btnIdx <= B.DPAD_RIGHT) continue;

        if (btn.pressed && !heldButtonsRef.current.has(btnIdx)) {
          heldButtonsRef.current.add(btnIdx);
          if (DEBUG_CONSOLE_GAMEPAD) console.log(`[CONSOLE_GAMEPAD][ACTION] button=${btnIdx} key=${key}`);
          dispatchKey(key);
        } else if (!btn.pressed && heldButtonsRef.current.has(btnIdx)) {
          heldButtonsRef.current.delete(btnIdx);
        }
      }

      rafRef.current = requestAnimationFrame(poll);
    }

    rafRef.current = requestAnimationFrame(poll);

    return () => {
      if (DEBUG_CONSOLE_GAMEPAD) {
        console.log(`[CONSOLE_GAMEPAD][POLL_STOP]`);
      }
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      // Clear held state so re-enable doesn't treat still-pressed buttons as new presses
      heldButtonsRef.current.clear();
      dirStateRef.current.clear();
      setGamepadDetected(false);
      lastConnectedRef.current = false;
      gamepadIndexRef.current = null;
    };
  }, [enabled]);
}

/* ── Module-level helper for poll spam reduction ── */
let _lastPollLog = false;
