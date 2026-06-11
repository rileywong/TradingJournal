import { useEffect } from 'react';

// Close a modal/overlay when Escape is pressed. `onClose` should be stable
// enough (or it re-binds, which is harmless). No-op when onClose is falsy.
export function useEscape(onClose) {
  useEffect(() => {
    if (!onClose) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
}
