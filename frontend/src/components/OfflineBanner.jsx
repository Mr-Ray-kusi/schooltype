import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { compactPendingQueue, listPending, subscribeOffline, syncPending } from '../utils/offlineQueue';
import axios from 'axios';
import { invalidateCache } from '../utils/requestCache';

const OfflineBanner = () => {
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const skipUntilOnlineRef = useRef(false);

  useEffect(() => {
    const runSync = async ({ force = false } = {}) => {
      if (syncingRef.current) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (skipUntilOnlineRef.current && !force) return;

      await compactPendingQueue();
      const items = await listPending();
      if (!items.length) {
        skipUntilOnlineRef.current = false;
        return;
      }

      syncingRef.current = true;
      setSyncing(true);
      try {
        const result = await syncPending(axios);
        if (result.synced) invalidateCache();
        // Network still down: wait for the next `online` event instead of looping the banner.
        skipUntilOnlineRef.current = result.failed > 0;
      } catch {
        skipUntilOnlineRef.current = true;
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    };

    const onOnline = () => {
      skipUntilOnlineRef.current = false;
      runSync({ force: true });
    };
    const onOffline = () => {
      skipUntilOnlineRef.current = true;
    };

    toast.dismiss();

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const unsub = subscribeOffline(() => {
      runSync();
    });
    const start = () => runSync();
    if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 1500 });
    else window.setTimeout(start, 0);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      unsub();
    };
  }, []);

  if (!syncing) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-sm text-sky-100">
      <RefreshCw className="h-4 w-4 animate-spin" />
      Syncing offline changes
    </div>
  );
};

export default OfflineBanner;
