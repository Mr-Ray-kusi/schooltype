/** @type {import('tailwindcss').Config} */

const softBlue = {
  50: '#ebf5fb',
  100: '#d4eaf7',
  200: '#a9d4ef',
  300: '#7ebfe7',
  400: '#54a9df',
  500: '#3498DB',
  600: '#2e86c1',
  700: '#2471a3',
  800: '#1a5276',
  900: '#154360',
};

const softGreen = {
  50: '#eafaf1',
  100: '#d5f5e3',
  200: '#abebc6',
  300: '#82e0aa',
  400: '#58d68d',
  500: '#27AE60',
  600: '#1e8449',
  700: '#196f3d',
  800: '#145a32',
  900: '#0e3d22',
};

const softRed = {
  50: '#fdedec',
  100: '#fadbd8',
  200: '#f5b7b1',
  300: '#f1948a',
  400: '#ec7063',
  500: '#E74C3C',
  600: '#cb4335',
  700: '#a93226',
  800: '#7b241c',
  900: '#641e16',
};

module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: softBlue,
        secondary: softGreen,
        sky: softBlue,
        blue: softBlue,
        cyan: softBlue,
        indigo: softBlue,
        violet: softBlue,
        purple: softBlue,
        fuchsia: softBlue,
        emerald: softGreen,
        green: softGreen,
        teal: softGreen,
        lime: softGreen,
        rose: softRed,
        red: softRed,
        pink: softRed,
        amber: softRed,
        orange: softRed,
      },
      fontFamily: {
        display: ['Syne', 'system-ui', 'sans-serif'],
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        serif: ['Playfair Display', 'Georgia', 'serif'],
        dashboard: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'hero-fade': 'heroFade 1s ease-out both',
        'hero-rise': 'heroRise 0.9s ease-out 0.15s both',
        'hero-rise-late': 'heroRise 0.9s ease-out 0.35s both',
        'ken-burns': 'kenBurns 28s ease-in-out infinite alternate',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        heroFade: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        heroRise: {
          '0%': { opacity: '0', transform: 'translateY(18px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        kenBurns: {
          '0%': { transform: 'scale(1)' },
          '100%': { transform: 'scale(1.08)' },
        },
      },
    },
  },
  plugins: [],
}
