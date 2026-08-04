import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { showInfo, showSuccess } from "../toast/GameToast";

export interface FixProgressEvent {
  appId: number;
  tool: string;
  progress: number;
  message: string;
}

const seenInitial = new Set<string>();

const TOOL_LABELS: Record<string, string> = {
  smoke_api: "SmokeAPI",
  steamless: "Steamless",
  online_fix: "Online-Fix",
  koaloader: "Koaloader",
};

function label(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

// =============================================================================
// Modal-open awareness — ToolsModal sets these so we suppress duplicate toasts
// =============================================================================

let _modalOpen = false;
let _modalAppId: number | null = null;

export function setFixModalOpen(open: boolean, appId?: number | null) {
  _modalOpen = open;
  _modalAppId = appId ?? null;
}

export function isFixModalOpen(): boolean {
  return _modalOpen;
}

// =============================================================================

export default function FixProgressListener() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function setupListener() {
      unlisten = await listen<FixProgressEvent>("library://fix-progress", (event) => {
        const payload = event.payload;

        // When the ToolsModal is open for this appId, suppress toasts — the
        // modal handles its own inline progress/completion UI.
        if (_modalOpen && _modalAppId != null && payload.appId === _modalAppId) {
          // Still clean up dedup state so a later run outside the modal works
          if (payload.progress >= 100) {
            seenInitial.delete(`${payload.tool}:${payload.appId}`);
          }
          return;
        }

        if (payload.progress >= 100) {
          showSuccess(payload.message || `${label(payload.tool)} aplicado correctamente`, {
            title: `${label(payload.tool)} listo`,
            duration: 3200,
          });
          seenInitial.delete(`${payload.tool}:${payload.appId}`);
          return;
        }

        const key = `${payload.tool}:${payload.appId}`;
        if (seenInitial.has(key)) {
          return;
        }
        seenInitial.add(key);
        showInfo(payload.message || `Aplicando ${label(payload.tool)}...`, {
          title: `Aplicando ${label(payload.tool)}`,
          duration: 1400,
        });
      });
    }

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  return null;
}
