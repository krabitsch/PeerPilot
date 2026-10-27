import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { LoginComponent } from '../login/login.component';
import { RegisterComponent } from '../register/register.component';
import { SidebarComponent } from '../shared/sidebar.component';
import { ForgotPasswordComponent } from '../password-recovery/forgot-password.component';
import { ResetPasswordComponent } from '../password-recovery/reset-password.component';
import { LanguageSwitcherComponent } from './language-switcher.component';
import { AuthService } from '../services/auth.service';

const en = {
  login_title: 'Sign in', login_subtitle: 'Your peer-to-peer learning platform.',
  label_email: 'Email', label_password: 'Password', btn_sign_in: 'Sign in', btn_sign_up: 'Register',
  privacy_title: 'Privacy Policy', terms_title: 'Terms of Use', register_title: 'Create account',
  label_confirm_password: 'Confirm password', error_passwords_mismatch: 'Passwords do not match.',
  label_admin: 'Admin', label_dashboard: 'Dashboard', tab_classes: 'Courses', label_assignments: 'Assignments',
  tab_students: 'Students', tab_analytics: 'Analytics', label_evaluator_tasks: 'Evaluator tasks',
  label_language: 'Language', btn_sign_out: 'Sign out',
};
const de = Object.fromEntries(Object.keys(en).map(key => [key, `Deutsch:${key}`]));

describe('English-only auth and sidebar under a German browser/stored locale', () => {
  let storedLanguage: string | null;
  beforeEach(() => {
    storedLanguage = localStorage.getItem('language'); localStorage.setItem('language', 'de');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE']);
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), LoginComponent, RegisterComponent, SidebarComponent,
        ForgotPasswordComponent, ResetPasswordComponent],
      providers: [provideRouter([]),
        {provide: ActivatedRoute, useValue: {snapshot: {queryParams: {}}, queryParamMap: of(convertToParamMap({token: 'valid'}))}},
        {provide: AuthService, useValue: {
          user: signal({id: 1, role: 'Admin', username: 'admin'}), logout: vi.fn(),
          validateInvitation: () => of({email: 'student@example.com'}), validatePasswordReset: () => of({valid: true}),
        }},
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', en); translate.setTranslation('de', de); translate.use('de');
  });
  afterEach(() => {
    if (storedLanguage === null) localStorage.removeItem('language'); else localStorage.setItem('language', storedLanguage);
    vi.restoreAllMocks();
  });
  it('renders sign-in and legal navigation in English without changing the global language', () => {
    const fixture = TestBed.createComponent(LoginComponent); fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    for (const label of ['Sign in', 'Email', 'Password', 'Register', 'Forgot password?', 'Privacy Policy', 'Terms of Use']) expect(text).toContain(label);
    expect(text).not.toContain('Deutsch:');
    expect(TestBed.inject(TranslateService).currentLang).toBe('de');
    expect(localStorage.getItem('language')).toBe('de');
  });
  it('keeps invitation labels and password feedback English', () => {
    const fixture = TestBed.createComponent(RegisterComponent), c = fixture.componentInstance;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Create account');
    expect(fixture.nativeElement.textContent).toContain('Confirm password');
    expect(fixture.nativeElement.textContent).not.toContain('Deutsch:');
    c.password.set('one'); c.confirmPassword.set('two'); c.submit();
    expect(c.errorMsg()).toBe('Passwords do not match.');
  });
  it('renders Admin hierarchy and language controls in English and preserves every destination', () => {
    const fixture = TestBed.createComponent(SidebarComponent); fixture.detectChanges();
    const links = [...fixture.nativeElement.querySelectorAll('a[href]')] as HTMLAnchorElement[];
    expect(links.map(a => a.textContent!.trim())).toEqual([
      'Admin', 'Dashboard', 'Courses', 'Assignments', 'Students', 'Analytics', 'Evaluator tasks',
    ]);
    expect(links.map(a => a.getAttribute('href'))).toEqual([
      '/admin/orgs', '/bocal/dashboard', '/bocal/classes', '/bocal/classes?view=assignments',
      '/bocal/students', '/bocal/analytics', '/evaluation',
    ]);
    for (const label of ['Sign out', 'Language', 'English']) expect(fixture.nativeElement.textContent).toContain(label);
    expect(fixture.nativeElement.textContent).not.toContain('Deutsch:');
    const child = fixture.debugElement.query(node => node.componentInstance instanceof LanguageSwitcherComponent).componentInstance as LanguageSwitcherComponent;
    child.switchLanguage('de'); fixture.detectChanges(); expect(child.currentLanguage).toBe('en');
    TestBed.inject(TranslateService).use('de'); fixture.detectChanges();
    expect(links[0].textContent).toContain('Admin');
    expect(fixture.nativeElement.querySelectorAll('[role=separator]').length).toBe(2);
  });
  it('keeps the already-English forgot/reset pages English', () => {
    const forgot = TestBed.createComponent(ForgotPasswordComponent); forgot.detectChanges();
    expect(forgot.nativeElement.textContent).toContain('Forgot password?');
    expect(forgot.nativeElement.textContent).toContain('Back to sign in');
    const reset = TestBed.createComponent(ResetPasswordComponent); reset.detectChanges();
    expect(reset.nativeElement.textContent).toContain('Choose a new password');
    expect(reset.nativeElement.textContent).toContain('Confirm new password');
  });
});
