
import { useState, useCallback, useRef } from 'react';

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

interface HistoryMutationOptions {
  groupKey?: string;
}

export function useUndoRedo<T>(initialState: T, maxHistory: number = 50) {
  const [history, setHistory] = useState<HistoryState<T>>({
    past: [],
    present: initialState,
    future: [],
  });
  const lastGroupKeyRef = useRef<string | null>(null);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const setState = useCallback((newState: T | ((currentState: T) => T), options?: HistoryMutationOptions) => {
    const groupKey = options?.groupKey || null;
    setHistory((curr) => {
      const resolvedState = newState instanceof Function ? newState(curr.present) : newState;
      
      // If state hasn't actually changed (deep check optional, usually ref check is enough in React), return
      if (resolvedState === curr.present) return curr;

      const shouldMergeIntoCurrent = Boolean(groupKey && lastGroupKeyRef.current === groupKey && curr.past.length > 0);
      if (shouldMergeIntoCurrent) {
        return {
          ...curr,
          present: resolvedState,
          future: [], // Preserve undo stack but drop redo branch.
        };
      }

      const newPast = [...curr.past, curr.present];
      if (newPast.length > maxHistory) {
        newPast.shift(); // Remove oldest
      }

      return {
        past: newPast,
        present: resolvedState,
        future: [], // New action clears future redo stack
      };
    });
    lastGroupKeyRef.current = groupKey;
  }, [maxHistory]);

  const setStateNoHistory = useCallback((newState: T | ((currentState: T) => T)) => {
    setHistory((curr) => {
      const resolvedState = newState instanceof Function ? newState(curr.present) : newState;
      if (resolvedState === curr.present) return curr;

      return {
        ...curr,
        present: resolvedState
      };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((curr) => {
      if (curr.past.length === 0) return curr;

      const previous = curr.past[curr.past.length - 1];
      const newPast = curr.past.slice(0, curr.past.length - 1);

      return {
        past: newPast,
        present: previous,
        future: [curr.present, ...curr.future],
      };
    });
    lastGroupKeyRef.current = null;
  }, []);

  const redo = useCallback(() => {
    setHistory((curr) => {
      if (curr.future.length === 0) return curr;

      const next = curr.future[0];
      const newFuture = curr.future.slice(1);

      return {
        past: [...curr.past, curr.present],
        present: next,
        future: newFuture,
      };
    });
    lastGroupKeyRef.current = null;
  }, []);

  return {
    state: history.present,
    setState,
    setStateNoHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    history // exposed for debugging or UI if needed
  };
}
