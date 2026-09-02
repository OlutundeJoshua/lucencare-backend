import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EMAIL_THEME } from 'src/common/constants/email-theme';
import { EmailBlock } from 'src/common/interfaces/email-block.type';
import { EmailContent } from 'src/common/interfaces/email-content.interface';

import { renderEmailText } from './email-text.util';

const { colors: C, fontFamily, monoFamily, widthPx, radiusPx, logoWidthPx } = EMAIL_THEME;

/**
 * Schemes a button is allowed to link to. Anything else (`javascript:`, `data:`) is
 * rendered as inert text instead of an anchor — see `buttonHtml`.
 */
const SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:'];

/** The app's own footer links (.footer in public-shell.component.html), same order. */
const FOOTER_LINKS = [
  { label: 'Privacy Policy', path: '/privacy-policy' },
  { label: 'Terms', path: '/terms' },
  { label: 'Contact', path: '/contact' },
];

/** Shared inline styles, so body copy stays consistent across every block kind. */
const BODY_TEXT = `font-family:${fontFamily};font-size:15px;line-height:24px;color:${C.text};`;
const PARAGRAPH = `margin:0 0 16px;${BODY_TEXT}`;

/**
 * Renders an `EmailContent` to the two parts of a multipart/alternative message.
 *
 * Email HTML is not web HTML. The constraints this class works under, all of which are
 * load-bearing rather than stylistic:
 *
 * - **Inline styles only.** Gmail strips <style> and <link>, so there is no stylesheet.
 * - **Tables for layout.** Outlook renders through Word's HTML engine, which has no
 *   flexbox and no grid; nested tables are the only layout primitive that works.
 * - **Explicit background colours on every cell**, plus a `color-scheme` hint. Apple
 *   Mail and Outlook dark modes otherwise invert unpainted regions and can leave dark
 *   text on a dark ground.
 * - **Every interpolated value is escaped.** Patient names, programme titles and
 *   admin-written rejection reasons all reach these templates, and in an HTML part an
 *   unescaped `<` is markup injection rather than a cosmetic bug.
 */
@Injectable()
export class EmailRendererService {
  constructor(private readonly configService: ConfigService) {}

  /** The HTML part. `subject` is used for <title>, which some clients show while loading. */
  toHtml(subject: string, content: EmailContent): string {
    const logoUrl = this.configService.get<string>('mail.logoUrl');
    const brandUrl = this.configService.get<string>('mail.brandUrl');
    const supportEmail = this.configService.get<string>('mail.supportEmail');

    const body = content.blocks.map((block) => this.blockHtml(block)).join('\n');

    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      // Declares the email as light-only. Without it, dark-mode clients apply their own
      // colour inversion on top of the inline styles below.
      '<meta name="color-scheme" content="light">',
      '<meta name="supported-color-schemes" content="light">',
      `<title>${this.esc(subject)}</title>`,
      '</head>',
      `<body style="margin:0;padding:0;width:100%;background-color:${C.pageBg};-webkit-font-smoothing:antialiased;">`,
      this.preheaderHtml(content.preheader),
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.pageBg};">`,
      '<tr>',
      '<td align="center" style="padding:24px 12px;">',
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${widthPx}" style="width:${widthPx}px;max-width:${widthPx}px;">`,
      this.headerHtml(logoUrl, brandUrl),
      this.accentRuleHtml(),
      '<tr>',
      `<td style="background-color:${C.surface};padding:32px 32px 24px 32px;">`,
      body,
      '</td>',
      '</tr>',
      this.footerHtml(brandUrl, supportEmail),
      '</table>',
      '</td>',
      '</tr>',
      '</table>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  /**
   * The plain-text part. Delegates to `renderEmailText`, which needs no branding
   * config — this method exists so callers holding the service have both parts in one
   * place.
   */
  toText(content: EmailContent): string {
    return renderEmailText(content);
  }

  // ── Block rendering ─────────────────────────────────────────────────────────

  private blockHtml(block: EmailBlock): string {
    switch (block.kind) {
      case 'heading':
        return `<h1 style="margin:0 0 16px;font-family:${fontFamily};font-size:22px;line-height:30px;font-weight:700;color:${C.text};">${this.esc(block.text)}</h1>`;

      case 'paragraph':
        return `<p style="${PARAGRAPH}">${this.esc(block.text)}</p>`;

      case 'list': {
        // The lead sits tighter above the bullets than a normal paragraph would, so the
        // two read as one unit.
        const lead = block.lead
          ? `<p style="margin:0 0 8px;${BODY_TEXT}">${this.esc(block.lead)}</p>`
          : '';
        const items = block.items
          .map(
            (item) =>
              `<li style="margin:0 0 8px;${BODY_TEXT}"><span style="${BODY_TEXT}">${this.esc(item)}</span></li>`,
          )
          .join('');
        return `${lead}<ul style="margin:0 0 20px;padding:0 0 0 22px;">${items}</ul>`;
      }

      case 'detailRows': {
        const lead = block.lead
          ? `<p style="margin:0 0 10px;${BODY_TEXT}">${this.esc(block.lead)}</p>`
          : '';
        const rows = block.rows
          .map(
            (row) =>
              '<tr>' +
              `<td style="padding:7px 14px 7px 0;font-family:${fontFamily};font-size:13px;line-height:20px;color:${C.textMuted};white-space:nowrap;vertical-align:top;">${this.esc(row.label)}</td>` +
              `<td style="padding:7px 0;font-family:${fontFamily};font-size:15px;line-height:20px;font-weight:600;color:${C.text};vertical-align:top;">${this.esc(row.value)}</td>` +
              '</tr>',
          )
          .join('');
        return (
          lead +
          this.spaced(
            `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:${C.tealSurface};border:1px solid ${C.border};border-radius:10px;">` +
              `<tr><td style="padding:6px 18px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>` +
              '</table>',
          )
        );
      }

      case 'code': {
        const caption = block.caption
          ? `<p style="margin:0 0 10px;${BODY_TEXT}">${this.esc(block.caption)}</p>`
          : '';
        return (
          caption +
          this.spaced(
            `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:${C.tealSurface};border:1px solid ${C.border};border-radius:10px;">` +
              `<tr><td align="center" style="padding:20px 18px;font-family:${monoFamily};font-size:28px;line-height:34px;font-weight:700;letter-spacing:5px;color:${C.text};">${this.esc(block.value)}</td></tr>` +
              '</table>',
          )
        );
      }

      case 'button':
        return this.buttonHtml(block.label, block.url);

      case 'callout':
        return this.spaced(
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:${C.amberSurface};border-left:4px solid ${C.amber};border-radius:0 10px 10px 0;">` +
            `<tr><td style="padding:14px 18px;font-family:${fontFamily};font-size:15px;line-height:23px;font-weight:600;color:${C.text};">${this.esc(block.text)}</td></tr>` +
            '</table>',
        );

      case 'signoff':
        // The only block that honours an internal newline: sign-offs are legitimately
        // two lines ("You've got this," / "The LucenCare Team"), and splitting them into
        // two blocks would put a blank line between them in the text part.
        return `<p style="margin:24px 0 0;font-family:${fontFamily};font-size:15px;line-height:24px;color:${C.textSecondary};">${this.esc(block.text).replace(/\n/g, '<br>')}</p>`;

      case 'divider':
        return this.spaced(
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">` +
            `<tr><td style="height:1px;line-height:1px;font-size:0;background-color:${C.rule};">&nbsp;</td></tr>` +
            '</table>',
        );
    }
  }

  // ── Shell ───────────────────────────────────────────────────────────────────

  private headerHtml(logoUrl?: string, brandUrl?: string): string {
    // White, like the app's own nav — the shipped lockup is teal-on-white, so a
    // coloured band would swallow the wordmark. The band is a painted <td> rather than a
    // background image, and the <img> carries the brand's colour and weight as its own
    // text styling, so an inbox with images blocked falls back to a teal "LUCEN CARE"
    // rather than to a blank gap.
    const logo = `<img src="${this.escAttr(logoUrl ?? '')}" width="${logoWidthPx}" alt="LUCEN CARE" style="display:block;border:0;outline:none;text-decoration:none;width:${logoWidthPx}px;max-width:${logoWidthPx}px;height:auto;font-family:${fontFamily};font-size:18px;font-weight:800;letter-spacing:1.2px;color:${C.teal};">`;

    return (
      '<tr>' +
      `<td align="center" bgcolor="${C.headerBg}" style="background-color:${C.headerBg};border-radius:${radiusPx}px ${radiusPx}px 0 0;padding:26px 24px 22px 24px;">` +
      (this.isSafeUrl(brandUrl)
        ? `<a href="${this.escAttr(brandUrl!)}" style="text-decoration:none;">${logo}</a>`
        : logo) +
      '</td>' +
      '</tr>'
    );
  }

  /**
   * Teal-into-amber rule under the header. Both are live tokens, and with a white header
   * above a white card this is also what separates the two — the app's nav does the same
   * job with a teal-tinted bottom border.
   */
  private accentRuleHtml(): string {
    return (
      '<tr>' +
      '<td style="padding:0;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">' +
      '<tr>' +
      `<td width="55%" style="height:4px;line-height:4px;font-size:0;background-color:${C.teal};">&nbsp;</td>` +
      `<td width="45%" style="height:4px;line-height:4px;font-size:0;background-color:${C.amber};">&nbsp;</td>` +
      '</tr>' +
      '</table>' +
      '</td>' +
      '</tr>'
    );
  }

  private footerHtml(brandUrl?: string, supportEmail?: string): string {
    const support = this.isSafeUrl(`mailto:${supportEmail}`)
      ? ` If you need a hand, reach us at <a href="mailto:${this.escAttr(supportEmail!)}" style="color:${C.teal};text-decoration:underline;">${this.esc(supportEmail!)}</a>.`
      : '';

    // Mirrors the app's own footer (.footer in public-shell.component.html): the
    // wordmark plus Privacy Policy / Terms / Contact. Deliberately not a tagline — the
    // one in logo-v3.svg reads well but appears nowhere in the product, and inventing
    // brand copy in a transactional email is how the two channels start disagreeing.
    const links = FOOTER_LINKS.map(
      ({ label, path }) =>
        `<a href="${this.escAttr(`${brandUrl}${path}`)}" style="color:${C.textMuted};text-decoration:underline;">${label}</a>`,
    ).join(' &middot; ');

    return (
      '<tr>' +
      `<td style="background-color:${C.surface};border-radius:0 0 ${radiusPx}px ${radiusPx}px;border-top:1px solid ${C.rule};padding:22px 32px 26px 32px;">` +
      `<p style="margin:0;font-family:${fontFamily};font-size:12px;line-height:19px;color:${C.textMuted};">` +
      'You are receiving this email because you have a LucenCare account.' +
      support +
      '</p>' +
      (this.isSafeUrl(brandUrl)
        ? `<p style="margin:12px 0 0;font-family:${fontFamily};font-size:12px;line-height:19px;color:${C.textMuted};"><span style="font-weight:800;letter-spacing:1.2px;color:${C.teal};">LUCEN CARE</span> &middot; ${links}</p>`
        : '') +
      '</td>' +
      '</tr>'
    );
  }

  /**
   * The inbox preview snippet. Hidden in the body, then padded with zero-width
   * characters so the client stops scraping before it reaches the visible copy.
   */
  private preheaderHtml(preheader?: string): string {
    if (!preheader) return '';

    return (
      '<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">' +
      this.esc(preheader) +
      '&#847;&zwnj;&nbsp;'.repeat(60) +
      '</div>'
    );
  }

  private buttonHtml(label: string, url: string): string {
    // An unsafe scheme is shown as inert text rather than silently dropped, so the
    // reader still sees what was meant to be there.
    if (!this.isSafeUrl(url)) {
      return `<p style="${PARAGRAPH}">${this.esc(label)}: ${this.esc(url)}</p>`;
    }

    return this.spaced(
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0">' +
        `<tr><td align="center" bgcolor="${C.teal}" style="background-color:${C.teal};border-radius:10px;">` +
        `<a href="${this.escAttr(url)}" style="display:inline-block;padding:14px 30px;font-family:${fontFamily};font-size:15px;line-height:20px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;">${this.esc(label)}</a>` +
        '</td></tr>' +
        '</table>',
      '4px 0 22px',
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Outlook drops margins on <table>, so block-level tables get their spacing from a
   * wrapping <div> instead.
   */
  private spaced(html: string, margin = '0 0 20px'): string {
    return `<div style="margin:${margin};">${html}</div>`;
  }

  private esc(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Attribute values need the same treatment plus no raw quotes to break out of `style=""`. */
  private escAttr(value: string): string {
    return this.esc(value);
  }

  private isSafeUrl(url?: string): boolean {
    if (!url) return false;

    try {
      return SAFE_URL_SCHEMES.includes(new URL(url).protocol);
    } catch {
      return false;
    }
  }
}
