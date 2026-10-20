import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {ActivatedRoute,Router} from '@angular/router';
import {EMPTY} from 'rxjs';
import {AnalyticsAssignmentComponent} from './analytics-assignment.component';
import {AnalyticsStudentComponent} from './analytics-student.component';
describe('analytics outcome versus evaluator duty',()=>{
  beforeEach(()=>TestBed.configureTestingModule({imports:[AnalyticsAssignmentComponent,AnalyticsStudentComponent],providers:[provideHttpClient(),
    {provide:ActivatedRoute,useValue:{queryParamMap:EMPTY}},{provide:Router,useValue:{navigate:vi.fn()}}]}));
  it('retains failed + pending evaluee attempts while submitted original/retry evaluator duties are green',()=>{
    const f=TestBed.createComponent(AnalyticsAssignmentComponent),c=f.componentInstance as any;
    const attempts=[{id:1,status:'Submitted',outcome:'Failed',round:1,evaluatorUserId:41,evalueeGroupId:42},
      {id:2,status:'Pending',outcome:'Pending',round:1,evaluatorUserId:1,evalueeGroupId:42}];
    const received=c.evalueeCell(attempts);
    expect(received.map((a:any)=>a.kind)).toEqual(['failed','pending']);
    const evaluator=c.progressCell([...attempts,{...attempts[0],id:3,evaluatorUserId:1},{...attempts[0],id:4,status:'Cancelled'}],[{id:42,name:'student42'}]);
    expect(evaluator.map((a:any)=>a.kind)).toEqual(['passed','pending','passed','cancelled']);
    expect(evaluator[0].label).toContain('student42 — task 1 — Completed');
    c.loading.set(false);c.selectedAssignmentName.set('Assignment');c.rounds.set([1]);c.stats.set({students:1,groups:1,pairings:2,groupsMissingPairings:0,unallocatedStudents:0});
    c.students.set([{id:42,name:'student42',groupName:'Group',groupId:42,evalueeEligible:true,received:[received],evaluator:[evaluator],incomplete:true}]);f.detectChanges();
    expect(f.nativeElement.querySelectorAll('tbody .failed').length).toBe(1);
    expect(f.nativeElement.querySelectorAll('tbody .passed').length).toBe(2);
    expect(f.nativeElement.querySelectorAll('tbody .status-clock').length).toBe(2);
  });
  it('student analytics counts submitted duties independently of academic outcomes',()=>{
    const f=TestBed.createComponent(AnalyticsStudentComponent),c=f.componentInstance;
    c.evaluatorRows.set([{round:1,evalueeGroupName:'Group',status:'Submitted'},{round:1,evalueeGroupName:'Other',status:'Pending'}]);
    expect(c.evaluatorCompletedCount()).toBe(1);expect(c.evaluatorAssignedCount()).toBe(2);
    c.student.set({id:42,username:'student42',email:'student42@example.com'});
    c.evalueeRows.set([{round:1,evaluatorName:'student41',evaluatorGroupName:'Group',status:'Passed'}]);f.detectChanges();
    const sections=f.nativeElement.querySelectorAll('table');
    expect(sections[0].textContent).toContain('Passed');expect(sections[1].textContent).toContain('Completed');
    expect(sections[1].textContent).not.toContain('Failed');
  });
});
