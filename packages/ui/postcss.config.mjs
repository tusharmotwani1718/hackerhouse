// Tailwind CSS v4 through PostCSS. Apps re-export this file (apps/web/postcss.config.mjs), so
// every app builds the shared styles the same way.
/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: { "@tailwindcss/postcss": {} },
};

export default config;
