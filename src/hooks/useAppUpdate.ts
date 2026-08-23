import { useSyncExternalStore } from "react";
import { subscribeAppUpdate, getAppUpdateSnapshot } from "../services/appUpdateStore";

export function useAppUpdate() {
  return useSyncExternalStore(subscribeAppUpdate, getAppUpdateSnapshot, getAppUpdateSnapshot);
}
