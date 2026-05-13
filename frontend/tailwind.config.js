/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
      },
      colors: {
        ghost: {
          bg: '#080c10',
          panel: '#0d1117',
          border: '#1e2d3d',
          accent: '#00d4ff',
          warn: '#ff6b35',
          danger: '#ff2244',
          ok: '#00ff88',
          dim: '#4a5568',
          text: '#c9d1d9',
        },
      },
    },
  },
  plugins: [],
}
