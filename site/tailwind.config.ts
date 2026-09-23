import type { Config } from "tailwindcss";

/**
 * The "Modernist" design system, as tokens.
 *
 * Flat and architectural: one typeface, near-monochrome ink on a light ground,
 * one red accent, and NO BORDER RADIUS anywhere — hence `borderRadius: none`
 * overriding Tailwind's scale rather than sitting alongside it, so a stray
 * `rounded-md` can't creep in and soften a corner the design wants sharp.
 *
 * Dark mode is by media query, not a class: people open this from a phone
 * notification and should get whatever their phone is already doing.
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        ink: "var(--color-text)",
        divider: "var(--color-divider)",
        accent: {
          DEFAULT: "var(--color-accent)",
          100: "var(--color-accent-100)",
          200: "var(--color-accent-200)",
          300: "var(--color-accent-300)",
          400: "var(--color-accent-400)",
          500: "var(--color-accent-500)",
          600: "var(--color-accent-600)",
          700: "var(--color-accent-700)",
          800: "var(--color-accent-800)",
          900: "var(--color-accent-900)",
        },
        neutral: {
          100: "var(--color-neutral-100)",
          200: "var(--color-neutral-200)",
          300: "var(--color-neutral-300)",
          400: "var(--color-neutral-400)",
          500: "var(--color-neutral-500)",
          600: "var(--color-neutral-600)",
          700: "var(--color-neutral-700)",
          800: "var(--color-neutral-800)",
          900: "var(--color-neutral-900)",
        },
        /** Fixed values, deliberately NOT theme variables. The "can't read"
         *  surfaces look identical in light and dark so the alarming state is
         *  never softened by someone's phone settings, and the Book button's
         *  label stays legible on the red field in both. */
        hazard: { bg: "#201e1d", fg: "#f3f2f2" },
        onred: "#9a1f0b",
      },
      fontFamily: {
        sans: ["var(--font-archivo)", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        display: "-0.045em",
        tight2: "-0.035em",
        tight1: "-0.015em",
        kicker: "0.12em",
      },
      keyframes: {
        spin1s: { to: { transform: "rotate(360deg)" } },
        flash: { from: { backgroundColor: "var(--color-accent-100)" }, to: { backgroundColor: "transparent" } },
      },
      animation: {
        spin1s: "spin1s 1s linear infinite",
        flash: "flash .6s ease-out",
      },
    },
    borderRadius: { none: "0", DEFAULT: "0", full: "9999px" },
  },
  plugins: [],
} satisfies Config;
