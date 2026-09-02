import { EmailBlock } from './email-block.type';

/**
 * A complete transactional email body, independent of how it is rendered.
 * Passed to `MailService.send()`, which renders both the HTML and text parts from it.
 */
export interface EmailContent {
  /**
   * The grey snippet inbox clients show beside the subject line. HTML-only — it is
   * inbox chrome rather than body copy, and in the text part the opening line already
   * serves the same purpose. Left unset, clients scrape the first words of the body,
   * which for a branded header is often nothing useful.
   */
  preheader?: string;

  blocks: EmailBlock[];
}
