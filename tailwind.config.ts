import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // AxlePoint brand system
        forest: {
          DEFAULT: "#1f5a44",
          dark: "#16412f",
          light: "#2d7a5d",
          tint: "#e8f0ec",
        },
        cream: "#f7f5f0",
        ink: {
          DEFAULT: "#1a1a1a",
          soft: "#4a4a45",
          faint: "#8a877e",
        },
        gold: {
          DEFAULT: "#c89c47",
          tint: "#f5edda",
        },
        line: "#e4e0d6",
        panel: "#ffffff",
        risk: {
          low: "#2d8c5a",
          medium: "#c89c47",
          high: "#b65d3e",
          critical: "#8c2e1f",
        },
      },
      fontFamily: {
        sans: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(26, 26, 26, 0.05), 0 2px 8px rgba(26, 26, 26, 0.04)",
        raised:
          "0 2px 4px rgba(26, 26, 26, 0.06), 0 8px 24px rgba(26, 26, 26, 0.08)",
      },
    },
  },
  plugins: [],
};
export default config;
