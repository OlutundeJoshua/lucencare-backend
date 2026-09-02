/**
 * One unit of content in a transactional email.
 *
 * Emails are described as a list of these rather than as a string so that a single
 * declaration renders to BOTH parts of the multipart/alternative message —
 * `EmailRendererService.toHtml()` for clients that show it, `toText()` for those that
 * do not (and for screen readers, watch notifications and spam scoring). Writing the
 * copy once is the point: a hand-written HTML template alongside a hand-written text
 * body drifts apart the first time someone edits only one of them.
 *
 * Lives in `common/` because both `modules/mail/` (which renders these) and
 * `queues/processors/` (which build them) import it — see CLAUDE.md §4.4.
 */
export type EmailBlock =
  /** Optional title line inside the card. Most emails lead with a greeting instead. */
  | { kind: 'heading'; text: string }
  /** Body copy. Rendered as a single paragraph — put a blank line between thoughts by using two blocks. */
  | { kind: 'paragraph'; text: string }
  /**
   * A bulleted list. `lead` is the line introducing it ("You can now:") and is kept
   * tight against the bullets — in the text part it sits on the line directly above
   * them with no blank line, matching how these emails have always read.
   */
  | { kind: 'list'; items: string[]; lead?: string }
  /**
   * Label/value pairs — appointment details, account credentials. In the text part a
   * `lead` also switches the rows to bullets, since a list that has been introduced
   * reads as a list, while a bare pair of lines (Email / Temporary password) does not.
   */
  | { kind: 'detailRows'; rows: { label: string; value: string }[]; lead?: string }
  /** A value the reader has to read off and use: an OTP, a temporary password. */
  | { kind: 'code'; value: string; caption?: string }
  /**
   * A call to action. `label` is the short text on the button; `textLabel` is the
   * sentence that introduces the bare URL in the text part ("View your programmes"),
   * omitted where the surrounding copy already introduces the link itself.
   */
  | { kind: 'button'; label: string; url: string; textLabel?: string }
  /** Emphasised copy — the one line the email exists to deliver, or a rejection reason. */
  | { kind: 'callout'; text: string }
  /** The closing line. Styled as chrome rather than body copy, but still real copy. */
  | { kind: 'signoff'; text: string }
  /** A horizontal rule between sections. Renders as a blank line in the text part. */
  | { kind: 'divider' };
