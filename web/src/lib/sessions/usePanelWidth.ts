import { useCallback, useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';

const KEY = 'claude-office-panel-width';
const MIN = 360;
/** The board keeps at least this much room beside the panel. */
const BOARD_MIN = 320;

const clamp = (w: number) => Math.round(Math.max(MIN, Math.min(w, window.innerWidth - BOARD_MIN)));
const initial = () => {
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (saved) return clamp(saved);
  } catch {
    // Falls back to the default.
  }
  return clamp(Math.min(640, window.innerWidth * 0.44));
};

/** The session panel's width: dragged with the handle on its edge, nudged with arrow keys, remembered per browser. */
export function usePanelWidth() {
  const [width, setWidth] = useState(initial);
  const save = (w: number) => {
    try {
      localStorage.setItem(KEY, String(w));
    } catch {
      // Not remembered after a reload.
    }
  };

  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    try {
      handle.setPointerCapture(e.pointerId); // keeps the drag going when the pointer leaves the thin handle
    } catch {
      // Without capture the drag still works while the pointer stays over the handle.
    }
    document.body.classList.add('resizing');
    let latest = 0;
    const move = (ev: globalThis.PointerEvent) => {
      latest = clamp(window.innerWidth - ev.clientX);
      setWidth(latest);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
      if (latest) save(latest);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }, []);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 120 : 40;
    const delta = e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0;
    if (!delta) return;
    e.preventDefault();
    setWidth((w) => {
      const next = clamp(w + delta);
      save(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const next = clamp(Math.min(640, window.innerWidth * 0.44));
    setWidth(next);
    save(next);
  }, []);

  return { width, min: MIN, onPointerDown, onKeyDown, reset };
}
