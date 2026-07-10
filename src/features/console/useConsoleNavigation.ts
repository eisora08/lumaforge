import { useCallback, useMemo, useState } from "react";

type UseConsoleNavigationParams = {
  railLengths: number[];
  onSelectGame?: (railIndex: number, cardIndex: number) => void;
  onGoBack?: () => void;
};

const PAGE_JUMP = 5;

export type ConsoleNavigationState = {
  focusedRail: number;
  focusedIndex: number;
  moveUp: () => void;
  moveDown: () => void;
  moveLeft: () => void;
  moveRight: () => void;
  pageLeft: () => void;
  pageRight: () => void;
  tabForward: () => void;
  tabBackward: () => void;
  selectFocused: () => void;
  goBack: () => void;
  focusRail: (railIndex: number, cardIndex?: number) => void;
};

export function useConsoleNavigation(params: UseConsoleNavigationParams): ConsoleNavigationState {
  const { railLengths, onSelectGame, onGoBack } = params;
  const [focusedRail, setFocusedRail] = useState(-1);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const railCount = railLengths.length;

  const clampIndex = useCallback(
    (rail: number, index: number) => Math.min(index, Math.max(railLengths[rail] - 1, 0)),
    [railLengths],
  );

  const moveUp = useCallback(() => {
    if (focusedRail < 0) {
      if (railCount > 0) {
        const last = railCount - 1;
        setFocusedRail(last);
        setFocusedIndex(clampIndex(last, 0));
      }
      return;
    }
    if (focusedRail <= 0) {
      const last = railCount - 1;
      setFocusedRail(last);
      setFocusedIndex(clampIndex(last, focusedIndex));
      return;
    }
    const newRail = focusedRail - 1;
    setFocusedRail(newRail);
    setFocusedIndex(clampIndex(newRail, focusedIndex));
  }, [focusedRail, focusedIndex, railCount, railLengths, clampIndex]);

  const moveDown = useCallback(() => {
    if (focusedRail < 0) {
      if (railCount > 0) {
        setFocusedRail(0);
        setFocusedIndex(0);
      }
      return;
    }
    if (focusedRail >= railCount - 1) {
      setFocusedRail(0);
      setFocusedIndex(clampIndex(0, focusedIndex));
      return;
    }
    const newRail = focusedRail + 1;
    setFocusedRail(newRail);
    setFocusedIndex(clampIndex(newRail, focusedIndex));
  }, [focusedRail, focusedIndex, railCount, railLengths, clampIndex]);

  const moveLeft = useCallback(() => {
    if (focusedRail < 0) {
      if (railCount > 0) {
        setFocusedRail(0);
        setFocusedIndex(0);
      }
      return;
    }
    const len = railLengths[focusedRail];
    if (len <= 0) return;
    if (focusedIndex <= 0) {
      setFocusedIndex(len - 1);
    } else {
      setFocusedIndex(focusedIndex - 1);
    }
  }, [focusedRail, focusedIndex, railLengths, railCount]);

  const moveRight = useCallback(() => {
    if (focusedRail < 0) {
      if (railCount > 0) {
        setFocusedRail(0);
        setFocusedIndex(0);
      }
      return;
    }
    const len = railLengths[focusedRail];
    if (len <= 0) return;
    if (focusedIndex >= len - 1) {
      setFocusedIndex(0);
    } else {
      setFocusedIndex(focusedIndex + 1);
    }
  }, [focusedRail, focusedIndex, railLengths, railCount]);

  const pageLeft = useCallback(() => {
    if (focusedRail < 0) {
      if (railCount > 0) {
        setFocusedRail(0);
        setFocusedIndex(0);
      }
      return;
    }
    const len = railLengths[focusedRail];
    if (len <= 0) return;
    const next = Math.max(0, focusedIndex - PAGE_JUMP);
    setFocusedIndex(next);
  }, [focusedRail, focusedIndex, railLengths, railCount]);

  const pageRight = useCallback(() => {
    if (focusedRail < 0) {
      if (railCount > 0) {
        setFocusedRail(0);
        setFocusedIndex(0);
      }
      return;
    }
    const len = railLengths[focusedRail];
    if (len <= 0) return;
    const next = Math.min(len - 1, focusedIndex + PAGE_JUMP);
    setFocusedIndex(next);
  }, [focusedRail, focusedIndex, railLengths, railCount]);

  const tabForward = useCallback(() => {
    if (railCount === 0) return;
    if (focusedRail < 0) {
      setFocusedRail(0);
      setFocusedIndex(0);
      return;
    }
    if (focusedRail >= railCount - 1) {
      setFocusedRail(0);
      setFocusedIndex(clampIndex(0, focusedIndex));
    } else {
      const newRail = focusedRail + 1;
      setFocusedRail(newRail);
      setFocusedIndex(clampIndex(newRail, focusedIndex));
    }
  }, [focusedRail, focusedIndex, railCount, railLengths, clampIndex]);

  const tabBackward = useCallback(() => {
    if (railCount === 0) return;
    if (focusedRail < 0) {
      const last = railCount - 1;
      setFocusedRail(last);
      setFocusedIndex(clampIndex(last, 0));
      return;
    }
    if (focusedRail <= 0) {
      const last = railCount - 1;
      setFocusedRail(last);
      setFocusedIndex(clampIndex(last, focusedIndex));
    } else {
      const newRail = focusedRail - 1;
      setFocusedRail(newRail);
      setFocusedIndex(clampIndex(newRail, focusedIndex));
    }
  }, [focusedRail, focusedIndex, railCount, railLengths, clampIndex]);

  const selectFocused = useCallback(() => {
    if (focusedRail >= 0 && focusedIndex >= 0) {
      onSelectGame?.(focusedRail, focusedIndex);
    }
  }, [focusedRail, focusedIndex, onSelectGame]);

  const goBack = useCallback(() => {
    onGoBack?.();
  }, [onGoBack]);

  const focusRail = useCallback(
    (railIndex: number, cardIndex?: number) => {
      if (railIndex >= 0 && railIndex < railCount) {
        setFocusedRail(railIndex);
        setFocusedIndex(cardIndex ?? 0);
      }
    },
    [railCount],
  );

  return useMemo(
    () => ({
      focusedRail,
      focusedIndex,
      moveUp,
      moveDown,
      moveLeft,
      moveRight,
      pageLeft,
      pageRight,
      tabForward,
      tabBackward,
      selectFocused,
      goBack,
      focusRail,
    }),
    [focusedRail, focusedIndex, moveUp, moveDown, moveLeft, moveRight, pageLeft, pageRight, tabForward, tabBackward, selectFocused, goBack, focusRail],
  );
}
