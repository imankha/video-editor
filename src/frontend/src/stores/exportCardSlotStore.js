import { create } from 'zustand';

/**
 * exportCardSlotStore (T17190): the element a screen offers the sharpen progress card
 * (GlobalExportIndicator) to dock into, instead of floating fixed over the page. Frame
 * registers the slot directly below its video so the card never covers the preview.
 * Null = no screen offers one: the card keeps its fixed corner slot.
 *
 * View state only, never persisted.
 */
export const useExportCardSlotStore = create((set) => ({
  slot: null,
  setSlot: (slot) => set({ slot }),
}));
