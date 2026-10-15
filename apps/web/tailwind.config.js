/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#C8302C', // VM One Red
          50: '#FDF1EF',
          100: '#FADDD9',
          200: '#F3B8B1',
          300: '#E98C82',
          400: '#DB5F53',
          500: '#C8302C',
          600: '#AC2623',
          700: '#8C1F1D',
          800: '#6E1A19',
          900: '#4F1413',
        },
        cream: {
          DEFAULT: '#FBF7F1',
          100: '#F6F0E6',
          200: '#EDE4D6',
          300: '#DFD2BF',
        },
        ink: {
          DEFAULT: '#221E1A',
          700: '#3D3731',
          500: '#6B635A',
          400: '#8F867B',
          300: '#B5ACA0',
        },
        leaf: {
          50: '#EEF6F0',
          600: '#2F7A4B',
        },
      },
      fontFamily: {
        sans: ['Figtree', 'system-ui', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(34, 30, 26, 0.04), 0 4px 16px rgba(34, 30, 26, 0.05)',
        lift: '0 2px 4px rgba(34, 30, 26, 0.04), 0 12px 32px rgba(34, 30, 26, 0.08)',
      },
    },
  },
  plugins: [],
}
