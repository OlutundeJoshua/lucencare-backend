import {
  addDaysToIsoDate,
  formatMinutesAsLabel,
  minutesUntilNextDailyOccurrence,
  parseTimeLabel,
} from './time-label.util';

describe('formatMinutesAsLabel', () => {
  it.each([
    [0, '12:00 AM'],
    [10, '12:10 AM'],
    [555, '9:15 AM'],
    [720, '12:00 PM'],
    [1290, '9:30 PM'],
    [1439, '11:59 PM'],
  ])('renders %i as %s', (minutes, expected) => {
    expect(formatMinutesAsLabel(minutes)).toBe(expected);
  });

  it('round-trips through parseTimeLabel', () => {
    for (const minutes of [0, 1, 61, 555, 719, 720, 721, 1439]) {
      expect(parseTimeLabel(formatMinutesAsLabel(minutes))?.minutes).toBe(minutes);
    }
  });
});

describe('addDaysToIsoDate', () => {
  it('advances a date', () => {
    expect(addDaysToIsoDate('2026-07-17', 1)).toBe('2026-07-18');
  });

  it('rolls over a month boundary', () => {
    expect(addDaysToIsoDate('2026-07-31', 1)).toBe('2026-08-01');
  });

  it('rolls over a year boundary', () => {
    expect(addDaysToIsoDate('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('minutesUntilNextDailyOccurrence', () => {
  // 2026-07-17 is a Friday.
  const at = (minutes: number) => ({ dateIso: '2026-07-17', minutes });

  it('counts forward to a dose later today', () => {
    expect(minutesUntilNextDailyOccurrence({ minutes: 555 }, at(540))).toEqual({
      minutesUntil: 15,
      dateIso: '2026-07-17',
    });
  });

  it("returns zero at the dose's own moment", () => {
    expect(minutesUntilNextDailyOccurrence({ minutes: 555 }, at(555))?.minutesUntil).toBe(0);
  });

  // The case the 30-minute lead depends on: at 23:40 a 12:10 AM dose is half an hour
  // away, and it belongs to tomorrow.
  it('wraps past midnight to tomorrow', () => {
    expect(minutesUntilNextDailyOccurrence({ minutes: 10 }, at(1420))).toEqual({
      minutesUntil: 30,
      dateIso: '2026-07-18',
    });
  });

  it('treats a dose that has just passed as nearly a day away, matching no lead', () => {
    expect(minutesUntilNextDailyOccurrence({ minutes: 550 }, at(555))?.minutesUntil).toBe(1435);
  });

  describe('weekday-scoped labels', () => {
    it('accepts a label naming today', () => {
      expect(minutesUntilNextDailyOccurrence({ minutes: 555, weekday: 'Friday' }, at(540))).toEqual(
        { minutesUntil: 15, dateIso: '2026-07-17' },
      );
    });

    it('rejects a label naming another day', () => {
      expect(
        minutesUntilNextDailyOccurrence({ minutes: 555, weekday: 'Monday' }, at(540)),
      ).toBeUndefined();
    });

    // The subtle one: a wrapped occurrence must be tested against the day it lands on,
    // not against today, or every weekly dose just after midnight loses its reminder.
    it('tests a wrapped occurrence against tomorrow', () => {
      expect(
        minutesUntilNextDailyOccurrence({ minutes: 10, weekday: 'Saturday' }, at(1420)),
      ).toEqual({ minutesUntil: 30, dateIso: '2026-07-18' });
    });

    it('rejects a wrapped occurrence naming today', () => {
      expect(
        minutesUntilNextDailyOccurrence({ minutes: 10, weekday: 'Friday' }, at(1420)),
      ).toBeUndefined();
    });
  });
});
