import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { LogoComponent } from '../shared/logo.component';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [FormsModule, RouterLink, LogoComponent],
  styleUrl: './password-recovery.css',
  template: `
    <div class="recovery">
      <div class="logo"><app-logo /></div>
      <section class="card">
        <h1>Forgot password?</h1>
        @if (sent()) {
          <p role="status">If an account exists for that email address, a password reset link has been sent.</p>
        } @else {
          <form (ngSubmit)="submit()">
            <label for="reset-email">Email</label>
            <input id="reset-email" name="email" type="email" autocomplete="email" required maxlength="255"
              [ngModel]="email()" (ngModelChange)="email.set($event)" />
            <button type="submit" [disabled]="submitting()">Send password reset link</button>
          </form>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        }
        <p><a routerLink="/login">Back to sign in</a></p>
      </section>
    </div>
  `,
})
export class ForgotPasswordComponent {
  private auth = inject(AuthService);
  email = signal('');
  sent = signal(false);
  submitting = signal(false);
  error = signal('');
  submit() {
    if (this.submitting()) return;
    const email = this.email().trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      this.error.set('Enter a valid email address.'); return;
    }
    this.error.set(''); this.submitting.set(true);
    this.auth.forgotPassword(email).subscribe({
      next: () => { this.sent.set(true); this.submitting.set(false); },
      // A network failure should not falsely claim delivery. This message is
      // independent of account existence; server delivery failures stay generic.
      error: () => { this.submitting.set(false); this.error.set('Unable to submit your request. Please try again.'); },
    });
  }
}
