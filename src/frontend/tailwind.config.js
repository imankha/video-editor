/** @type {import('tailwindcss').Config} */
import plugin from 'tailwindcss/plugin';

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [
    plugin(({ addVariant }) => {
      // Primary pointer is a mouse/trackpad (desktop). Relax touch minimums here.
      addVariant('fine-pointer', '@media (hover: hover) and (pointer: fine)');
      // Primary pointer is a finger (phone + tablet). Enforce 44px touch targets.
      addVariant('coarse-pointer', '@media (hover: none) and (pointer: coarse)');
    }),
  ],
}
