export const GA_MEASUREMENT_ID = 'G-36VTFTQT1T';

const PUBLIC_PATHS = new Set([
  '/',
  '/login',
  '/plans',
  '/signup',
  '/signup/complete',
  '/privacy',
  '/terms',
  '/refunds',
  '/cookies',
  '/image-licensing',
  '/sitemap',
]);

export function publicAnalyticsPath(pathname) {
  const path = String(pathname || '/').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  return PUBLIC_PATHS.has(path) ? path : null;
}

function disableFlag() {
  return `ga-disable-${GA_MEASUREMENT_ID}`;
}

function ensureTag(pageLocation, pagePath) {
  if (typeof document === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag() {
      window.dataLayer.push(arguments);
    };
  if (!document.querySelector(`script[src*="googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"]`)) {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(script);
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID, {
      send_page_view: false,
      anonymize_ip: true,
      page_location: pageLocation,
      page_path: pagePath,
    });
  }
}

export function syncPublicAnalytics(pathname) {
  if (typeof window === 'undefined') return;
  const path = publicAnalyticsPath(pathname);
  if (!path) {
    window[disableFlag()] = true;
    return;
  }
  window[disableFlag()] = false;
  const pageLocation = `${window.location.origin}${path}`;
  ensureTag(pageLocation, path);
  if (typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_location: pageLocation,
    page_path: path,
    page_referrer: window.location.origin,
  });
}
