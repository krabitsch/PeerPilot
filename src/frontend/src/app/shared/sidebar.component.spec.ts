import {TestBed} from '@angular/core/testing';
import {signal} from '@angular/core';
import {provideRouter,Router} from '@angular/router';
import {TranslateModule} from '@ngx-translate/core';
import {SidebarComponent} from './sidebar.component';
import {AuthService} from '../services/auth.service';
import {DS} from '../tokens';

describe('role-specific sidebar navigation',()=>{
  const user=signal({id:1,username:'user',role:'Bocal'});
  beforeEach(()=>{
    user.set({id:1,username:'user',role:'Bocal'});
    TestBed.configureTestingModule({imports:[SidebarComponent,TranslateModule.forRoot()],providers:[
      provideRouter([{path:'evaluation',component:SidebarComponent}]),{provide:AuthService,useValue:{user,logout:vi.fn()}},
    ]});
  });
  it('places Bocal evaluator tasks below management links and a subtle separator',()=>{
    const fixture=TestBed.createComponent(SidebarComponent);fixture.detectChanges();
    expect(fixture.componentInstance.visibleItems().map(i=>i.id)).toEqual([
      'bocal-dashboard','bocal-courses','bocal-assignments','bocal-students','bocal-analytics','student-evaluations',
    ]);
    const divider=fixture.nativeElement.querySelector('[role=separator]');
    expect(divider).not.toBeNull();
    expect(divider.nextElementSibling.getAttribute('href')).toBe('/evaluation');
    const nav=fixture.nativeElement.querySelector('.sidebar-nav');
    expect(nav.lastElementChild.querySelector('app-language-switcher')).not.toBeNull();
    expect(nav.lastElementChild.textContent).toContain('btn_sign_out');
  });
  it('retains evaluator-task routing and active styling after the move',async()=>{
    await TestBed.inject(Router).navigateByUrl('/evaluation');
    const fixture=TestBed.createComponent(SidebarComponent),c=fixture.componentInstance;
    const item=c.visibleItems().at(-1)!;
    expect(item.route).toBe('/evaluation');
    expect(c.navItemStyle(item).background).toBe(DS.colors.violetSubtle);
    expect(c.navItemStyle(item).color).toBe(DS.colors.violet);
  });
  for(const [role,ids] of [
    ['Student',['student-dashboard','student-classes','student-assignments','student-evaluations','student-progress']],
    ['Admin',['student-evaluations','bocal-dashboard','bocal-courses','bocal-assignments','bocal-students','bocal-analytics','admin']],
  ] as const) it(`preserves ${role} order without adding a divider`,()=>{
    user.update(u=>({...u,role}));
    const fixture=TestBed.createComponent(SidebarComponent);fixture.detectChanges();
    expect(fixture.componentInstance.visibleItems().map(i=>i.id)).toEqual([...ids]);
    expect(fixture.nativeElement.querySelector('[role=separator]')).toBeNull();
  });
});
