/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#05060a',
          900: '#0a0b12',
          800: '#11131c',
          700: '#191c28',
        },
        crimson: {
          400: '#ff3355',
          500: '#e11d3a',
          600: '#a8112a',
          700: '#7a0a1d',
        },
      },
      boxShadow: {
        glow: '0 0 40px -10px rgba(225,29,58,0.45)',
        glass: '0 8px 32px rgba(0,0,0,0.45)',
      },
      backdropBlur: { xs: '2px' },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
