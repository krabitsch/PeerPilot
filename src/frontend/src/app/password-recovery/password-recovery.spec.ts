import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ForgotPasswordComponent } from './forgot-password.component';
import { ResetPasswordComponent } from './reset-password.component';

describe('password recovery', () => {
  const forgotPassword = vi.fn(), validatePasswordReset = vi.fn(), resetPassword = vi.fn();
  let query: Subject<ReturnType<typeof convertToParamMap>>;
  beforeEach(() => {
    forgotPassword.mockReset().mockReturnValue(of({message: 'generic'}));
    validatePasswordReset.mockReset().mockReturnValue(of({valid: true}));
    resetPassword.mockReset().mockReturnValue(of({message: 'changed'}));
    query = new Subject();
    TestBed.configureTestingModule({
      imports: [ForgotPasswordComponent, ResetPasswordComponent],
      providers: [provideRouter([]), {provide: AuthService, useValue: {forgotPassword, validatePasswordReset, resetPassword}},
        {provide: ActivatedRoute, useValue: {queryParamMap: query.asObservable()}},
      ],
    });
  });
  it('normalizes an email and shows the generic message with no account details', () => {
    const fixture = TestBed.createComponent(ForgotPasswordComponent), c = fixture.componentInstance;
    c.email.set(' STUDENT@EXAMPLE.COM '); c.submit(); fixture.detectChanges();
    expect(forgotPassword).toHaveBeenCalledWith('student@example.com');
    expect(fixture.nativeElement.textContent).toContain('If an account exists for that email address, a password reset link has been sent.');
    expect(fixture.nativeElement.textContent).not.toContain('student@example.com');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });
  it('blocks malformed email and reports a generic network failure without account details', () => {
    const c = TestBed.createComponent(ForgotPasswordComponent).componentInstance;
    c.email.set('bad'); c.submit(); expect(forgotPassword).not.toHaveBeenCalled();
    forgotPassword.mockReturnValue(throwError(() => ({status: 0, error: 'internal'})));
    c.email.set('student@example.com'); c.submit();
    expect(c.error()).toBe('Unable to submit your request. Please try again.');
    expect(c.sent()).toBe(false);
  });
  it('does not display a password form for missing or rejected tokens', () => {
    const fixture = TestBed.createComponent(ResetPasswordComponent), c = fixture.componentInstance;
    query.next(convertToParamMap({})); fixture.detectChanges();
    expect(validatePasswordReset).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('invalid or has expired');
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    validatePasswordReset.mockReturnValue(throwError(() => ({status: 400})));
    query.next(convertToParamMap({token: 'bad'})); fixture.detectChanges();
    expect(c.valid()).toBe(false); expect(fixture.nativeElement.querySelector('input')).toBeNull();
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe('/forgot-password');
  });
  it('requires matching passwords, submits only token and password, then links to sign in', () => {
    const fixture = TestBed.createComponent(ResetPasswordComponent), c = fixture.componentInstance;
    query.next(convertToParamMap({token: 'secret'})); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type=email]')).toBeNull();
    c.password.set('long strong passphrase'); c.confirmation.set('different'); c.submit();
    expect(resetPassword).not.toHaveBeenCalled(); expect(c.error()).toContain('do not match');
    c.confirmation.set(c.password()); c.submit(); fixture.detectChanges();
    expect(resetPassword).toHaveBeenCalledWith('secret', 'long strong passphrase');
    expect(c.success()).toBe(true); expect(c.password()).toBe('');
    expect(fixture.nativeElement.textContent).toContain('Password changed');
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe('/login');
  });
  it('keeps weak-password feedback safe and returns to invalid-link state on consumed token', () => {
    const fixture = TestBed.createComponent(ResetPasswordComponent), c = fixture.componentInstance;
    query.next(convertToParamMap({token: 'secret'}));
    c.password.set('weak'); c.confirmation.set('weak');
    resetPassword.mockReturnValue(throwError(() => ({status: 400, error: {suggestions: ['internal suggestion']}})));
    c.submit(); expect(c.error()).toContain('too weak'); expect(c.error()).not.toContain('internal'); expect(c.valid()).toBe(true);
    resetPassword.mockReturnValue(throwError(() => ({status: 400, error: {}})));
    c.submit(); fixture.detectChanges(); expect(c.valid()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('invalid or has expired');
  });
  it('ignores a stale validation result when the URL token changes', () => {
    const old = new Subject<{valid: boolean}>();
    validatePasswordReset.mockReturnValueOnce(old).mockReturnValueOnce(throwError(() => ({status: 400})));
    const c = TestBed.createComponent(ResetPasswordComponent).componentInstance;
    query.next(convertToParamMap({token: 'old'})); query.next(convertToParamMap({token: 'new'}));
    old.next({valid: true}); expect(c.valid()).toBe(false);
  });
});
