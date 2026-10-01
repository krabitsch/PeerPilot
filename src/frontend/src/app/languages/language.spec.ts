import { isSupportedLang, SUPPORTED_LANGS } from './language.service';

describe('isSupportedLang', () => {
  it('accepts every supported language code', () => {
    for (const lang of SUPPORTED_LANGS) {
      expect(isSupportedLang(lang)).toBe(true);
    }
  });

  it('rejects unknown codes and null', () => {
    expect(isSupportedLang('xx')).toBe(false);
    expect(isSupportedLang('')).toBe(false);
    expect(isSupportedLang(null)).toBe(false);
  });
});
