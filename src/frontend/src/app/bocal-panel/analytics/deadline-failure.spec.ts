import {TestBed} from '@angular/core/testing';
import {ActivatedRoute,Router} from '@angular/router';
import {of} from 'rxjs';
import {AnalyticsAssignmentComponent} from './analytics-assignment.component';
import {CourseService} from '../../core/services/course-service/course-service';
import {AssignmentService} from '../../core/services/course-service/Assignment.service';
import {GroupService} from '../../core/services/group-service/group-service';
import {EvalService} from '../../core/services/eval-service/eval-service';
import {SubmissionService} from '../../core/services/submission-service/submission-service';
import {ExportService} from '../../core/services/export-service/export-service';
import {AssignmentWorkflowService} from '../../core/services/assignment-workflow.service';

const person=(id:number,username:string)=>({id,username,email:`${username}@example.com`,role:'Student',evalueeEligible:true,evaluatorEligible:true});
const people=[person(1,'ana'),person(2,'ben'),person(3,'cleo'),person(4,'dan'),person(5,'eve')];
const groups=[
  {id:11,name:'g-ana',deadlineFailure:true,deadlineFailureReason:'NotClosed',members:[{userId:1}]},
  {id:12,name:'g-ben',deadlineFailure:true,deadlineFailureReason:'NoSubmission',members:[{userId:2}]},
  {id:13,name:'g-cleo',deadlineFailure:true,deadlineFailureReason:'EvaluationsIncomplete',members:[{userId:3}]},
  {id:14,name:'g-dan',deadlineFailure:false,deadlineFailureReason:null,members:[{userId:4}]},
  // eve has no group
];
const setup=(submissionDeadline:string|null)=>TestBed.configureTestingModule({providers:[
  {provide:ActivatedRoute,useValue:{queryParamMap:of(new Map([['classId','4'],['assId','1']]))}},
  {provide:Router,useValue:{navigate:vi.fn()}},
  {provide:CourseService,useValue:{getClass:()=>of({name:'Course'})}},
  {provide:AssignmentService,useValue:{getAssignments:()=>of([{id:1,name:'A1',req_eval:1,max_score:100,pass_threshold:50,submissionDeadline}])}},
  {provide:GroupService,useValue:{getGroupsForAssignment:()=>of(groups)}},
  {provide:EvalService,useValue:{getEvalAssignments:()=>of([])}},
  {provide:SubmissionService,useValue:{getSubmissionsForAssignment:()=>of([])}},
  {provide:ExportService,useValue:{}},
  {provide:AssignmentWorkflowService,useValue:{summary:()=>of({participants:people,slots:[]})}},
]});
const deadlineCellOf=(root:HTMLElement,name:string)=>
  Array.from(root.querySelectorAll('tbody tr')).find(r=>r.querySelector('.student-name')?.textContent?.trim()===name)!
    .querySelector('td.deadline-cell')!;

describe('analytics: deadline failures',()=>{
  it('shows who failed and why as a compact pill in its own column, not in the Group cell',()=>{
    setup('2020-01-01T00:00:00Z');
    const f=TestBed.createComponent(AnalyticsAssignmentComponent);f.detectChanges();
    const root:HTMLElement=f.nativeElement;
    expect(deadlineCellOf(root,'ana').textContent).toContain('Failed · Not closed');
    expect(deadlineCellOf(root,'ben').textContent).toContain('Failed · No submission');
    expect(deadlineCellOf(root,'cleo').textContent).toContain('Failed · Evals incomplete');
    expect(deadlineCellOf(root,'cleo').querySelector('.deadline-pill')!.getAttribute('title')).toContain('evaluation deadline');
    expect(deadlineCellOf(root,'dan').querySelector('.deadline-pill')).toBeNull();
    // Unallocated after the submission deadline: failed like on the student's own page.
    expect(deadlineCellOf(root,'eve').textContent).toContain('No submission');
    // The old oversized icon-style label is gone from the Group column.
    for(const cell of Array.from(root.querySelectorAll('td.student-group'))) expect(cell.textContent).not.toContain('Failed');
    expect(f.componentInstance.stats()?.missedDeadline).toBe(4);

    f.componentInstance.onFilterChanged('MissedDeadline');f.detectChanges();
    expect(f.componentInstance.filteredStudents().map(s=>s.name)).toEqual(['ana','ben','cleo','eve']);
  });

  it('does not fail an unallocated student before the submission deadline',()=>{
    setup('2999-01-01T00:00:00Z');
    const f=TestBed.createComponent(AnalyticsAssignmentComponent);f.detectChanges();
    expect(deadlineCellOf(f.nativeElement,'eve').querySelector('.deadline-pill')).toBeNull();
  });
});
