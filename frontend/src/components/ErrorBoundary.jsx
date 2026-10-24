import React from 'react';
import { isChunkLoadError } from '../utils/lazyWithRetry';

const CHUNK_RELOAD_KEY = 'schootype-chunk-reload';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI crash:', error, info);
    if (isChunkLoadError(error) && !sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
      window.location.reload();
    }
  }

  render() {
    if (this.state.error) {
      const chunkError = isChunkLoadError(this.state.error);
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 px-6 text-center text-slate-100">
          <h1 className="text-xl font-bold text-white">
            {chunkError ? 'This page needs a fresh load' : 'Something went wrong'}
          </h1>
          <p className="max-w-lg text-sm text-slate-400">
            {chunkError
              ? 'The app was updated. Reload to open the latest version. Your login will stay.'
              : this.state.error?.message || 'The page failed to render after sign-in.'}
          </p>
          <button
            type="button"
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
            onClick={() => {
              sessionStorage.removeItem(CHUNK_RELOAD_KEY);
              if (chunkError) {
                window.location.reload();
                return;
              }
              localStorage.removeItem('token');
              localStorage.removeItem('school');
              localStorage.removeItem('tokenExpiresAt');
              window.location.href = '/';
            }}
          >
            {chunkError ? 'Reload page' : 'Clear session and go home'}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
