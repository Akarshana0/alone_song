import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        void: {
          950: "#08080b",
          900: "#0d0d12",
          850: "#121218",
          800: "#17171f",
          700: "#212129",
          600: "#2c2c36",
        },
        neon: {
          cyan: "#3ee6e0",
          pink: "#ff4fd8",
          violet: "#a45bff",
          amber: "#ffb84f",
          red: "#ff5c6c",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      boxShadow: {
        "neon-cyan": "0 0 12px rgba(62,230,224,0.55), 0 0 2px rgba(62,230,224,0.8)",
        "neon-pink": "0 0 12px rgba(255,79,216,0.55), 0 0 2px rgba(255,79,216,0.8)",
        "neon-amber": "0 0 12px rgba(255,184,79,0.5), 0 0 2px rgba(255,184,79,0.8)",
        panel: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.45)",
      },
      backgroundImage: {
        "grid-fade":
          "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        pulseGlow: "pulseGlow 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
