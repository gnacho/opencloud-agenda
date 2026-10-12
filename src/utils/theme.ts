// OpenCloud offers no theme class and no media query to hook into — it swaps the
// --oc-role-* custom properties at runtime. Almost everything can simply consume
// those properties, but native form controls (date pickers, selects, scrollbars)
// obey the CSS `color-scheme` property, which takes a keyword rather than a
// colour. `color-scheme: light dark` hands the decision to the operating system,
// which is exactly the mismatch that broke the light theme: OS dark + OpenCloud
// light produced dark pickers inside light dialogs.
//
// So the keyword has to be derived from the theme's own surface colour.

/** Relative luminance per WCAG 2.1, or null if the colour cannot be parsed. */
export function luminance(color: string): number | null {
  const c = color.trim()
  let r: number, g: number, b: number

  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map(x => x + x).join('') : hex[1]
    ;[r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
  } else {
    const rgb = c.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
    if (!rgb) return null
    ;[r, g, b] = rgb.slice(1, 4).map(v => Number(v) / 255)
  }

  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/**
 * The `color-scheme` keyword matching a background colour. Unparseable input
 * falls back to 'light', the CSS default — better a wrong keyword than a
 * thrown error while painting.
 */
export function schemeForBackground(color: string): 'light' | 'dark' {
  const l = luminance(color)
  return l !== null && l < 0.5 ? 'dark' : 'light'
}

// Calendar and subscription colours are chosen freely by the user, so event
// chips cannot assume light-on-dark: a white calendar got white text.
//
// By WCAG arithmetic black and white break even at luminance ≈ 0.179, but the
// app's default blue (#0082c9, L ≈ 0.20) and the subscription orange (#e67e22,
// L ≈ 0.30) have always carried white text and read well that way. White is
// therefore kept up to 0.4; black takes over only where white genuinely fails —
// light greens, yellows, pastels, white itself.
const BLACK_TEXT_ABOVE = 0.4

/**
 * Black or white, whichever contrasts more with `background`. Falls back to
 * white for colours it cannot parse (named colours such as `teal`), matching
 * FullCalendar's own default.
 */
export function contrastText(background: string): '#000000' | '#ffffff' {
  const l = luminance(background)
  return l !== null && l > BLACK_TEXT_ABOVE ? '#000000' : '#ffffff'
}

/**
 * Whether a colour is so light that an element painted with it dissolves into
 * a light surface and needs an explicit outline. A saturated yellow (L ≈ 0.81)
 * is still clearly a chip; the threshold sits above it.
 */
export function isNearWhite(color: string): boolean {
  const l = luminance(color)
  return l !== null && l > 0.85
}
