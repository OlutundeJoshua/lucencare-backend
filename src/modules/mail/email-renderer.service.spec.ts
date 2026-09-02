import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { EmailContent } from 'src/common/interfaces/email-content.interface';

import { EmailRendererService } from './email-renderer.service';

const BRANDING: Record<string, string> = {
  'mail.logoUrl': 'https://cdn.lucencare.test/logo-email.png',
  'mail.brandUrl': 'https://app.lucencare.test',
  'mail.supportEmail': 'support@lucencare.test',
};

describe('EmailRendererService', () => {
  let service: EmailRendererService;

  const html = (content: EmailContent, subject = 'Subject') => service.toHtml(subject, content);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailRendererService,
        { provide: ConfigService, useValue: { get: (key: string) => BRANDING[key] } },
      ],
    }).compile();

    service = module.get<EmailRendererService>(EmailRendererService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('document shell', () => {
    const rendered = () => html({ blocks: [{ kind: 'paragraph', text: 'Hello,' }] }, 'Your code');

    it('emits a complete HTML document', () => {
      expect(rendered()).toMatch(/^<!doctype html>/);
      expect(rendered()).toContain('</html>');
    });

    it('puts the subject in the title', () => {
      expect(rendered()).toContain('<title>Your code</title>');
    });

    // Without this, a dark-mode client applies its own inversion on top of the inline
    // colours and can end up painting dark text on a dark ground.
    it('declares the email as light-only for dark-mode clients', () => {
      expect(rendered()).toContain('<meta name="color-scheme" content="light">');
      expect(rendered()).toContain('<meta name="supported-color-schemes" content="light">');
    });

    // Gmail strips <style> and <link>, so a stylesheet would silently do nothing.
    it('uses no stylesheet or style block', () => {
      expect(rendered()).not.toContain('<style');
      expect(rendered()).not.toContain('<link');
    });

    it('paints the body background rather than leaving it to the client', () => {
      expect(rendered()).toContain('background-color:#F4F5F8');
    });

    it('constrains the layout to 600px', () => {
      expect(rendered()).toContain('max-width:600px');
    });

    it('renders the logo from config with alt text and a link to the app', () => {
      expect(rendered()).toContain('src="https://cdn.lucencare.test/logo-email.png"');
      expect(rendered()).toContain('alt="LUCEN CARE"');
      expect(rendered()).toContain('href="https://app.lucencare.test"');
    });

    // The shipped lockup (logo-icon.svg + a teal wordmark) is teal-on-white, so the
    // band matches the app's own white nav. A coloured band would swallow the wordmark.
    it('paints the header band white, like the app nav', () => {
      expect(rendered()).toContain('bgcolor="#FFFFFF"');
    });

    // With images blocked the <img> falls back to its alt text, which must still read as
    // the brand rather than as unstyled black body copy.
    it('styles the logo alt-text fallback in the brand colour and weight', () => {
      expect(rendered()).toContain('font-weight:800;letter-spacing:1.2px;color:#3AB0A1');
    });

    // Nothing in the app references the indigo in logo-v3.svg or the brainstorm files.
    it('uses no colour the app does not ship', () => {
      expect(rendered()).not.toContain('#3535A8');
    });

    it('shows the support address in the footer', () => {
      expect(rendered()).toContain('mailto:support@lucencare.test');
    });

    // Mirrors the app's own footer rather than inventing brand copy for the email.
    it('links the app footer routes off the brand URL', () => {
      expect(rendered()).toContain('href="https://app.lucencare.test/privacy-policy"');
      expect(rendered()).toContain('href="https://app.lucencare.test/terms"');
      expect(rendered()).toContain('href="https://app.lucencare.test/contact"');
    });

    // The tagline in logo-v3.svg reads well but appears nowhere in the product.
    it('does not invent a tagline the app never shows', () => {
      expect(rendered()).not.toContain('Healing with heart');
    });
  });

  describe('preheader', () => {
    it('hides it in the body and pads it so clients stop scraping', () => {
      const out = html({
        preheader: 'Your code expires in 5 minutes',
        blocks: [{ kind: 'paragraph', text: 'Hello,' }],
      });

      expect(out).toContain('Your code expires in 5 minutes');
      expect(out).toContain('display:none');
      expect(out).toContain('&#847;&zwnj;');
    });

    it('emits nothing when unset', () => {
      expect(html({ blocks: [{ kind: 'paragraph', text: 'Hello,' }] })).not.toContain(
        'display:none',
      );
    });
  });

  describe('escaping', () => {
    // Patient names, programme titles and admin-written rejection reasons all reach
    // these templates. In an HTML part an unescaped '<' is markup injection.
    it('escapes markup in body copy', () => {
      const out = html({
        blocks: [{ kind: 'paragraph', text: '<script>alert(1)</script>' }],
      });

      expect(out).not.toContain('<script>');
      expect(out).toContain('&lt;script&gt;');
    });

    it('escapes markup in the subject before putting it in the title', () => {
      const out = html({ blocks: [] }, '<b>Approved</b>');

      expect(out).toContain('<title>&lt;b&gt;Approved&lt;/b&gt;</title>');
    });

    it('escapes ampersands and quotes', () => {
      const out = html({ blocks: [{ kind: 'paragraph', text: 'Ada & "Grace"' }] });

      expect(out).toContain('Ada &amp; &quot;Grace&quot;');
    });

    it.each([
      ['heading', { kind: 'heading' as const, text: '<i>x</i>' }],
      ['callout', { kind: 'callout' as const, text: '<i>x</i>' }],
      ['signoff', { kind: 'signoff' as const, text: '<i>x</i>' }],
      ['list item', { kind: 'list' as const, items: ['<i>x</i>'] }],
      ['list lead', { kind: 'list' as const, lead: '<i>x</i>', items: ['ok'] }],
      ['code value', { kind: 'code' as const, value: '<i>x</i>' }],
      [
        'detail row value',
        { kind: 'detailRows' as const, rows: [{ label: 'L', value: '<i>x</i>' }] },
      ],
    ])('escapes markup in a %s', (_label, block) => {
      const out = html({ blocks: [block] });

      expect(out).not.toContain('<i>x</i>');
      expect(out).toContain('&lt;i&gt;x&lt;/i&gt;');
    });

    it('escapes a rejection reason, which is admin-written free text', () => {
      const out = html({
        blocks: [{ kind: 'paragraph', text: 'Reason: <img src=x onerror=alert(1)>' }],
      });

      // Not a bare '<img' check — the header logo is a legitimate <img> tag.
      expect(out).not.toContain('<img src=x');
      expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });
  });

  describe('button', () => {
    it('renders an anchor styled as a button', () => {
      const out = html({
        blocks: [{ kind: 'button', label: 'Sign in', url: 'https://app.lucencare.test/login' }],
      });

      expect(out).toContain('href="https://app.lucencare.test/login"');
      expect(out).toContain('>Sign in</a>');
    });

    // Email clients block these schemes anyway; rendering the label as text rather than
    // as a link means nothing silently disappears from the email either.
    it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'not-a-url'])(
      'refuses to emit an anchor for %s',
      (url) => {
        const out = html({ blocks: [{ kind: 'button', label: 'Sign in', url }] });

        // The label and URL still appear as inert escaped text — what must not exist
        // is an href carrying the scheme.
        expect(out).not.toMatch(/href="(?!https:\/\/|mailto:)/);
        expect(out).toContain('Sign in');
      },
    );
  });

  it('renders a two-line signoff with a line break rather than losing the newline', () => {
    const out = html({
      blocks: [{ kind: 'signoff', text: "You've got this,\nThe LucenCare Team" }],
    });

    expect(out).toContain('You&#39;ve got this,<br>The LucenCare Team');
  });

  it('renders a divider as a painted rule', () => {
    expect(html({ blocks: [{ kind: 'divider' }] })).toContain('background-color:#E6E9F0');
  });

  // Outlook renders through Word's HTML engine, which has neither.
  it('uses no flexbox or grid', () => {
    const out = html({
      blocks: [
        { kind: 'heading', text: 'H' },
        { kind: 'list', items: ['a'] },
        { kind: 'detailRows', rows: [{ label: 'L', value: 'V' }] },
        { kind: 'button', label: 'Go', url: 'https://x.test' },
        { kind: 'callout', text: 'C' },
      ],
    });

    expect(out).not.toMatch(/display:\s*(flex|grid)/);
  });

  it('delegates toText to the shared text renderer', () => {
    expect(
      service.toText({
        blocks: [
          { kind: 'paragraph', text: 'Hello,' },
          { kind: 'signoff', text: 'The LucenCare Team' },
        ],
      }),
    ).toBe('Hello,\n\nThe LucenCare Team');
  });
});
