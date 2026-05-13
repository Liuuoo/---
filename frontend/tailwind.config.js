/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
      },
      colors: {
        ghost: {
          bg: 'var(--ghost-bg)',
          panel: 'var(--ghost-panel)',
          border: 'var(--ghost-border)',
          accent: 'var(--ghost-accent)',
          warn: 'var(--ghost-warn)',
          danger: 'var(--ghost-danger)',
          ok: 'var(--ghost-ok)',
          dim: 'var(--ghost-dim)',
          text: 'var(--ghost-text)',
        },
      },
    },
  },
  plugins: [],
}
