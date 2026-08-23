import { listen, UnlistenFn } from "@tauri-apps/api/event";

export type DataChangeType = "games-upserted" | "appinfo-changed" | "names-updated" | "manifest-changed" | "playtime-changed";

interface DataChangeEvent {
  change_type: string;
  detail: string;
}

type Handler = (type: DataChangeType, detail: string) => void;

const listeners = new Set<Handler>();
let unlistenFn: UnlistenFn | null = null;

export function subscribeDataChanges(handler: Handler): () => void {
  listeners.add(handler);
  return () => { listeners.delete(handler); };
}

export function initDataChangeBus(): () => void {
  if (unlistenFn) return unlistenFn; // already initialized

  const p = listen<DataChangeEvent>("sqlite-data-changed", (event) => {
    const { change_type, detail } = event.payload;
    for (const handler of listeners) {
      try { handler(change_type as DataChangeType, detail); } catch { /* ignore */ }
    }
  });

  p.then(fn => { unlistenFn = fn; });

  return () => {
    unlistenFn?.();
    unlistenFn = null;
  };
}
