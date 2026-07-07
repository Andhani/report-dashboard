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
        ok:       'var(--ok)',
        pending:  'var(--pending)',
        empty:    'var(--empty)',
        success:  'var(--success)',
        warning:  'var(--warning)',
        danger:   'var(--danger)',
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        heading: ['"Inter Tight"', 'Inter', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', '"IBM Plex Mono"', 'monospace'],
      },
      borderRadius: {
        btn:  '6px',
        card: '10px',
      },
      boxShadow: {
        card:         '0 1px 2px rgba(0,0,0,0.05)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.08)',
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '1.4' }],
      },
    },
  },
  plugins: [],
}
