import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9ebff",
          200: "#bddcff",
          300: "#91c5ff",
          400: "#58a3ff",
          500: "#2b7fff",
          600: "#1c6bea",
          700: "#1555bd",
          800: "#184792",
          900: "#193d73",
          950: "#132649",
        },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
