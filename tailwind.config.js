/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#050507',
        panel: '#0c0c11',
        card: '#13131b',
      },
      fontFamily: {
        display: ['Sora', 'sans-serif'],
        body: ['Manrope', 'sans-serif'],
      },
      boxShadow: {
        neon:
          '0 0 0 1px rgba(255,255,255,0.06), 0 20px 60px rgba(124,58,237,0.18), 0 18px 45px rgba(239,68,68,0.14)',
        glow: '0 0 32px rgba(239,68,68,0.16), 0 0 48px rgba(139,92,246,0.14)',
      },
    },
  },
  plugins: [],
}
