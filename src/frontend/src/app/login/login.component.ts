import { Component, OnInit, inject, signal } from '@angular/core';
import { NgStyle } from '@angular/common';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../services/auth.service';
import { DS } from '../tokens';
import { LogoComponent } from '../shared/logo.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [NgStyle, LogoComponent, TranslateModule, RouterLink],
  template: `
    <div [ngStyle]="pageStyle">
      <div [ngStyle]="gridStyle"></div>
      <div [ngStyle]="glowStyle"></div>

      <div style="position:relative;width:100%;max-width:400px">
        <div style="margin-bottom:32px;display:flex;justify-content:center">
          <app-logo [size]="28"/>
        </div>

        <div [ngStyle]="cardStyle">
          @if (verifiedBanner()) {
            <div [ngStyle]="bannerStyle('green')">
              {{ 'login_verified_banner' | translate }}
            </div>
          }
          @if (notInvitedBanner()) {
            <div [ngStyle]="bannerStyle('red')">
              {{ 'login_not_invited_banner' | translate }}
            </div>
          }

          <h1 [ngStyle]="h1Style">{{ 'login_title' | translate }}</h1>
          <p [ngStyle]="subtitleStyle">{{ 'login_subtitle' | translate }}</p>

          <div style="display:flex;flex-direction:column;gap:14px">
            <div style="display:flex;flex-direction:column;gap:5px">
              <label [ngStyle]="labelStyle">{{ 'label_email' | translate }}</label>
              <input [value]="email()" (input)="email.set($any($event.target).value)"
                     [ngStyle]="inputStyle('email')"
                     (focus)="focused.set('email')" (blur)="focused.set('')"
                     placeholder="you@PeerPilot.school"/>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px">
              <label [ngStyle]="labelStyle">
                {{ 'label_password' | translate }}
              </label>
              <input type="password" [value]="password()"
                     (input)="password.set($any($event.target).value)"
                     [ngStyle]="inputStyle('pw')"
                     (focus)="focused.set('pw')" (blur)="focused.set('')"
                     placeholder="••••••••"/>
            </div>
            <!-- Sign in / Sign up — same shape, side by side -->
            <div style="display:flex;gap:8px">
              <button (click)="login()" [ngStyle]="authBtnStyle('signin')"
                      (mouseenter)="authHover.set('signin')" (mouseleave)="authHover.set('')"
                      [disabled]="submitting()">
                {{ (submitting() ? 'btn_signing_in' : 'btn_sign_in') | translate }}
              </button>
              <button (click)="router.navigate(['/register'])" [ngStyle]="authBtnStyle('signup')"
                      (mouseenter)="authHover.set('signup')" (mouseleave)="authHover.set('')">
                {{ 'btn_sign_up' | translate }}
              </button>
            </div>

          </div>

          @if (errorMsg()) {
            <p [ngStyle]="feedbackStyle('error')">{{ errorMsg() }}</p>
          }

        </div>

        <div [ngStyle]="legalLinksStyle">
          <a routerLink="/privacy-policy" [ngStyle]="legalLinkStyle">{{ 'privacy_title' | translate }}</a>
          <span [ngStyle]="legalLinkStyle">·</span>
          <a routerLink="/terms-of-service" [ngStyle]="legalLinkStyle">{{ 'terms_title' | translate }}</a>
        </div>
      </div>
    </div>
  `,
})
export class LoginComponent implements OnInit {
  router   = inject(Router);
  private auth      = inject(AuthService);
  private route     = inject(ActivatedRoute);
  private translate = inject(TranslateService);

  email    = signal('');
  password = signal('');
  focused  = signal('');
  errorMsg = signal('');
  submitting      = signal(false);
  verifiedBanner  = signal(false);
  notInvitedBanner = signal(false);

  ngOnInit() {
    const params = this.route.snapshot.queryParams;
    if (params['verified'] === 'true')   this.verifiedBanner.set(true);
    if (params['error']    === 'not_invited') this.notInvitedBanner.set(true);
  }

  login() {
    this.errorMsg.set('');

    if (!this.email() || !this.password()) {
      this.errorMsg.set(this.translate.instant('error_email_password_required'));
      return;
    }

    this.submitting.set(true);
    this.auth.login(this.email(), this.password()).subscribe({
      next: () => {
        this.auth.getMe().subscribe({
          next: (user: any) => {
            this.submitting.set(false);
            const dest = (user?.role === 'Admin' || user?.role === 'Bocal') ? '/bocal' : '/dashboard';
            this.router.navigate([dest]);
          },
          error: () => {
            this.submitting.set(false);
            this.errorMsg.set(this.translate.instant('error_login_user_data_failed'));
          }
        });
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorMsg.set(err.error?.error || this.translate.instant('error_login_failed'));
      }
    });
  }

  authHover  = signal('');

  authBtnStyle(btn: 'signin' | 'signup') {
    const h = this.authHover() === btn;
    const base = {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flex: '1', padding: '11px 16px', borderRadius: '8px', cursor: 'pointer',
      fontSize: '0.9375rem', fontFamily: DS.fonts.body, fontWeight: '500',
      transition: 'background 150ms, border-color 150ms', outline: 'none',
    };
    if (btn === 'signin') {
      return {
        ...base,
        background: h ? DS.colors.violetDim : DS.colors.violet,
        color: '#fff',
        border: 'none',
      };
    }
    return {
      ...base,
      background: h ? DS.colors.surfaceRaised : DS.colors.surface,
      color: DS.colors.fg1,
      border: `1px solid ${DS.colors.border}`,
    };
  }

  readonly pageStyle = {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '24px', background: DS.colors.bg, position: 'relative', overflow: 'hidden',
  };
  readonly gridStyle = {
    position: 'absolute', inset: '0',
    backgroundImage: `linear-gradient(${DS.colors.border} 1px, transparent 1px), linear-gradient(90deg, ${DS.colors.border} 1px, transparent 1px)`,
    backgroundSize: '48px 48px', opacity: '0.25',
  };
  readonly glowStyle = {
    position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)',
    width: '500px', height: '500px',
    background: 'radial-gradient(circle, oklch(64% 0.28 296 / 0.08) 0%, transparent 70%)',
    pointerEvents: 'none',
  };
  readonly cardStyle = {
    background: DS.colors.surface, border: `1px solid ${DS.colors.border}`,
    borderRadius: '16px', padding: '28px', boxShadow: '0 8px 32px oklch(0% 0 0 / 0.6)',
    display: 'flex', flexDirection: 'column', gap: '0',
  };
  readonly h1Style = {
    fontFamily: DS.fonts.display, fontSize: '1.375rem', fontWeight: '700',
    color: DS.colors.fg1, marginBottom: '4px', marginTop: '8px',
  };
  readonly subtitleStyle = { fontSize: '0.875rem', color: DS.colors.fg2, marginBottom: '20px' };
  readonly labelStyle = {
    fontSize: '0.8125rem', fontWeight: '500', color: DS.colors.fg2,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  };
  readonly legalLinksStyle = {
    display: 'flex', justifyContent: 'center', gap: '8px',
    marginTop: '20px', fontSize: '0.75rem',
  };
  readonly legalLinkStyle = { color: DS.colors.fg3, textDecoration: 'none' };

  bannerStyle(color: 'green' | 'red') {
    const c = color === 'green'
      ? { bg: DS.colors.greenSubtle, border: DS.colors.greenBorder, text: DS.colors.green }
      : { bg: DS.colors.redSubtle,   border: DS.colors.redBorder,   text: DS.colors.red   };
    return {
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      borderRadius: '8px', padding: '10px 14px', fontSize: '0.8125rem',
      marginBottom: '16px',
    };
  }

  feedbackStyle(type: 'error') {
    return { fontSize: '0.75rem', color: DS.colors.red, textAlign: 'center', marginTop: '12px' };
  }

  inputStyle(id: string) {
    const f = this.focused() === id;
    return {
      background: DS.colors.surface, color: DS.colors.fg1,
      border: `1px solid ${f ? DS.colors.violet : DS.colors.border}`,
      borderRadius: '8px', padding: '10px 14px', fontSize: '0.9375rem',
      fontFamily: DS.fonts.body, outline: 'none',
      boxShadow: f ? '0 0 0 3px oklch(64% 0.28 296 / 0.15)' : 'none',
      transition: 'border-color 150ms, box-shadow 150ms', width: '100%',
    };
  }
}