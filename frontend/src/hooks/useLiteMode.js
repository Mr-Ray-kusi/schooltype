import { useCallback, useLayoutEffect, useState } from 'react';

const KEYS = {
  admin: 'schootype-lite-admin',
  staff: 'schootype-lite-staff',
};
const LEGACY_KEY = 'schootype-lite-mode';

export function readLiteMode(scope = 'admin') {
  const key = KEYS[scope] || KEYS.admin;
  try {
    const scoped = localStorage.getItem(key);
    if (scoped === '1' || scoped === '0') return scoped === '1';
    if (scope === 'admin') return localStorage.getItem(LEGACY_KEY) === '1';
    return false;
  } catch {
    return false;
  }
}

export function applyLiteClass(on) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('lite', Boolean(on));
}

export default function useLiteMode(scope = 'admin') {
  const [liteMode, setLiteMode] = useState(() => readLiteMode(scope));

  useLayoutEffect(() => {
    applyLiteClass(liteMode);
    return () => applyLiteClass(false);
  }, [liteMode]);

  const toggleLiteMode = useCallback(() => {
    setLiteMode((current) => {
      const next = !current;
      try {
        localStorage.setItem(KEYS[scope] || KEYS.admin, next ? '1' : '0');
      } catch {
        // ignore private mode
      }
      return next;
    });
  }, [scope]);

  return { liteMode, toggleLiteMode };
}
