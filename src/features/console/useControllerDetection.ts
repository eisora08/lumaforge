import { useEffect, useRef } from "react";
import { showInfo } from "../../components/toast/GameToast";
import { setGamepadDetected } from "./consoleInputHints";

const DEBUG_CONTROLLER = false;

export function useControllerDetection(): void {
  const knownRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    function handleConnected(e: GamepadEvent) {
      const id = e.gamepad.id;
      if (!knownRef.current.has(id)) {
        knownRef.current.add(id);
        const name = id.replace(/\s*\(.*?\)\s*/g, "").trim() || `Gamepad ${e.gamepad.index}`;
        showInfo(`Connected: ${name}`, { title: "Controller", id: "controller-toast" });
        setGamepadDetected(true);
        if (DEBUG_CONTROLLER) console.log(`[CONTROLLER][CONNECTED] id="${id}" index=${e.gamepad.index}`);
      }
    }

    function handleDisconnected(e: GamepadEvent) {
      const id = e.gamepad.id;
      knownRef.current.delete(id);
      const name = id.replace(/\s*\(.*?\)\s*/g, "").trim() || `Gamepad ${e.gamepad.index}`;
      showInfo(`Disconnected: ${name}`, { title: "Controller", id: "controller-toast" });
      const remaining = navigator.getGamepads?.().filter((g) => g !== null).length ?? 0;
      if (remaining === 0) {
        setGamepadDetected(false);
      }
      if (DEBUG_CONTROLLER) console.log(`[CONTROLLER][DISCONNECTED] id="${id}" remaining=${remaining}`);
    }

    const existing = navigator.getGamepads?.().filter((g) => g !== null) ?? [];
    for (const gp of existing) {
      knownRef.current.add(gp.id);
    }
    if (existing.length > 0) {
      setGamepadDetected(true);
    }

    window.addEventListener("gamepadconnected", handleConnected);
    window.addEventListener("gamepaddisconnected", handleDisconnected);
    return () => {
      window.removeEventListener("gamepadconnected", handleConnected);
      window.removeEventListener("gamepaddisconnected", handleDisconnected);
    };
  }, []);
}
