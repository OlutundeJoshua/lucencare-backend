import { parseLeadSchedule } from './reminders.config';

const RULES = { name: 'TEST_LEADS', windowMinutes: 5, maxMinutes: 1439 };
const FALLBACK = [30, 0];

describe('parseLeadSchedule', () => {
  beforeEach(() => {
    // The rejection path logs at error level by design; keep the suite output readable.
    jest.spyOn(require('@nestjs/common').Logger.prototype, 'error').mockImplementation();
    jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('falls back to the default schedule when unset', () => {
    expect(parseLeadSchedule(undefined, FALLBACK, RULES)).toEqual([30, 0]);
  });

  // Unset and explicitly-empty must mean different things, or turning reminders off is
  // indistinguishable from forgetting to set the variable.
  it('treats an explicitly empty value as every reminder disabled', () => {
    expect(parseLeadSchedule('', FALLBACK, RULES)).toEqual([]);
    expect(parseLeadSchedule('   ', FALLBACK, RULES)).toEqual([]);
  });

  it('parses a list of minutes', () => {
    expect(parseLeadSchedule('120,30,0', FALLBACK, RULES)).toEqual([120, 30, 0]);
  });

  it('tolerates whitespace around entries', () => {
    expect(parseLeadSchedule(' 120 , 30 , 0 ', FALLBACK, RULES)).toEqual([120, 30, 0]);
  });

  it('sorts furthest-first regardless of the order written', () => {
    expect(parseLeadSchedule('0,120,30', FALLBACK, RULES)).toEqual([120, 30, 0]);
  });

  it('accepts a single lead', () => {
    expect(parseLeadSchedule('0', FALLBACK, RULES)).toEqual([0]);
  });

  describe('rejects and falls back', () => {
    // Number('6O') is NaN and Number('') is 0 — a schedule that quietly reinterprets a
    // typo is how a reminder goes missing for weeks.
    it.each(['1440,6O,0', '1440,,0', '30.5,0', '-30,0', 'abc', '1440;60;0'])(
      'refuses %j',
      (raw) => {
        expect(parseLeadSchedule(raw, FALLBACK, RULES)).toEqual([30, 0]);
      },
    );

    it('refuses a repeated lead, which would send the same email twice', () => {
      expect(parseLeadSchedule('30,30,0', FALLBACK, RULES)).toEqual([30, 0]);
    });

    it('refuses a lead beyond the maximum', () => {
      expect(parseLeadSchedule('1440,0', FALLBACK, RULES)).toEqual([30, 0]);
    });

    // Two leads inside one window are both matched by a single tick, so the patient
    // gets two copies of the same reminder at once.
    it('refuses two leads closer together than the tick window', () => {
      expect(parseLeadSchedule('35,32,0', FALLBACK, RULES)).toEqual([30, 0]);
    });

    it('refuses leads exactly one window apart, since the window is half-open', () => {
      expect(parseLeadSchedule('35,30,0', FALLBACK, RULES)).toEqual([30, 0]);
    });

    it('accepts leads just over one window apart', () => {
      expect(parseLeadSchedule('36,30,0', FALLBACK, RULES)).toEqual([36, 30, 0]);
    });
  });

  it('names the offending variable and value in the log', () => {
    const error = jest
      .spyOn(require('@nestjs/common').Logger.prototype, 'error')
      .mockImplementation();

    parseLeadSchedule('1440,6O,0', FALLBACK, RULES);

    expect(error).toHaveBeenCalledWith(expect.stringContaining('TEST_LEADS'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('6O'));
  });
});
