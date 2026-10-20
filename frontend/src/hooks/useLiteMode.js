import { useCallback, useEffect, useState } from 'react';

const KEY = 'schootype-lite-mode';

export function readLiteMode() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function applyLiteClass(on) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('lite', Boolean(on));
}

export default function useLiteMode() {
  const [liteMode, setLiteMode] = useState(readLiteMode);

  useEffect(() => {
    applyLiteClass(liteMode);
  }, [liteMode]);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === KEY) setLiteMode(event.newValue === '1');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggleLiteMode = useCallback(() => {
    setLiteMode((current) => {
      const next = !current;
      try {
        localStorage.setItem(KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      applyLiteClass(next);
      return next;
    });
  }, []);

  return { liteMode, toggleLiteMode };
}
