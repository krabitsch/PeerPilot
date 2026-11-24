import {TestBed} from '@angular/core/testing';
import {ActivatedRoute,Router} from '@angular/router';
import {of} from 'rxjs';
import {AnalyticsAssignmentComponent} from './analytics-assignment.component';
import {AnalyticsOverviewComponent} from './analytics-overview.component';
import {CourseService} from '../../core/services/course-service/course-service';
import {AssignmentService} from '../../core/services/course-service/Assignment.service';
import {GroupService} from '../../core/services/group-service/group-service';
import {EvalService} from '../../core/services/eval-service/eval-service';
import {SubmissionService} from '../../core/services/submission-service/submission-service';
import {ExportService} from '../../core/services/export-service/export-service';
import {AssignmentWorkflowService} from '../../core/services/assignment-workflow.service';
import {AuthService} from '../../services/auth.service';

const person=(id:number,username:string)=>({id,username,email:`${username}@example.com`,role:'Student',evalueeEligible:true,evaluatorEligible:true});
const people=[person(1,'ana'),person(2,'ben'),person(3,'cleo'),person(4,'dan'),person(5,'eve')];
const groups=[
  {id:11,name:'g-ana',members:[{userId:1}],submission:{status:'Submitted',fileCount:3,submittedAt:'2026-11-12T09:30:00Z'}},
  {id:12,name:'g-ben',members:[{userId:2}],submission:{status:'Uploaded',fileCount:1,submittedAt:null}},
  {id:13,name:'g-cleo',members:[{userId:3}],submission:{status:'Open',fileCount:0,submittedAt:null}},
  {id:14,name:'g-dan',members:[{userId:4}],submission:{status:'NotStarted',fileCount:0,submittedAt:null}},
  // eve has no group
];
const getSubmissionsForAssignment=vi.fn(()=>of([]));
const providers=()=>[
  {provide:ActivatedRoute,useValue:{queryParamMap:of(new Map([['classId','4'],['assId','1']]))}},
  {provide:Router,useValue:{navigate:vi.fn()}},
  {provide:CourseService,useValue:{getClass:()=>of({name:'Course'})}},
  {provide:AssignmentService,useValue:{getAssignments:()=>of([{id:1,name:'A1',req_eval:1,max_score:100,pass_threshold:50,submissionDeadline:null}])}},
  {provide:GroupService,useValue:{getGroupsForAssignment:()=>of(groups)}},
  {provide:EvalService,useValue:{getEvalAssignments:()=>of([])}},
  {provide:SubmissionService,useValue:{getSubmissionsForAssignment}},
  {provide:ExportService,useValue:{}},
  {provide:AssignmentWorkflowService,useValue:{summary:()=>of({participants:people,slots:[]})}},
];
const rowOf=(root:HTMLElement,name:string)=>
  Array.from(root.querySelectorAll('tbody tr')).find(r=>r.querySelector('.student-name')?.textContent?.trim()===name)!;

describe('analytics: who submitted',()=>{
  beforeEach(()=>{getSubmissionsForAssignment.mockClear();TestBed.configureTestingModule({providers:providers()});});

  it('shows each group\'s submission state, with the download only where a file exists',()=>{
    const f=TestBed.createComponent(AnalyticsAssignmentComponent);f.detectChanges();
    const root:HTMLElement=f.nativeElement;
    const cell=(name:string)=>rowOf(root,name).querySelector('td.submission-cell')!;
    const download=(name:string)=>rowOf(root,name).querySelector('button.row-download');

    expect(cell('ana').querySelector('.submission-pill.ok')!.textContent).toContain('Submitted');
    expect(cell('ana').textContent).toContain('3 files');
    expect(download('ana')!.getAttribute('title')).toContain('latest of this group\'s 3 files');

    expect(cell('ben').querySelector('.submission-pill.warn')!.textContent).toContain('Uploaded, not closed');
    expect(download('ben')).not.toBeNull();

    expect(cell('cleo').textContent).toContain('Started, no file');
    expect(download('cleo')).toBeNull();
    expect(cell('dan').textContent).toContain('Not started');
    expect(download('dan')).toBeNull();
    expect(cell('eve').querySelector('.submission-pill')).toBeNull();

    // The page no longer pays for the heavy per-submission endpoint it never used.
    expect(getSubmissionsForAssignment).not.toHaveBeenCalled();
  });

  it('counts groups by submission state and filters students who haven\'t handed in',()=>{
    const f=TestBed.createComponent(AnalyticsAssignmentComponent);f.detectChanges();
    const c=f.componentInstance;
    expect(c.stats()).toMatchObject({groupsSubmitted:1,groupsUploaded:1,groupsNotSubmitted:2});

    c.onFilterChanged('NotSubmitted');
    expect(c.filteredStudents().map(s=>s.name)).toEqual(['ben','cleo','dan','eve']);
    c.onFilterChanged('UploadedNotClosed');
    expect(c.filteredStudents().map(s=>s.name)).toEqual(['ben']);
  });

  it('overview cards show the same per-group counts',()=>{
    TestBed.overrideProvider(AuthService,{useValue:{getUser:()=>({orgId:1})}});
    const f=TestBed.createComponent(AnalyticsOverviewComponent);
    const card=(f.componentInstance as any).buildCard({id:1,name:'A1',req_eval:1},groups,[]);
    expect(card).toMatchObject({groupCount:4,submitted:1,uploadedNotClosed:1});
  });
});
