import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { EvaluationFlowComponent } from './evaluation-flow.component';
import { AuthService } from '../services/auth.service';
import { LoadingService } from '../core/services/loading-service/loading.service';
import { EvalService, EvaluatorTask, EvaluatorTaskOverview } from '../core/services/eval-service/eval-service';
import { evaluatorTasksFor } from './evaluator-tasks';

const task = (id: number, assignmentId: number, courseId: number, round: number, status: EvaluatorTask['status']): EvaluatorTask => ({
  id, assignmentId, evalueeGroupId: id, round, status,
  assignment: { id: assignmentId, name: `Assignment ${assignmentId}`, classid: courseId, created_at: '2026-10-01T09:00:00Z' },
  evalueeGroup: { id, name: `group${id}`, members: [{ user: { id: 42, username: 'student42' } }, { user: { id: 43, username: 'student43' } }] },
  evalResponse: status === 'Submitted' ? { id, givenMarks: 70, comment: 'Clear explanation.', reply: 'Thank you.', scores: [{ sectionId: 1, score: 70, section: { name: 'Explanation', marks: 100 } }] } : null,
});
const overview: EvaluatorTaskOverview = {
  courses: [
    { id: 1, name: 'Macroeconomics', description: 'Course description', term: 'Fall 2026', created_at: '2026-10-01', assignments: [{ id: 1, name: 'Assignment 1', created_at: '2026-10-01' }, { id: 2, name: 'Assignment 2', created_at: '2026-10-01' }] },
    { id: 2, name: 'Second course', description: 'Another course', term: null, created_at: '2026-10-01', assignments: [{ id: 3, name: 'Assignment 3', created_at: '2026-10-01' }] },
  ],
  tasks: [task(2, 2, 1, 2, 'Submitted'), task(1, 1, 1, 1, 'Pending'), task(3, 3, 2, 1, 'Cancelled')],
};

describe('evaluator task overview', () => {
  let fixture: ComponentFixture<EvaluationFlowComponent>;
  let component: EvaluationFlowComponent;
  let api: { getMyEvaluatorTasks: ReturnType<typeof vi.fn>; startEvaluation: ReturnType<typeof vi.fn>; submitEvaluation: ReturnType<typeof vi.fn> };
  beforeEach(async () => {
    api = { getMyEvaluatorTasks: vi.fn(() => of(overview)), startEvaluation: vi.fn(), submitEvaluation: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [EvaluationFlowComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: { user: () => ({ id: 4 }) } },
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: LoadingService, useValue: { show: () => {}, hide: () => {} } },
        { provide: EvalService, useValue: api },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(EvaluationFlowComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  it('begins with tasks, usernames and statuses, without a generic start form', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('My evaluator tasks');
    expect(text).toContain('2 assigned · 1 pending · 1 completed');
    expect(text).toContain('Evaluate: student42, student43');
    expect(text).toContain('Pending');
    expect(text).toContain('Completed');
    expect(text).toContain('Start evaluation →');
    expect(fixture.nativeElement.querySelector('#evaluation-passkey')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[type="email"]')).toBeNull();
  });
  it('opens contextual key entry only for a selected pending task', () => {
    component.openTask(overview.tasks[1]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Ask a member of the group');
    expect(fixture.nativeElement.querySelector('#evaluation-passkey')).not.toBeNull();
    expect(component.selectedTask()?.id).toBe(1);
    component.passkeyInput.set('abc');
    component.startEvaluation();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Enter the six-digit');
  });
  it('filters assignments and courses, resetting assignment on course change', () => {
    component.selectAssignment('2');
    fixture.detectChanges();
    expect(component.visibleTasks().map(t => t.id)).toEqual([2]);
    expect(fixture.nativeElement.textContent).toContain('All assigned evaluations are complete.');
    component.selectCourse('2');
    fixture.detectChanges();
    expect(component.assignmentId()).toBeNull();
    expect(component.visibleTasks().map(t => t.id)).toEqual([3]);
    expect(component.assignments().map(a => a.id)).toEqual([3]);
    expect(fixture.nativeElement.textContent).toContain('Cancelled');
  });
  it('shows completed scores, feedback and replies read-only', () => {
    component.openTask(overview.tasks[0]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Your submitted evaluation');
    expect(fixture.nativeElement.textContent).toContain('Clear explanation.');
    expect(fixture.nativeElement.textContent).toContain('Thank you.');
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    expect(fixture.nativeElement.querySelector('#evaluation-passkey')).toBeNull();
  });
  it('shows the missing evaluee response while the evaluator task remains completed', () => {
    const completed = overview.tasks[0];
    component.openTask({ ...completed, evalResponse: { ...completed.evalResponse!, reply: null } });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Response from evaluee');
    expect(fixture.nativeElement.textContent).toContain('No response has been submitted yet.');
    expect(component.selectedTask()?.status).toBe('Submitted');
  });
  it('shows the no-tasks empty state', () => {
    component.tasks.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('You currently have no assigned evaluation tasks.');
  });
  it('starts the selected task without email and submits through the existing evaluation flow', () => {
    api.startEvaluation.mockReturnValue(of({
      evalAssignmentId: 1,
      assignment: { id: 1, name: 'Assignment 1', description: 'Description', max_score: 100 },
      group: { id: 1, name: 'group1' }, submission: { id: 1, file: null },
      evalSheet: { sections: [{ id: 1, name: 'Explanation', description: '', marks: 100, sectionType: 'Slider' }] },
    }));
    api.submitEvaluation.mockReturnValue(of({ id: 1 }));
    component.openTask(overview.tasks[1]);
    component.passkeyInput.set('482913');
    component.startEvaluation();
    fixture.detectChanges();
    expect(api.startEvaluation).toHaveBeenCalledWith({ evalAssignmentId: 1, passkey: '482913' });
    expect(component.phase()).toBe('flow');
    component.setSlider(component.sections()[0], 70);
    component.comment.set('Clear explanation and well supported answers.');
    // A recording is mandatory before the evaluation can be submitted.
    const recording = new File(['audio'], 'evaluation.webm', { type: 'audio/webm' });
    component.recording.set(recording);
    component.submit();
    fixture.detectChanges();
    // The evaluator's identity comes from the auth token, so it is not sent in
    // the body; the recording is uploaded as part of the multipart request.
    expect(api.submitEvaluation).toHaveBeenCalledWith({
      evalAssignmentId: 1,
      comment: 'Clear explanation and well supported answers.',
      scores: [{ sectionId: 1, score: 70 }],
      recording,
    });
    expect(component.submitted()).toBe(true);
  });
  it('orders by assignment timestamp, ID, round and task ID without mutating input', () => {
    const tasks = [task(8, 2, 1, 1, 'Pending'), task(7, 1, 1, 2, 'Pending'), task(6, 1, 1, 1, 'Pending'), task(5, 1, 1, 1, 'Pending')];
    expect(evaluatorTasksFor(tasks, 1, null).map(t => t.id)).toEqual([5, 6, 7, 8]);
    expect(tasks.map(t => t.id)).toEqual([8, 7, 6, 5]);
    tasks[0].assignment.created_at = '2026-09-01T09:00:00Z';
    expect(evaluatorTasksFor(tasks, 1, null)[0].id).toBe(8);
  });
});
