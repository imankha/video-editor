/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}",
    // Shared editor player leaves imported via the @editor alias — scan them so
    // their Tailwind classes (scrubber, speed menu, etc.) end up in the bundle.
    "../frontend/src/components/shared/VideoControls.jsx",
  ],
  theme: {
    extend: {
      animation: {
        'fade-in': 'fade-in 0.4s ease-out',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
