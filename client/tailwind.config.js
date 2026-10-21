/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        /**
         * Deep teal — the single accent colour. Reads as considered and
         * commercial rather than the default indigo/violet everything ships
         * with. brand-700 is the text-safe tone on white; brand-600 is the
         * button fill.
         */
        brand: {
          50: '#EFFCF8',
          100: '#D4F5EB',
          200: '#AAEAD8',
          300: '#75D8BF',
          400: '#41BFA2',
          500: '#1FA386',
          600: '#11836C',
          700: '#0D6959',
          800: '#0F5349',
          900: '#0F453D',
          950: '#042923',
        },
        /**
         * Neutrals carry a faint green cast so they sit with the brand instead
         * of fighting it — warmer than slate, cleaner than stone.
         */
        ink: {
          50: '#F7F9F8',
          100: '#EFF2F1',
          200: '#DFE5E3',
          300: '#C5CECC',
          400: '#98A5A2',
          500: '#6F7D7A',
          600: '#56635F',
          700: '#44504D',
          800: '#2B3533',
          900: '#1A2322',
          950: '#0E1615',
        },
        /** Brass — used sparingly for warnings and "money" highlights. */
        brass: {
          50: '#FDF8ED',
          100: '#F9EDD0',
          200: '#F2D89D',
          300: '#E9BC63',
          400: '#E1A23A',
          500: '#D18A22',
          600: '#B36C1A',
          700: '#8F5018',
          800: '#75401B',
          900: '#623619',
        },
      },
      fontFamily: {
        sans: [
          'var(--font-sans)',
          'Plus Jakarta Sans',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        heading: [
          'Outfit',
          'var(--font-sans)',
          'Plus Jakarta Sans',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgba(14, 22, 21, 0.04), 0 1px 3px rgba(14, 22, 21, 0.06)',
        lift: '0 4px 12px rgba(14, 22, 21, 0.08), 0 1px 3px rgba(14, 22, 21, 0.05)',
        pop: '0 12px 32px rgba(14, 22, 21, 0.14)',
      },
    },
  },
  plugins: [],
};
