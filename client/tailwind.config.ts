import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        // Palette DET (round-robin)
        det: {
          green:  '#16A34A',
          blue:   '#2563EB',
          orange: '#D97706',
          purple: '#7C3AED',
          red:    '#DC2626',
          cyan:   '#0891B2',
          pink:   '#DB2777',
          lime:   '#65A30D',
        },
        // Importo scorporato
        scorporo: '#D97706',
      },
      backdropBlur: {
        xs: '2px',
      },
      // Glassmorphism
      boxShadow: {
        glass: '0 4px 30px rgba(0, 0, 0, 0.1)',
        'glass-lg': '0 8px 32px rgba(0, 0, 0, 0.15)',
      },
    },
  },
  plugins: [],
} satisfies Config
