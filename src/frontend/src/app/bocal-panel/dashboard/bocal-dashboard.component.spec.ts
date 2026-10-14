import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { BocalDashboardComponent, StaffDashboardData } from './bocal-dashboard.component';
const data: StaffDashboardData = {
  courses: [{id:1,name:'Course 1',description:'Description',term:'Fall 2026'},{id:2,name:'Course 2',description:'Other course',term:null}],
  actions: [
    {id:'rematch:1',kind:'rematch',label:'student42 requested a new evaluator for Evaluation 1 of Assignment 1 after a failed evaluation.',courseId:1,courseName:'Course 1',assignmentId:1,occurredAt:'2026-10-14T09:00:00Z',route:'/eval-assignments',queryParams:{assignmentId:1}},
    {id:'groups:2',kind:'groups',label:'Assignment 2 needs groups for 2 unassigned students.',courseId:2,courseName:'Course 2',assignmentId:2,occurredAt:'2026-10-13',route:'/bocal/classes',queryParams:{classId:2,groupAssignmentId:2}},
  ],
};
describe('Bocal dashboard', () => {
  const navigate = vi.fn();
  beforeEach(() => {
    navigate.mockReset();
    TestBed.configureTestingModule({imports:[BocalDashboardComponent],providers:[
      provideHttpClient(),provideHttpClientTesting(),
      {provide:AuthService,useValue:{user:()=>({username:'Katrin',role:'Bocal'})}},
      {provide:Router,useValue:{navigate}},
    ]});
  });
  afterEach(()=>TestBed.inject(HttpTestingController).verify());
  it('shows actionable messages, filters by course and opens the correct management page', () => {
    const fixture=TestBed.createComponent(BocalDashboardComponent);fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/user/me/staff-dashboard').flush(data);fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Welcome back, Katrin');
    expect(fixture.nativeElement.textContent).toContain('Action required · 2');
    expect(fixture.nativeElement.textContent).toContain('student42 requested');
    fixture.componentInstance.open(data.actions[0]);
    expect(navigate).toHaveBeenLastCalledWith(['/eval-assignments'],{queryParams:{assignmentId:1}});
    const select:HTMLSelectElement=fixture.nativeElement.querySelector('#staff-dashboard-course');
    select.value='2';select.dispatchEvent(new Event('change'));fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('student42 requested');
    expect(fixture.nativeElement.textContent).toContain('Assignment 2 needs groups');
    fixture.componentInstance.open(data.actions[1]);
    expect(navigate).toHaveBeenLastCalledWith(['/bocal/classes'],{queryParams:{classId:2,groupAssignmentId:2}});
  });
  it('has a caught-up state when no actions are outstanding', () => {
    const fixture=TestBed.createComponent(BocalDashboardComponent);fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/user/me/staff-dashboard').flush({courses:data.courses,actions:[]});fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("You're all caught up.");
  });
  it('shows a load error rather than a misleading caught-up state', () => {
    const fixture=TestBed.createComponent(BocalDashboardComponent);fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/user/me/staff-dashboard').flush({error:'Forbidden'},{status:403,statusText:'Forbidden'});fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Forbidden');
    expect(fixture.nativeElement.textContent).not.toContain("You're all caught up.");
  });
});
