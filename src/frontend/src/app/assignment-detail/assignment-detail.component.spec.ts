import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { EMPTY, of } from 'rxjs';
import { AssignmentDetailComponent } from './assignment-detail.component';
import { AuthService } from '../services/auth.service';
import { GroupService } from '../core/services/group-service/group-service';
import { SubmissionService } from '../core/services/submission-service/submission-service';
import { EvalService } from '../core/services/eval-service/eval-service';

describe('assignment evaluator visibility', () => {
  for (const status of [null, 'Open', 'Close']) {
    for (const paired of [false, true]) {
      it(`loads and renders ${paired ? 'assigned evaluators' : 'no misleading rows'} with submission ${status}`, async () => {
        const group = {id:2, leaderId:6, members:(paired ? [5,6] : [5]).map(id=>({id,userId:id,user:{id,username:'student'+id}}))};
        const submission = status ? {id:3, groupId:2, group, status, canUploadRetryFile:paired && status === 'Close', files:paired && status === 'Close' ? [{id:11,name:'original.pdf'},{id:12,name:'revised.pdf'}] : [], evaluationRounds:[{round:1, evalAssignmentId:7, displayOutcome:'Pending'}]} : null;
        const pairing = {id:7, round:1, evalueeGroupId:2, status:'Pending', passKey:'482913', evaluatorUser:{id:4,username:'student53',email:'student53@example.com'}};
        const responses = vi.fn(() => of([]));
        const pairings = vi.fn(() => of(paired ? [pairing] : []));
        await TestBed.configureTestingModule({
          imports:[AssignmentDetailComponent, TranslateModule.forRoot()],
          providers:[provideHttpClient(),
            {provide:ActivatedRoute,useValue:{queryParams:EMPTY}}, {provide:Router,useValue:{navigate:vi.fn()}},
            {provide:AuthService,useValue:{role:()=> 'Student',user:()=>({id:5})}},
            {provide:SubmissionService,useValue:{getSubmissionsForAssignment:()=>of(submission ? [submission] : [])}},
            {provide:GroupService,useValue:{getMyGroupForAssignment:()=>of(group)}},
            {provide:EvalService,useValue:{getEvalAssignments:pairings,getResponsesForSubmission:responses}},
          ],
        }).compileComponents();
        const fixture = TestBed.createComponent(AssignmentDetailComponent);
        const component = fixture.componentInstance;
        component.assignment.set({id:1,name:'Assignment 1',description:'Description',file:null,req_eval:1,max_score:100,evaluationDurationMinutes:45} as any);
        (component as any).loadSubmissions(1);
        fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        expect(pairings).toHaveBeenCalledWith(1);
        expect(el.querySelectorAll('.evaluation-row').length).toBe(paired ? 1 : 0);
        expect(el.textContent?.includes('student53@example.com')).toBe(paired);
        expect(el.textContent?.includes('This is a group submission.')).toBe(paired);
        expect(el.textContent?.includes('Upload updated submission file')).toBe(paired && status === 'Close');
        if (paired) expect(el.textContent).toContain('Recommended duration per session: 45 minutes');
        if (paired && status === 'Close') {
          expect(el.textContent).toContain('Original submission');
          expect(el.textContent).toContain('Latest version');
          expect(el.textContent).toContain('original.pdf');
          expect(el.textContent).toContain('revised.pdf');
        }
        expect(el.querySelectorAll('.evaluation-passkey').length).toBe(paired && status === 'Close' ? 1 : 0);
        expect(el.querySelectorAll('.grade-inner').length).toBe(status === 'Close' ? 1 : 0);
        expect(responses.mock.calls.length).toBe(status === 'Close' ? 1 : 0);
        if (paired && status === 'Close') expect(el.textContent).toContain('482913');
        else expect(el.textContent).not.toContain('482913');
      });
    }
  }
});

describe('assignment and recording upload selection',()=>{
  beforeEach(()=>TestBed.configureTestingModule({
    imports:[AssignmentDetailComponent,TranslateModule.forRoot()],providers:[provideHttpClient(),
      {provide:ActivatedRoute,useValue:{queryParams:EMPTY}},{provide:Router,useValue:{navigate:vi.fn()}},
      {provide:AuthService,useValue:{role:()=> 'Student',user:()=>({id:5})}},
      {provide:SubmissionService,useValue:{}},{provide:GroupService,useValue:{}},{provide:EvalService,useValue:{}},
    ],
  }));
  it('applies the submission format allowlist and the unchanged 50 MB size boundary',()=>{
    const c=TestBed.createComponent(AssignmentDetailComponent).componentInstance as any;
    expect(c.validateSubmissionFile({name:'project.7z',type:'application/octet-stream',size:50*1024*1024})).toBeNull();
    expect(c.validateSubmissionFile({name:'project.rar',type:'application/vnd.rar',size:50*1024*1024+1})).not.toBeNull();
    expect(c.validateSubmissionFile({name:'program.exe',type:'application/octet-stream',size:1})).toContain('Unsupported file type.');
  });
  it('accepts phone audio, rejects unsupported/oversized audio, and clears stale selection',()=>{
    const c=TestBed.createComponent(AssignmentDetailComponent).componentInstance;
    const select=(name:string,type:string,size=1)=>c.onReplyRecordingSelected(7,{target:{files:[{name,type,size}],value:name}} as any);
    select('Voice.M4A','application/octet-stream',200*1024*1024);
    expect(c.replyRecordings().get(7)?.name).toBe('Voice.M4A');expect(c.replyError()).toBeNull();
    select('program.exe','application/octet-stream');
    expect(c.replyRecordings().has(7)).toBe(false);expect(c.replyError()).toContain('Unsupported audio format.');
    select('Voice.m4a','audio/mp4',200*1024*1024+1);
    expect(c.replyRecordings().has(7)).toBe(false);expect(c.replyError()).toContain('200 MB');
    select('recording.caf','');expect(c.replyRecordings().has(7)).toBe(true);expect(c.replyError()).toBeNull();
  });
});

describe('optional deadline display',()=>{
  beforeEach(()=>TestBed.configureTestingModule({imports:[AssignmentDetailComponent,TranslateModule.forRoot()],providers:[provideHttpClient(),
    {provide:ActivatedRoute,useValue:{queryParams:EMPTY}},{provide:Router,useValue:{navigate:vi.fn()}},
    {provide:AuthService,useValue:{role:()=> 'Student',user:()=>({id:5})}},
    {provide:SubmissionService,useValue:{}},{provide:GroupService,useValue:{}},{provide:EvalService,useValue:{}},
  ]}));
  for(const submission of [false,true])for(const evaluation of [false,true])it(`shows configured deadlines only: ${submission}/${evaluation}`,()=>{
    const f=TestBed.createComponent(AssignmentDetailComponent),c=f.componentInstance;
    c.assignment.set({id:1,name:'Assignment',description:'Description',req_eval:1,max_score:100,
      submissionDeadline:submission?'2099-10-28T22:59:00Z':null,evaluationDeadline:evaluation?'2099-11-04T22:59:00Z':null} as any);
    c.myGroup.set({id:2,leaderId:5,members:[]} as any);
    c.myEvaluators.set([{id:7,round:1,status:'Pending',evaluatorUser:{id:4,username:'student4'}}] as any);
    f.detectChanges();const text=f.nativeElement.textContent;
    expect(text.includes('The submission deadline is')).toBe(submission);
    expect(text.includes('All required peer evaluations must be completed by')).toBe(evaluation);
    expect(text).toContain('No submission yet.');expect(c.submissionDeadlinePassed()).toBe(false);
  });
  it('uses backend Failed for missing work and keeps submitted files visible after deadline',()=>{
    const f=TestBed.createComponent(AssignmentDetailComponent),c=f.componentInstance;
    c.assignment.set({id:1,name:'Assignment',description:'Description',req_eval:1,max_score:100,submissionDeadline:'2000-01-01T00:00:00Z',groups:[{id:2,deadlineFailure:true}]} as any);
    c.myGroup.set({id:2,leaderId:5,members:[]} as any);f.detectChanges();
    expect(c.statusLabel()).toBe('Failed');expect(c.statusBadge()).toBe('failed');expect(c.submissionDeadlinePassed()).toBe(true);
    const start=f.nativeElement.querySelector('.submission-card app-btn button');expect(start.disabled).toBe(true);
    c.mySubmission.set({id:3,groupId:2,status:'Close',files:[{id:4,name:'answers.pdf'}]} as any);f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Submission deadline:');expect(f.nativeElement.textContent).toContain('answers.pdf');
    expect(f.nativeElement.textContent).toContain('Download');
  });
  for(const overdue of [false,true])it(`retry picker uses evaluation deadline after original submission deadline: overdue=${overdue}`,()=>{
    const f=TestBed.createComponent(AssignmentDetailComponent),c=f.componentInstance;
    c.assignment.set({id:1,name:'Assignment',description:'Description',req_eval:1,max_score:100,
      submissionDeadline:'2000-01-01T00:00:00Z',evaluationDeadline:overdue?'2000-01-02T00:00:00Z':'2099-01-01T00:00:00Z'} as any);
    c.myGroup.set({id:2,leaderId:5,members:[]} as any);
    c.mySubmission.set({id:3,groupId:2,status:'Close',canUploadRetryFile:true,files:[]} as any);
    const retry=vi.fn(()=>of({id:3,groupId:2,status:'Close',files:[]}));
    (TestBed.inject(SubmissionService) as any).uploadRetryFile=retry;
    f.detectChanges();
    expect(f.nativeElement.querySelector('.submission-card input[type=file]').disabled).toBe(overdue);
    expect(f.nativeElement.querySelector('.submission-card .upload-picker button').disabled).toBe(overdue);
    c.selectedFile.set(new File(['answers'],'answers.pdf',{type:'application/pdf'}));c.uploadSelectedFile();
    expect(retry.mock.calls.length).toBe(overdue?0:1);
  });

});
