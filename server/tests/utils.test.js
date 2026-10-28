import { asMinutes, dateDay, localIsoDate, timeFromMinutes } from '../src/utils.js';

describe('appointment scheduling helpers', () => {
  test('translates scheduling times reliably', () => {
    expect(asMinutes('09:30')).toBe(570);
    expect(timeFromMinutes(570)).toBe('09:30');
  });
  test('uses local calendar day instead of UTC conversion', () => expect(dateDay('2030-01-07')).toBe('MONDAY'));
  test('formats local dates in the API date format', () => expect(localIsoDate(new Date(2030, 0, 7))).toBe('2030-01-07'));
});
