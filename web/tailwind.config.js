import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  // shadcn/ui requires darkMode: 'class'; the app is forced dark (html.dark).
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        // Existing Intants indigo brand scale — kept so any `primary-600`-style
        // references still resolve. `primary` (no number) is the shadcn shim and
        // now maps to WHITE (the Superwhisper action color) via --primary.
        primary: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          // shadcn CSS-variable shim
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },

        // shadcn/ui semantic tokens (remapped to the dark Superwhisper palette
        // in index.css)
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',

        // ── Superwhisper palette (literal hex) ──────────────────────────────
        // Brand accents — chromatic colour is rationed; electric blue is THE
        // signal, lavender belongs to the aurora gradient.
        'electric-signal': '#0088ff',
        electric: '#0088ff',
        'lavender-mist': '#b855e7',
        lavender: '#b855e7',
        'sky-wash': '#60a5fa',
        ember: '#e6714f',
        'amber-glow': '#ffb764',
        sunburst: '#ffdd00',
        'forest-pulse': '#16c253',
        'vivid-mint': '#27c93f',
        'pink-static': '#dd55e7',
        // Neutrals / surfaces
        midnight: '#000000',
        obsidian: '#0f0f10',
        charcoal: '#1c1d1f',
        graphite: '#333333',
        slate: '#595959',
        fog: '#70757c',
        ash: '#888b91',
        silver: '#999999',
        mist: '#b8babf',
        pearl: '#cccccc',
        bone: '#e5e7eb',
        'deep-navy': '#001b33',
        'midnight-indigo': '#030719',

        // ── Cluely light-theme palette (scoped to the marketing landing page) ──
        // A namespaced set so it never collides with the dark app tokens above.
        // Light page, single Signal-Blue accent, achromatic everywhere else.
        cluely: {
          signal: '#3c83f6', // primary action blue
          'deep-dusk': '#022c70', // gradient terminus / button shadow depth
          azure: '#0544a5', // supporting blue accent
          'hover-glow': '#81b6ff', // button inset highlight
          ink: '#000000',
          carbon: '#18181b', // primary text
          slate: '#2e3038', // nav / secondary headings
          steel: '#5e616e', // muted body text
          fog: '#777a88', // captions / tertiary
          mist: '#afb3c4', // icon strokes / placeholders
          vapor: '#edeef2', // alt card surface
          frost: '#f3f8ff', // tinted card / hero-adjacent band
          chalk: '#ffffff', // page canvas
          bone: '#e4e4e7', // hairline borders (the dominant line color)
          ash: '#d7d7d7', // secondary dividers
          cyan: '#7df0f8', // decorative cool highlight
        },
      },

      backgroundImage: {
        // The single defining atmosphere of the brand.
        aurora:
          'linear-gradient(#000000 0.85%, #112d72 33.4%, #4b52aa 49.68%, #a887dc 70.84%, #e6c4e7 95.8%, #fcdbef 107.19%)',
        'aurora-wash':
          'linear-gradient(90deg, rgba(25,153,232,0.15) 2.75%, rgba(164,91,242,0.15) 99.26%)',
        'signal-blue': 'linear-gradient(#0fb7fa, #0072fb)',
        // Cluely landing — blue dawn sky descending into mountain-indigo.
        // (No `cluely-signal` image here — it would collide with the
        // `cluely.signal` color's `bg-cluely-signal` utility. CTA stays flat.)
        'cluely-hero':
          'linear-gradient(180deg, #9ec6f7 0%, #6ea4f1 20%, #3f78e8 42%, #245fd8 60%, #143fb4 78%, #0a256f 100%)',
      },

      fontFamily: {
        sans: ['"SF Pro Text"', '-apple-system', 'BlinkMacSystemFont', 'Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        flow: ['Inter Tight', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Cluely landing — Geist (all UI) + EB Garamond (the one serif display).
        geist: ['Geist', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        'eb-garamond': ['"EB Garamond"', 'Cormorant Garamond', 'Georgia', 'serif'],
      },

      // Inter type scale with the signature aggressive negative tracking.
      fontSize: {
        micro: ['10px', { lineHeight: '1.6', letterSpacing: '0.25px' }],
        caption: ['12px', { lineHeight: '1.56', letterSpacing: '0.3px' }],
        'body-sm': ['14px', { lineHeight: '1.5' }],
        body: ['16px', { lineHeight: '1.5', letterSpacing: '-0.16px' }],
        'body-lg': ['18px', { lineHeight: '1.5', letterSpacing: '-0.18px' }],
        subheading: ['24px', { lineHeight: '1.25', letterSpacing: '-0.6px' }],
        heading: ['30px', { lineHeight: '1.2', letterSpacing: '-1.2px' }],
        'heading-lg': ['48px', { lineHeight: '1.07', letterSpacing: '-2.4px' }],
        display: ['60px', { lineHeight: '1.06', letterSpacing: '-3.42px' }],
      },

      letterSpacing: {
        tightest: '-0.057em',
        display: '-3.42px',
        'heading-lg': '-2.4px',
        heading: '-1.2px',
        subheading: '-0.6px',
        body: '-0.16px',
      },

      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },

      boxShadow: {
        // The system's signature 1px white-alpha inset ring that defines edges
        // on dark surfaces.
        'inset-hairline': 'inset 0 0 0 1px rgb(255 255 255 / 0.14)',
        'inset-hairline-strong': 'inset 0 0 0 1px rgb(255 255 255 / 0.22)',
        'aurora-card': '0 1px 4px 0 rgb(0 0 0 / 0.25), 0 4px 59px 0 rgb(0 0 0 / 0.10)',

        // ── Apple elevation = value-only (NO shadows on cards) ────────────────
        // Resting cards are shadowless (white on Fog). Only a whisper appears on
        // hover for interactive feedback, and overlays keep their own shadow.
        card: '0 0 #0000',
        'card-hover': '0 8px 24px -14px rgb(29 29 31 / 0.16)',
        elevated: '0 0 #0000',

        // ── Cluely landing elevation ──────────────────────────────────────────
        // Glassy illuminated CTA: ring + inset depth + inset highlight (no drop).
        'cluely-cta':
          '0 0 0 0.5px #0544a9, inset 0 -1px 0 0 #022c70, inset 0 0.5px 0 0 #81b6ff',
        // Floating product mockup: hairline ring + top highlight + soft ambient.
        'cluely-mockup':
          '0 0 0 1px rgba(207,226,255,0.5), inset 0 -0.5px 0 0 rgba(255,255,255,0.8), 0 40px 80px -24px rgba(8,29,93,0.45), 0 12px 32px -16px rgba(8,29,93,0.30)',
        // Highlighted card glow (lavender-blue).
        'cluely-glow':
          '20px 20px 24px 0 rgba(148,172,243,0.4), inset -3px -3px 4px 0 rgba(191,229,251,0.4), inset 4px 4px 4px 0 rgba(19,26,228,0.1)',
      },

      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },

      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        // Keyframes for these live in index.css (so the raw `voice-bar` name used
        // by HeroCinematic's inline style also resolves).
        'aurora-drift': 'aurora-drift 22s ease-in-out infinite',
        'silhouette-float': 'silhouette-float 13s ease-in-out infinite',
        'laptop-float': 'laptop-float 16s ease-in-out infinite',
        'voice-bar': 'voice-bar 1.4s ease-in-out infinite',
        // Cluely landing — slow buoyant float for the floating product mockup.
        'cluely-float': 'cluely-float 9s ease-in-out infinite',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
