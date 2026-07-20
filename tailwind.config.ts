import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
      colors: {
        surface: "var(--surface)", panel: "var(--panel)", ink: "var(--ink)",
        muted: "var(--muted)", line: "var(--line)", accent: "var(--accent)",
      },
    },
  },
  plugins: [],
} satisfies Config;
