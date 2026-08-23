import { createContext, useContext, useState, type ReactNode } from "react";

export type StoreTabId = "discover" | "browse" | "repacks";

interface StoreTabContextValue {
  activeStoreTab: StoreTabId;
  setStoreTab: (tab: StoreTabId) => void;
}

const StoreTabContext = createContext<StoreTabContextValue | null>(null);

export function StoreTabProvider({ children }: { children: ReactNode }) {
  const [activeStoreTab, setStoreTab] = useState<StoreTabId>("discover");
  return (
    <StoreTabContext.Provider value={{ activeStoreTab, setStoreTab }}>
      {children}
    </StoreTabContext.Provider>
  );
}

export function useStoreTab() {
  const ctx = useContext(StoreTabContext);
  if (!ctx) throw new Error("useStoreTab must be used within StoreTabProvider");
  return ctx;
}
