import { EmailContent } from 'src/common/interfaces/email-content.interface';

import { renderEmailText } from './email-text.util';

const render = (content: EmailContent) => renderEmailText(content);

describe('renderEmailText', () => {
  it('separates blocks with a blank line', () => {
    expect(
      render({
        blocks: [
          { kind: 'paragraph', text: 'Hello,' },
          { kind: 'paragraph', text: 'Goodbye.' },
        ],
      }),
    ).toBe('Hello,\n\nGoodbye.');
  });

  it('renders a heading as its own line of text', () => {
    expect(render({ blocks: [{ kind: 'heading', text: 'Welcome' }] })).toBe('Welcome');
  });

  it('omits the preheader — it is inbox chrome, not body copy', () => {
    const text = render({
      preheader: 'Snippet shown beside the subject',
      blocks: [{ kind: 'paragraph', text: 'Hello,' }],
    });

    expect(text).toBe('Hello,');
  });

  describe('list', () => {
    it('bullets each item', () => {
      expect(render({ blocks: [{ kind: 'list', items: ['One', 'Two'] }] })).toBe('- One\n- Two');
    });

    // The lead belongs to the bullets, so it sits directly above them rather than
    // being separated by a blank line the way two paragraphs would be.
    it('keeps a lead on the line directly above the bullets', () => {
      expect(
        render({ blocks: [{ kind: 'list', lead: 'You can now:', items: ['One', 'Two'] }] }),
      ).toBe('You can now:\n- One\n- Two');
    });
  });

  describe('detailRows', () => {
    it('renders bare label/value lines when there is no lead', () => {
      expect(
        render({
          blocks: [
            {
              kind: 'detailRows',
              rows: [
                { label: 'Email', value: 'ada@example.com' },
                { label: 'Temporary password', value: 'Kf7-2Qtx' },
              ],
            },
          ],
        }),
      ).toBe('Email: ada@example.com\nTemporary password: Kf7-2Qtx');
    });

    it('bullets the rows under a lead, since introduced rows read as a list', () => {
      expect(
        render({
          blocks: [
            {
              kind: 'detailRows',
              lead: 'Appointment details:',
              rows: [
                { label: 'Date', value: 'Tuesday' },
                { label: 'Time', value: '10:30' },
              ],
            },
          ],
        }),
      ).toBe('Appointment details:\n- Date: Tuesday\n- Time: 10:30');
    });
  });

  describe('code', () => {
    it('puts the value on its own line under the caption', () => {
      expect(
        render({
          blocks: [{ kind: 'code', value: '482913', caption: 'Your code is:' }],
        }),
      ).toBe('Your code is:\n482913');
    });

    it('renders the bare value when there is no caption', () => {
      expect(render({ blocks: [{ kind: 'code', value: '482913' }] })).toBe('482913');
    });
  });

  describe('button', () => {
    // The surrounding copy already introduces the link in this case, so a label would
    // duplicate it.
    it('renders the bare URL when there is no textLabel', () => {
      expect(
        render({ blocks: [{ kind: 'button', label: 'Reset', url: 'https://x.test/reset' }] }),
      ).toBe('https://x.test/reset');
    });

    it('prefixes the URL with textLabel when one is given', () => {
      expect(
        render({
          blocks: [
            {
              kind: 'button',
              label: 'View programmes',
              url: 'https://x.test/p',
              textLabel: 'View your programmes',
            },
          ],
        }),
      ).toBe('View your programmes: https://x.test/p');
    });

    it('never uses the short button label in the text part', () => {
      const text = render({
        blocks: [
          { kind: 'button', label: 'Sign in', url: 'https://x.test', textLabel: 'Sign in here' },
        ],
      });

      expect(text).toBe('Sign in here: https://x.test');
    });
  });

  it('renders a callout as ordinary copy — the emphasis is visual only', () => {
    expect(render({ blocks: [{ kind: 'callout', text: 'You are in.' }] })).toBe('You are in.');
  });

  it('preserves a two-line signoff without inserting a blank line', () => {
    expect(
      render({ blocks: [{ kind: 'signoff', text: "You've got this,\nThe LucenCare Team" }] }),
    ).toBe("You've got this,\nThe LucenCare Team");
  });

  // A rule drawn in text reads as a stray line of punctuation, and the join already
  // puts a blank line between the sections it was separating.
  it('drops a divider without leaving extra blank lines behind', () => {
    expect(
      render({
        blocks: [
          { kind: 'paragraph', text: 'Above.' },
          { kind: 'divider' },
          { kind: 'paragraph', text: 'Below.' },
        ],
      }),
    ).toBe('Above.\n\nBelow.');
  });

  it('leaves HTML metacharacters alone — the text part is not markup', () => {
    expect(render({ blocks: [{ kind: 'paragraph', text: 'Hi <Ada> & co' }] })).toBe(
      'Hi <Ada> & co',
    );
  });
});
