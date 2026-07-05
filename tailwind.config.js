/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Semantic text / surface tokens
        ink:     '#111827',
        muted:   '#6B7280',
        line:    '#E5E7EB',
        surface: '#FFFFFF',
        bg:      '#F9FAFB',
        // Single brand accent — indigo. Use /opacity modifiers for tints.
        accent: {
          DEFAULT: '#4F46E5',
          dark:    '#4338CA',
        },
        // Semantic status colors ONLY — never used decoratively
        success: '#16A34A',
        warning: '#D97706',
        danger:  '#DC2626',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        btn:  '6px',
        card: '10px',
      },
      boxShadow: {
        card:         '0 1px 3px rgba(0,0,0,.08)',
        'card-hover': '0 4px 16px rgba(0,0,0,.10)',
      },
    },
  },
  plugins: [],
}
