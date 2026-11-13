/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef6f3', 100: '#d5ebe3', 200: '#acd6c7', 300: '#7dbca6', 400: '#4f9e85',
          500: '#33826a', 600: '#266955', 700: '#1f5446', 800: '#1b443a', 900: '#173930',
        },
      },
      boxShadow: { card: '0 1px 2px rgb(0 0 0 / 0.04), 0 1px 8px rgb(0 0 0 / 0.04)' },
    },
  },
  plugins: [],
};
