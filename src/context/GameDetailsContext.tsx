import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type GlobalGameSelection = {
  appId: string;
  title: string;
  imageUrl?: string;
};

type GameDetailsContextValue = {
  selectedGame: GlobalGameSelection | null;
  selectGame: (game: GlobalGameSelection) => void;
  clearSelection: () => void;
};

const GameDetailsContext = createContext<GameDetailsContextValue | null>(null);

export function GameDetailsProvider({ children }: { children: ReactNode }) {
  const [selectedGame, setSelectedGame] = useState<GlobalGameSelection | null>(null);

  const selectGame = useCallback((game: GlobalGameSelection) => {
    setSelectedGame(game);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedGame(null);
  }, []);

  const ctxValue = useMemo(() => ({ selectedGame, selectGame, clearSelection }), [selectedGame]);

  return (
    <GameDetailsContext.Provider value={ctxValue}>
      {children}
    </GameDetailsContext.Provider>
  );
}

export function useGameDetails(): GameDetailsContextValue {
  const context = useContext(GameDetailsContext);
  if (!context) {
    throw new Error("useGameDetails must be used within a GameDetailsProvider");
  }
  return context;
}
