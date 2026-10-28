import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { initLanguage } from '../app.config';
import { setLanguage } from './language.service';
import { LanguageSwitcherComponent } from './language-switcher.component';
import en from './en.json';
import de from './de.json';
describe('global English-only startup',()=>{
  let previous:string|null;
  beforeEach(()=>{
    previous=localStorage.getItem('language');localStorage.setItem('language','de');
    vi.spyOn(navigator,'language','get').mockReturnValue('de-DE');
    vi.spyOn(navigator,'languages','get').mockReturnValue(['de-DE']);
    TestBed.configureTestingModule({imports:[TranslateModule.forRoot()]});
    const t=TestBed.inject(TranslateService);t.setTranslation('en',en);t.setTranslation('de',de);t.use('de');
  });
  afterEach(()=>{vi.restoreAllMocks();if(previous===null)localStorage.removeItem('language');else localStorage.setItem('language',previous);});
  it('overrides browser German, persisted German and previous direction; cannot switch back',async()=>{
    const t=TestBed.inject(TranslateService);document.documentElement.dir='rtl';await initLanguage(t)();
    expect(t.currentLang).toBe('en');expect(localStorage.getItem('language')).toBe('en');
    expect(document.documentElement.lang).toBe('en');expect(document.documentElement.dir).toBe('ltr');
    setLanguage(t,'de' as any);expect(t.currentLang).toBe('en');
    const selector=TestBed.createComponent(LanguageSwitcherComponent).componentInstance;
    selector.switchLanguage('de');expect(t.currentLang).toBe('en');expect(selector.currentLanguage).toBe('en');
    for(const key of ['eval_written_feedback','breadcrumb_evaluate_submission','btn_submit_eval']) expect(t.instant(key)).toBe((en as any)[key]??key);
    expect(t.instant('eval_written_feedback')).toBe('Written feedback');
  });
});
