/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html'],
  theme: {
    extend: {
      colors: {
        bg: '#000000',
        card: '#06060E',
        wc: '#3FA535',       // Webcor green
        wcDark: '#2C7A26',
        wcLight: '#5BC04F',
        sa: '#4A8EFF',
        sb: '#41A447',
        sc: '#FFBF00',
        sd: '#8B5CF6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries'),
  ],
}
