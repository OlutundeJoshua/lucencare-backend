import { formatLeadPhrase } from './lead-phrase.util';

describe('formatLeadPhrase', () => {
  it.each([
    [0, 'now'],
    [1, 'in 1 minute'],
    [30, 'in 30 minutes'],
    [59, 'in 59 minutes'],
    [60, 'in 1 hour'],
    [90, 'in 1 hour 30 minutes'],
    [120, 'in 2 hours'],
    [1439, 'in 23 hours 59 minutes'],
    [1440, 'tomorrow'],
    [1800, 'in 1 day 6 hours'],
    [2880, 'in 2 days'],
    [4320, 'in 3 days'],
  ])('renders %i minutes as %j', (minutes, expected) => {
    expect(formatLeadPhrase(minutes)).toBe(expected);
  });

  // The zero lead is the moment itself, not a lead — and a negative value should never
  // reach here, but must not produce "in -5 minutes" if it does.
  it.each([-1, -60])('treats %i as now rather than a negative duration', (minutes) => {
    expect(formatLeadPhrase(minutes)).toBe('now');
  });

  // The phrase must agree with the configured value, which is the whole reason it is
  // generated rather than written per lead.
  it('never claims an hour for a value that is not an hour', () => {
    expect(formatLeadPhrase(120)).not.toContain('1 hour');
    expect(formatLeadPhrase(120)).toBe('in 2 hours');
  });
});
