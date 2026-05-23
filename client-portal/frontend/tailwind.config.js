/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#0A4D8C',     // deep ocean blue
          medium: '#1A7FBF',   // sky blue
          light: '#E8F4FD',    // ice blue
          bg: '#F0F8FF',       // alice blue-white
        },
        charcoal: '#1A2332',   // text charcoal
        slate: '#4A6580',      // slate gray
        status: {
          critical: '#D93025', // red
          warning: '#F5A623',  // amber
          success: '#2E9E6B',  // green
        }
      },
      fontFamily: {
        sans: ['"DM Sans"', 'sans-serif'],
        display: ['Sora', 'sans-serif'],
      },
      animation: {
        shake: 'shake 0.5s ease-in-out',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-5px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(5px)' },
        }
      }
    },
  },
  plugins: [],
}
