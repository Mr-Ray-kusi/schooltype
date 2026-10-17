import React from 'react'
import ReactDOM from 'react-dom/client'
import axios from 'axios'
import App from './app'
import { Toaster } from 'react-hot-toast'
import './index.css'
import { enqueueMutation, isOfflineMutationUrl, mutationLabel } from './utils/offlineQueue'

axios.defaults.timeout = 20000;
axios.defaults.withCredentials = true;

// Production: Vercel site calls the Render API. Local dev leaves this empty and uses the Vite proxy.
const apiBase = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');
if (apiBase) {
  axios.defaults.baseURL = apiBase;
} else if (import.meta.env.PROD) {
  console.error(
    'VITE_API_URL is missing. In the Vercel project set it to the Render API URL (https://….onrender.com) and redeploy.'
  );
}

const KEEP_ALIVE_MS = 4 * 60 * 1000;
const pingApi = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  axios.get('/api/health', { timeout: 8000 }).catch(() => {});
};
if (typeof window !== 'undefined') {
  window.setTimeout(pingApi, 15000);
  window.setInterval(pingApi, KEEP_ALIVE_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pingApi();
  });
}

axios.interceptors.request.use(async (config) => {
  if (config.skipOfflineQueue) return config;
  const method = String(config.method || 'get').toLowerCase();
  const url = config.url || '';
  const mutating = method !== 'get' && method !== 'head' && method !== 'options';
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;

  if (mutating && offline && isOfflineMutationUrl(url)) {
    await enqueueMutation({
      method,
      url,
      data: config.data,
      headers: config.headers,
      label: mutationLabel(method, url, config.data),
    });
    const error = new Error('Queued offline');
    error.offlineQueued = true;
    return Promise.reject(error);
  }

  return config;
});

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error?.offlineQueued) return Promise.reject(error);
    if (error?.config?.skipOfflineQueue) return Promise.reject(error);
    const config = error?.config;
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    const noResponse = !error?.response;
    if (config && (offline || noResponse)) {
      const method = String(config.method || 'get').toLowerCase();
      const url = config.url || '';
      if (method !== 'get' && isOfflineMutationUrl(url)) {
        await enqueueMutation({
          method,
          url,
          data: config.data,
          headers: config.headers,
          label: mutationLabel(method, url, config.data),
        });
        error.offlineQueued = true;
      }
    }
    return Promise.reject(error);
  }
);

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="top-center"
      gutter={8}
      toastOptions={{
        duration: 2800,
        success: { iconTheme: { primary: '#27AE60', secondary: '#fff' } },
        error: { iconTheme: { primary: '#E74C3C', secondary: '#fff' } },
      }}
    />
  </React.StrictMode>
)
