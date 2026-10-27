import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap, tap } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { LogoComponent } from '../shared/logo.component';

@Component({
  selector: 'app-reset-password', standalone: true,
  imports: [FormsModule, RouterLink, LogoComponent],
  styleUrl: './password-recovery.css',
  template: `
    <div class="recovery">
      <div class="logo"><app-logo /></div>
      <section class="card">
        @if (success()) {
          <h1>Password changed</h1>
          <p role="status">Your password has been changed. Please sign in with your new password.</p>
          <a routerLink="/login">Back to sign in</a>
        } @else if (checking()) {
          <p role="status">Checking password reset link…</p>
        } @else if (!valid()) {
          <h1>Password reset</h1>
          <p role="alert">This password reset link is invalid or has expired.</p>
          <a routerLink="/forgot-password">Please request a new password reset link.</a>
        } @else {
          <h1>Choose a new password</h1>
          <form (ngSubmit)="submit()">
            <label for="new-password">New password</label>
            <input id="new-password" name="password" type="password" autocomplete="new-password" required
              [ngModel]="password()" (ngModelChange)="password.set($event)" />
            <label for="confirm-password">Confirm new password</label>
            <input id="confirm-password" name="confirmation" type="password" autocomplete="new-password" required
              [ngModel]="confirmation()" (ngModelChange)="confirmation.set($event)" />
            <button type="submit" [disabled]="submitting()">Set new password</button>
          </form>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
          <p><a routerLink="/login">Back to sign in</a></p>
        }
      </section>
    </div>
  `,
})
export class ResetPasswordComponent {
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private token = '';
  valid = signal(false);
  checking = signal(true);
  success = signal(false);
  submitting = signal(false);
  password = signal('');
  confirmation = signal('');
  error = signal('');
  constructor() {
    this.route.queryParamMap.pipe(
      tap(params => {
        this.token = params.get('token') || '';
        this.valid.set(false); this.checking.set(true); this.success.set(false);
        this.password.set(''); this.confirmation.set(''); this.error.set('');
      }),
      switchMap(() => this.token ? this.auth.validatePasswordReset(this.token).pipe(catchError(() => of(null))) : of(null)),
      takeUntilDestroyed(),
    ).subscribe(result => { this.valid.set(result?.valid === true); this.checking.set(false); });
  }
  submit() {
    if (!this.valid() || this.submitting()) return;
    this.error.set('');
    if (!this.password()) { this.error.set('Enter a new password.'); return; }
    if (this.password() !== this.confirmation()) { this.error.set('Passwords do not match.'); return; }
    this.submitting.set(true);
    const submittedToken = this.token;
    this.auth.resetPassword(this.token, this.password()).subscribe({
      next: () => {
        this.submitting.set(false);
        if (submittedToken !== this.token) return;
        this.success.set(true); this.valid.set(false); this.password.set(''); this.confirmation.set('');
      },
      error: err => {
        this.submitting.set(false);
        if (submittedToken !== this.token) return;
        if (Array.isArray(err.error?.suggestions)) {
          this.error.set('Password is too weak. Use a longer password or passphrase and avoid common passwords and predictable patterns.');
        } else if (err.status === 400) this.valid.set(false);
        else this.error.set('Your password could not be changed. Please try again.');
      },
    });
  }
}
