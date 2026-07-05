/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Override gray with a refined cool-neutral scale
        gray: {
          50:  '#f5f6f8',
          100: '#f0f1f4',
          200: '#e2e4e9',
          300: '#d0d3db',
          400: '#9ba0b4',
          500: '#8a8fa8',
          600: '#4b5060',
          700: '#3a3f52',
          800: '#252a38',
          900: '#0f1117',
        },
        // New accent: periwinkle indigo (replaces sky-blue brand)
        brand: {
          50:  '#eef0fe',
          100: '#dde1fd',
          500: '#6b7af2',
          600: '#5b6cf0',
          700: '#4655e0',
          900: '#2a3ab0',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        btn:  '6px',
        card: '10px',
      },
      boxShadow: {
        card:       '0 1px 3px rgba(0,0,0,.08)',
        'card-hover': '0 4px 16px rgba(0,0,0,.10)',
      },
    },
  },
  plugins: [],
}
