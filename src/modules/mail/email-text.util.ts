import { EmailBlock } from 'src/common/interfaces/email-block.type';
import { EmailContent } from 'src/common/interfaces/email-content.interface';

/**
 * Renders the plain-text part of an email.
 *
 * A standalone function rather than a method on `EmailRendererService` because it needs
 * none of the branding config the HTML part does — which means MailService, the preview
 * script and the processor specs can all render text without standing up a
 * ConfigService just to reach it.
 *
 * The text part is not a fallback to be tolerated: it is what text-only clients, screen
 * readers and watch notifications show, and its absence is a meaningful spam signal.
 */
export function renderEmailText(content: EmailContent): string {
  return content.blocks
    .map((block) => blockText(block))
    .filter((section): section is string => section !== null)
    .join('\n\n');
}

/** `null` means the block contributes nothing to the text part and is dropped. */
function blockText(block: EmailBlock): string | null {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
    case 'callout':
    case 'signoff':
      return block.text;

    case 'list':
      return [...(block.lead ? [block.lead] : []), ...block.items.map((i) => `- ${i}`)].join('\n');

    case 'detailRows':
      // A `lead` means these rows were introduced as a list, so they read as one;
      // without it they are standalone pairs (Email / Temporary password) and bullets
      // would be noise.
      return [
        ...(block.lead ? [block.lead] : []),
        ...block.rows.map((row) => `${block.lead ? '- ' : ''}${row.label}: ${row.value}`),
      ].join('\n');

    case 'code':
      return block.caption ? `${block.caption}\n${block.value}` : block.value;

    case 'button':
      // Where the surrounding copy already introduces the link, the bare URL is all
      // that is needed; otherwise the label carries it.
      return block.textLabel ? `${block.textLabel}: ${block.url}` : block.url;

    case 'divider':
      // Dropped rather than rendered: the join already puts a blank line between
      // sections, and a text rule would read as a stray line of punctuation.
      return null;
  }
}
