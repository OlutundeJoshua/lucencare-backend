/**
 * The single source of truth for how transactional emails look. Every value is taken
 * from the frontend's live design tokens (`src/styles/tokens.scss` in Lucen-Care-App)
 * or from the nav's own styles, so an email and the app it links to are recognisably
 * the same product.
 *
 * Only tokens the app actually ships belong here. In particular there is no indigo:
 * `logo-v3.svg` and the `.superpowers/brainstorm` explorations in the frontend repo use
 * one, but nothing in the app references either — the shipped lockup is
 * `logo-icon.svg` plus a teal "LUCEN CARE" wordmark.
 *
 * Every value here is used as an INLINE style. Gmail strips <style> blocks and <link>
 * tags outright, so an email stylesheet is not a thing that exists — the renderer
 * interpolates these into `style=""` attributes on every element.
 *
 * Translucent tokens from the frontend are flattened to their solid equivalent over
 * white here (e.g. teal at 8% becomes #EFF9F8). Older Outlook builds drop `rgba()`
 * entirely, which would leave a callout box with no background at all.
 */
export const EMAIL_THEME = {
  colors: {
    /** Primary brand and action colour — the lockup, buttons, accent rule. */
    teal: '#3AB0A1',
    tealDark: '#2A8A7D',
    /** Warm accent — callouts, the second half of the accent rule. */
    amber: '#F4A261',

    pageBg: '#F4F5F8',
    surface: '#FFFFFF',
    /**
     * The header band is white, like the app's own nav (.nav in
     * public-shell.component.scss) — the lockup is teal-on-white, so a coloured band
     * would either hide the wordmark or require a logo the app never uses.
     */
    headerBg: '#FFFFFF',

    text: '#12122A',
    textSecondary: '#3D6B67',
    textMuted: '#7A9E9A',

    /** Solid stand-ins for the frontend's translucent teal border/surface tokens. */
    border: '#D8EFEC',
    tealSurface: '#EFF9F8',
    amberSurface: '#FEF6EF',
    /** Neutral rule for dividers, which should not read as branded. */
    rule: '#E6E9F0',
  },

  /**
   * System font stack, deliberately not the app's DM Sans. Gmail, Outlook and Yahoo all
   * strip webfont @import/@font-face, so a webfont buys nothing in the clients that
   * matter and costs a render-blocking request in the ones that allow it.
   */
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  monoFamily: "'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",

  /** 600px is the widest an email can be before Outlook's reading pane clips it. */
  widthPx: 600,
  radiusPx: 14,
  logoWidthPx: 190,
} as const;
