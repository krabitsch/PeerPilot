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
