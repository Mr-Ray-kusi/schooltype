const envUrl = (key) => String(import.meta.env[key] || '').trim();

/**
 * Paste the live Schooltype profile URLs in VITE_SOCIAL_* or in the fallbacks.
 * Until those are set, each item opens the real network.
 */
export const SOCIAL_LINKS = [
  { label: 'X', href: envUrl('VITE_SOCIAL_X') || 'https://x.com/' },
  { label: 'Facebook', href: envUrl('VITE_SOCIAL_FACEBOOK') || 'https://www.facebook.com/' },
  { label: 'Instagram', href: envUrl('VITE_SOCIAL_INSTAGRAM') || 'https://www.instagram.com/' },
  { label: 'LinkedIn', href: envUrl('VITE_SOCIAL_LINKEDIN') || 'https://www.linkedin.com/' },
];
