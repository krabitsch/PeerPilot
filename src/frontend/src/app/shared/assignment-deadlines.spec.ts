import { deadlineInput, deadlineIso, deadlineOrderError, deadlinePassed, formatDeadline } from './assignment-deadlines';
describe('optional assignment deadlines', () => {
  it('round-trips local inputs to UTC, including winter and summer dates', () => {
    for (const iso of ['2026-10-28T22:59:00.000Z','2026-07-01T21:59:00.000Z']) expect(deadlineIso(deadlineInput(iso))).toBe(iso);
    expect(deadlineInput(null)).toBe(''); expect(deadlineIso('')).toBeNull(); expect(deadlinePassed(null)).toBe(false);
  });
  it('validates only when both deadlines are present; allows equal/later', () => {
    for (const [s,e] of [['','2026-10-28T12:00'],['2026-10-28T12:00',''],['2026-10-28T12:00','2026-10-28T12:00'],['2026-10-28T12:00','2026-10-29T12:00']]) expect(deadlineOrderError(s,e)).toBeNull();
    expect(deadlineOrderError('2026-10-28T12:00','2026-10-27T12:00')).toContain('on or after');
  });
  it('formats English weekdays and local time under German browser language', () => {
    const spy=vi.spyOn(navigator,'language','get').mockReturnValue('de-DE');
    expect(formatDeadline(new Date(2026,9,28,23,59).toISOString())).toBe('Wednesday, 28.10.2026 at 23:59');
    spy.mockRestore();
  });
});
