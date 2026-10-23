import {TestBed} from '@angular/core/testing';
import {Router} from '@angular/router';
import {TranslateModule, TranslateService} from '@ngx-translate/core';
import {of, throwError} from 'rxjs';
import {RegisterComponent} from './register.component';
import {AuthService} from '../services/auth.service';

describe('registration password feedback',()=>{
  const register=vi.fn();
  beforeEach(()=>{
    register.mockReset();
    TestBed.configureTestingModule({imports:[RegisterComponent,TranslateModule.forRoot()],providers:[
      {provide:AuthService,useValue:{register}}, {provide:Router,useValue:{navigate:vi.fn()}},
    ]});
    TestBed.inject(TranslateService).setTranslation('en',{error_password_weak:'Password is too weak.'});
    TestBed.inject(TranslateService).use('en');
  });
  function page(password:string){
    const fixture=TestBed.createComponent(RegisterComponent),c=fixture.componentInstance;
    c.email.set('student@example.com');c.password.set(password);c.confirmPassword.set(password);
    return {fixture,c};
  }
  for(const [password,hint] of [
    ['abc','Use a longer password or passphrase.'],
    ['passwordpassword','Avoid common passwords and predictable patterns.'],
  ]) it(`shows curated feedback for a rejected ${password.length<12?'short':'predictable'} password`,()=>{
    register.mockReturnValue(throwError(()=>({status:400,error:{suggestions:[
      'Add another word or two. Uncommon words are better.',"Capitalization doesn't help very much",
    ]}})));
    const {fixture,c}=page(password);c.submit();fixture.detectChanges();
    const text=fixture.nativeElement.textContent;
    expect(text).toContain('Password is too weak.');expect(text).toContain(hint);
    expect(text).toContain('Try combining several unrelated words, numbers, or symbols.');
    expect(text).not.toContain('Uncommon words');expect(text).not.toContain('Capitalization');
    expect(register).toHaveBeenCalledWith('student@example.com',password);
    expect(c.success()).toBe(false);
  });
  it('handles weak-password responses with no library suggestions',()=>{
    register.mockReturnValue(throwError(()=>({status:400,error:{suggestions:[]}})));
    const {c}=page('abc');c.submit();expect(c.suggestions().length).toBe(2);
  });
  it('clears the previous warning when a strong password is accepted',()=>{
    const {fixture,c}=page('abc');
    register.mockReturnValueOnce(throwError(()=>({status:400,error:{suggestions:['raw suggestion']}})));
    c.submit();expect(c.errorMsg()).toBeTruthy();
    const strong='quartz!Canoe7#Lantern$Orbit';c.password.set(strong);c.confirmPassword.set(strong);
    register.mockReturnValueOnce(of({}));c.submit();fixture.detectChanges();
    expect(register).toHaveBeenLastCalledWith('student@example.com',strong);
    expect(c.success()).toBe(true);expect(c.errorMsg()).toBe('');expect(c.suggestions()).toEqual([]);
    expect(fixture.nativeElement.querySelector('ul')).toBeNull();
  });
  it('preserves non-password errors and does not submit mismatched passwords',()=>{
    register.mockReturnValue(throwError(()=>({status:403,error:{}})));
    const {c}=page('passwordpassword');c.submit();
    expect(c.errorMsg()).toBe('error_email_not_invited');expect(c.suggestions()).toEqual([]);
    register.mockClear();c.confirmPassword.set('different');c.submit();
    expect(register).not.toHaveBeenCalled();expect(c.errorMsg()).toBe('error_passwords_mismatch');
  });
});
