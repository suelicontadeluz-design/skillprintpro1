/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Design tokens Skiprintpro Admin
        brand: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          200: '#c0d2ff',
          300: '#93afff',
          400: '#6087ff',
          500: '#3a5fff',
          600: '#1f3ef5',
          700: '#182de0',
          800: '#1a28b5',
          900: '#1b278f',
          950: '#111654',
        },
        surface: {
          0:   '#ffffff',
          50:  '#f8f9fc',
          100: '#f0f2f8',
          200: '#e4e7f0',
          300: '#d0d5e8',
          800: '#1e2235',
          900: '#141828',
          950: '#0c1020',
        },
        // Tier colors
        tier: {
          bronze:   '#cd7f32',
          silver:   '#9ca3af',
          gold:     '#f59e0b',
          platinum: '#c0c0c0',
          diamond:  '#60a5fa',
        },
        // Status colors
        status: {
          active:    '#22c55e',
          inactive:  '#94a3b8',
          blocked:   '#ef4444',
          pending:   '#f59e0b',
          confirmed: '#3b82f6',
          cancelled: '#ef4444',
          used:      '#22c55e',
        }
      },
      fontFamily: {
        sans:    ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono:    ['var(--font-geist-mono)', 'monospace'],
        display: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'admin': '10px',
        'card':  '14px',
        'modal': '18px',
      },
      boxShadow: {
        'card':   '0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04)',
        'modal':  '0 8px 40px rgba(0,0,0,.16)',
        'glow-brand': '0 0 0 3px rgba(58,95,255,.25)',
      },
      animation: {
        'fade-in':    'fadeIn 0.18s ease-out',
        'slide-up':   'slideUp 0.22s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:    { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp:   { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        pulseSoft: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.6 } },
      },
    },
  },
  plugins: [],
}
