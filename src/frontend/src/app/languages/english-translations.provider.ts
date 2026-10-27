import { inject, Provider } from '@angular/core';
import { TranslateService, TranslateStore } from '@ngx-translate/core';

// Only components opting into this provider use English independently of the
// app's browser/stored language. Reuse the existing English catalog and loader.
export const ENGLISH_TRANSLATIONS: Provider = {
  provide: TranslateService,
  useFactory: () => {
    const parent = inject(TranslateService, { skipSelf: true });
    const english = new TranslateService(
      new TranslateStore(), parent.currentLoader, parent.compiler, parent.parser,
      parent.missingTranslationHandler, true, true, false, '',
    );
    if (parent.translations['en']) english.setTranslation('en', parent.translations['en']);
    english.use('en');
    return english;
  },
};
