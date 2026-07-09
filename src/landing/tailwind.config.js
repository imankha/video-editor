/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    // Shared editor player leaves imported via the @editor alias — scan them so
    // their Tailwind classes (scrubber, speed menu, etc.) end up in the bundle.
    "../frontend/src/components/shared/VideoControls.jsx",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
