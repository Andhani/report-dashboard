/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['attribute', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg:           'var(--bg)',
        surface:      'var(--surface)',
        'surface-2':  'var(--surface-2)',
        line:         'var(--border)',
        border:       'var(--border)',
        ink:          'var(--text)',
        muted:        'var(--text-muted)',
        accent: {
          DEFAULT: 'var(--accent)',
          text:    'var(--accent-text)',
          subtle:  'var(--accent-subtle)',
          dark:    'var(--accent)',
        },
        success:  'var(--success)',
        warning:  'var(--warning)',
        danger:   'var(--danger)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"IBM Plex Mono"', 'monospace'],
      },
      borderRadius: {
        btn:  '8px',
        card: '12px',
      },
      boxShadow: {
        card:         '0 1px 3px rgba(0,0,0,0.06)',
        'card-hover': '0 4px 16px rgba(0,0,0,0.10)',
      },
    },
  },
  plugins: [],
}
