import {TestBed} from '@angular/core/testing';
import {ActivatedRoute,Router} from '@angular/router';
import {of} from 'rxjs';
import {AnalyticsAssignmentComponent} from './analytics-assignment.component';
import {AnalyticsStudentComponent} from './analytics-student.component';
import {CourseService} from '../../core/services/course-service/course-service';
import {AssignmentService} from '../../core/services/course-service/Assignment.service';
import {GroupService} from '../../core/services/group-service/group-service';
import {EvalService} from '../../core/services/eval-service/eval-service';
import {SubmissionService} from '../../core/services/submission-service/submission-service';
import {ExportService} from '../../core/services/export-service/export-service';
import {AssignmentWorkflowService} from '../../core/services/assignment-workflow.service';
const student={id:1,username:'student1',email:'s1@example.com',role:'Student',evalueeEligible:true,evaluatorEligible:true};
const assignment={id:1,name:'Assignment 1',req_eval:1,max_score:100,pass_threshold:100};
const groups=[{id:2,name:'group2',members:[{userId:1,user:student}]}];
const pairings=[
  {id:8,createdAt:'2026-10-01',round:1,status:'Pending',evalueeGroupId:2,evaluatorUserId:1,outcome:'Pending',evaluatorUser:{username:'replacement'}},
  {id:7,createdAt:'2026-09-01',round:1,status:'Submitted',evalueeGroupId:2,evaluatorUserId:1,outcome:'Failed',evaluatorUser:{username:'original'}},
];
describe('historical analytics retries',()=>{
  beforeEach(()=>TestBed.configureTestingModule({providers:[
    {provide:ActivatedRoute,useValue:{queryParamMap:of(new Map([['classId','4'],['assId','1'],['studentId','1']]))}},
    {provide:Router,useValue:{navigate:vi.fn()}},
    {provide:CourseService,useValue:{getClass:()=>of({name:'Course'}),getClassStudents:()=>of([student])}},
    {provide:AssignmentService,useValue:{getAssignments:()=>of([assignment])}},
    {provide:GroupService,useValue:{getGroupsForAssignment:()=>of(groups)}},
    {provide:EvalService,useValue:{getEvalAssignments:()=>of(pairings)}},
    {provide:SubmissionService,useValue:{getSubmissionsForAssignment:()=>of([])}},
    {provide:ExportService,useValue:{}},
    {provide:AssignmentWorkflowService,useValue:{summary:()=>of({participants:[student],slots:[]})}},
  ]}));
  it('renders one icon per incoming attempt and evaluator task, with identifying labels',()=>{
    const f=TestBed.createComponent(AnalyticsAssignmentComponent);f.detectChanges();
    const cells=f.nativeElement.querySelectorAll('td.progress-cell');
    expect(cells.length).toBe(2);
    expect(cells[0].querySelectorAll('.attempt-status').length).toBe(2);
    expect(cells[0].querySelector('.failed')?.title).toContain('Attempt 1 — evaluated by original — Failed');
    expect(cells[0].querySelector('.pending')?.title).toContain('Attempt 2 — evaluated by replacement — Pending');
    // Evaluator cells show duty, not the evaluee's result: the submitted (failed)
    // attempt is a completed task, its replacement still pending.
    expect(cells[1].querySelectorAll('.attempt-status').length).toBe(2);
    expect(cells[1].querySelector('.passed')?.title).toContain('Evaluates group2 — task 7 — Completed');
    expect(cells[1].querySelector('.pending')?.title).toContain('Evaluates group2 — task 8 — Pending');
    expect(cells[1].textContent).not.toContain('×');
    expect(f.componentInstance.stats()?.pairings).toBe(2);
  });
  it('retains the original failure alongside its pending replacement in chronological order',()=>{
    const f=TestBed.createComponent(AnalyticsStudentComponent);f.detectChanges();
    const rows=f.componentInstance.evalueeRows();
    expect(rows.map(r=>[r.attempt,r.evaluatorName,r.status])).toEqual([[1,'original','Failed'],[2,'replacement','Pending']]);
    const [asEvaluee, asEvaluator]=f.nativeElement.querySelectorAll('table');
    expect(asEvaluee.textContent).toContain('Attempt 1');
    expect(asEvaluee.textContent).toContain('Attempt 2');
    expect(asEvaluee.textContent).toContain('Failed');
    expect(asEvaluee.textContent).not.toContain('Passed');
    // The same attempts seen as evaluator duty: done, and still to do.
    expect(asEvaluator.textContent).toContain('Completed');
    expect(asEvaluator.textContent).toContain('Pending');
    expect(asEvaluator.textContent).not.toContain('Failed');
  });
});
