import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface BackButtonState {
  onBack?: () => void;
  label?: string;
}

interface BackButtonContextValue extends BackButtonState {
  setBackButton: (state: BackButtonState | null) => void;
}

const Ctx = createContext<BackButtonContextValue>({ setBackButton: () => {} });

export function BackButtonProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BackButtonState>({});
  const setBackButton = useCallback((s: BackButtonState | null) => setState(s ?? {}), []);
  return (
    <Ctx.Provider value={{ ...state, setBackButton }}>
      {children}
    </Ctx.Provider>
  );
}

export function useBackButtonContext() {
  return useContext(Ctx);
}
