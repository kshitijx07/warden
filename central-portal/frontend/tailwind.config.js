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
        charcoal: '#1A2332',   // charcoal text
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
        slideIn: 'slideIn 0.3s ease-out forwards',
        pulseSlow: 'pulse 2s infinite',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        }
      }
    },
  },
  plugins: [],
}
