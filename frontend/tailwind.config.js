/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  darkMode: "class",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        // Web3 Design System - Dark theme with neon accents
        background: {
          DEFAULT: "#0a0a0a",
          secondary: "#1a1a1a",
          tertiary: "#0f0f0f",
        },
        foreground: {
          DEFAULT: "#ffffff",
          secondary: "#e5e7eb",
          muted: "#9ca3af",
        },
        border: {
          DEFAULT: "#374151",
          secondary: "#4b5563",
        },
        // Primary neon cyan
        primary: {
          DEFAULT: "#00d4ff",
          light: "#00f0ff",
          dark: "#00b8d4",
        },
        // Purple accent
        secondary: {
          DEFAULT: "#8b5cf6",
          light: "#a78bfa",
          dark: "#7c3aed",
        },
        // Status colors
        success: "#10b981",
        error: "#ef4444",
        warning: "#f59e0b",
        info: "#3b82f6",
        // Shadcn UI compatibility (optional, for components)
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
      },
    },
  },
}