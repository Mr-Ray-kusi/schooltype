/**
 * The Schooltype mark on its own, drawn in the current text colour.
 * The tiled blue version in /logo.svg is for the favicon and app icon, where it
 * needs its own background; here it sits on the marketing forest and takes cream.
 */
const BrandLogo = ({ className = '' }) => (
  <svg viewBox="15 11 36 36" aria-hidden="true" focusable="false" className={className}>
    <g transform="rotate(45 32 29)" fill="currentColor">
      <rect x="21.1" y="18.1" width="6.4" height="6.4" rx="1.3" />
      <rect x="28.8" y="18.1" width="6.4" height="6.4" rx="1.3" />
      <rect x="36.5" y="18.1" width="6.4" height="6.4" rx="1.3" />
      <rect x="21.1" y="25.8" width="6.4" height="6.4" rx="1.3" />
      <rect x="28.8" y="25.8" width="6.4" height="6.4" rx="1.3" fillOpacity=".45" />
      <rect x="36.5" y="25.8" width="6.4" height="6.4" rx="1.3" />
      <rect x="21.1" y="33.5" width="6.4" height="6.4" rx="1.3" />
      <rect x="28.8" y="33.5" width="6.4" height="6.4" rx="1.3" />
      <rect x="36.5" y="33.5" width="6.4" height="6.4" rx="1.3" />
    </g>
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      d="M45.6 29.6c1.8 1.6 2.4 3.6 2.4 6.4"
    />
    <circle cx="48" cy="38.3" r="2.1" fill="currentColor" />
  </svg>
);

export default BrandLogo;
