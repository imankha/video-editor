import { useState, useRef, useCallback, useEffect } from 'react';

const AUTO_HIDE_MS = 3000;

export const ControlState = {
  HIDDEN: 'HIDDEN',
  VISIBLE: 'VISIBLE',
  DRAG_MODE: 'DRAG_MODE',
};

export function useFullscreenControls({ isPlaying = false } = {}) {
  const [state, setState] = useState(ControlState.VISIBLE);
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      setState(ControlState.HIDDEN);
      timerRef.current = null;
    }, AUTO_HIDE_MS);
  }, [clearTimer]);

  const handleTapVideo = useCallback(() => {
    setState((prev) => {
      if (prev === ControlState.DRAG_MODE) return prev;
      if (prev === ControlState.HIDDEN) return ControlState.VISIBLE;
      return ControlState.HIDDEN;
    });
  }, []);

  const handleInteraction = useCallback(() => {
    if (state === ControlState.DRAG_MODE) return;
    if (state === ControlState.HIDDEN) {
      setState(ControlState.VISIBLE);
    }
    if (isPlaying) {
      startTimer();
    }
  }, [state, isPlaying, startTimer]);

  const handleTouchControl = useCallback(() => {
    if (state === ControlState.DRAG_MODE) return;
    startTimer();
  }, [state, startTimer]);

  const handleDragStart = useCallback(() => {
    clearTimer();
    setState(ControlState.DRAG_MODE);
  }, [clearTimer]);

  const handleDragEnd = useCallback(() => {
    setState(ControlState.VISIBLE);
    startTimer();
  }, [startTimer]);

  // Auto-hide when playing and controls are visible
  useEffect(() => {
    if (isPlaying && state === ControlState.VISIBLE) {
      startTimer();
    }
    if (!isPlaying && state === ControlState.VISIBLE) {
      clearTimer();
    }
  }, [isPlaying, state, startTimer, clearTimer]);

  // When state changes to VISIBLE via tap (not playing), start timer only if playing
  useEffect(() => {
    if (state === ControlState.VISIBLE && isPlaying) {
      startTimer();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  return {
    controlState: state,
    isVisible: state !== ControlState.HIDDEN,
    isDragMode: state === ControlState.DRAG_MODE,
    handleTapVideo,
    handleInteraction,
    handleTouchControl,
    handleDragStart,
    handleDragEnd,
  };
}
