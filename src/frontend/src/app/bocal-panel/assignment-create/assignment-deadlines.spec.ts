import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {ActivatedRoute,Router} from '@angular/router';
import {TranslateModule} from '@ngx-translate/core';
import {EMPTY,of} from 'rxjs';
import {AssignmentCreateComponent} from './assignment-create.component';
import {AssignmentService} from '../../core/services/course-service/Assignment.service';
import {AuthService} from '../../services/auth.service';
describe('Edit Assignment deadlines',()=>{
  const update=vi.fn(()=>of({}));
  beforeEach(()=>{
    update.mockClear();
    TestBed.configureTestingModule({imports:[AssignmentCreateComponent,TranslateModule.forRoot()],providers:[provideHttpClient(),
      {provide:ActivatedRoute,useValue:{queryParams:EMPTY}},{provide:Router,useValue:{navigate:vi.fn()}},
      {provide:AuthService,useValue:{user:()=>({id:5})}},{provide:AssignmentService,useValue:{updateAssignment:update}},
    ]});
  });
  it('shows two clearable datetime inputs only in Edit mode and gives immediate ordering feedback',()=>{
    const f=TestBed.createComponent(AssignmentCreateComponent),c=f.componentInstance;f.detectChanges();
    expect(f.nativeElement.querySelectorAll('input[type=datetime-local]').length).toBe(0);
    c.editMode.set(true);f.detectChanges();expect(f.nativeElement.querySelectorAll('input[type=datetime-local]').length).toBe(2);
    c.submissionDeadline.set('2026-10-28T23:59');c.evaluationDeadline.set('2026-10-27T23:59');f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Peer-evaluation deadline must be on or after');
    c.evaluationDeadline.set('2026-10-28T23:59');expect(c.deadlineError()).toBeNull();
    c.submissionDeadline.set('');c.evaluationDeadline.set('');expect(c.deadlineError()).toBeNull();
  });
  it('sends ISO instants/null when saving and prevents invalid ordering',()=>{
    const c=TestBed.createComponent(AssignmentCreateComponent).componentInstance as any;
    c.editMode.set(true);c.assignmentId=1;c.classId=2;c.name.set('Assignment');c.description.set('Description');
    c.maxScore.set(100);c.reqEval.set(1);c.pendingSections.set([{name:'Question',marks:100}]);
    c.syncEvalSheet=vi.fn();c.submissionDeadline.set('2026-10-28T23:59');c.evaluationDeadline.set('2026-10-27T23:59');
    c.onSave();expect(update).not.toHaveBeenCalled();
    c.evaluationDeadline.set('2026-10-29T23:59');c.onSave();
    expect((update.mock.calls as any)[0][1].submissionDeadline).toBe(new Date('2026-10-28T23:59').toISOString());
    c.submissionDeadline.set('');c.evaluationDeadline.set('');c.onSave();
    expect((update.mock.calls as any)[1][1]).toMatchObject({submissionDeadline:null,evaluationDeadline:null});
  });
});
