import type { Config } from 'tailwindcss'

// Tailwind v4 minimal config - theme configuration is now in CSS
const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
}

export default config
