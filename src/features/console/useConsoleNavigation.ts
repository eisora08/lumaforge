import { useCallback, useMemo } from "react";

export type ConsoleNavigationState = {
  focusedRail: number;
  focusedIndex: number;
  navigateUp: () => void;
  navigateDown: () => void;
  navigateLeft: () => void;
  navigateRight: () => void;
  selectFocused: () => void;
  goBack: () => void;
};

export function useConsoleNavigation(): ConsoleNavigationState {
  const noop = useCallback(() => {}, []);

  return useMemo(
    () => ({
      focusedRail: -1,
      focusedIndex: -1,
      navigateUp: noop,
      navigateDown: noop,
      navigateLeft: noop,
      navigateRight: noop,
      selectFocused: noop,
      goBack: noop,
    }),
    [noop],
  );
}
