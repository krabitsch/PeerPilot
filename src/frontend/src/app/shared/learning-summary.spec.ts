import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { DashboardComponent } from '../dashboard/dashboard.component';
import { ProgressComponent } from '../progress/progress.component';
import { AuthService } from '../services/auth.service';
import { LearningAssignment, LearningCourse, LearningSummaryService, dashboardActions, courseMetrics } from '../core/services/learning-summary.service';
const assignment = (id = 1): LearningAssignment => ({
  id, name: `Assignment ${id}`, created_at: '2026-10-01', status: 'NotStarted', groupAssigned: false, canReply: true,
  submissionState: 'NotSubmitted', completed: false, retryAvailable: false,
  evaluationRounds: [{ round: 1, displayOutcome: 'Pending', waitingForRematch: false, passedAfterRetry: false }],
  evaluatorAssigned: 0, evaluatorCompleted: 0, evaluatorPending: 0,
});
const course = (assignments: LearningAssignment[], id = 1): LearningCourse => ({
  id, name: `Course ${id}`, description: 'Course description', term: 'Fall 2026', externalCourseCode: '1421', assignments,
});
describe('student dashboard and progress', () => {
  const navigation = vi.fn();
  beforeEach(() => {
    navigation.mockReset();
    TestBed.configureTestingModule({
      imports: [DashboardComponent, ProgressComponent, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting(),
        { provide: Router, useValue: { navigate: navigation } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: AuthService, useValue: { user: () => ({ id: 5, username: 'student42' }) } },
      ],
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  function flush(courses: LearningCourse[]) {
    TestBed.inject(HttpTestingController).expectOne('/api/user/me/learning-summary').flush({ courses });
  }
  it('A/F: dashboard is caught up while rematch is informational', () => {
    const fixture = TestBed.createComponent(DashboardComponent); fixture.detectChanges();
    flush([course([{ ...assignment(), status: 'Failed', submissionState: 'Submitted', evaluationRounds: [{ round: 1, displayOutcome: 'Failed', waitingForRematch: true, passedAfterRetry: false }] }])]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("You're all caught up.");
    expect(fixture.nativeElement.textContent).toContain('1 assignment waiting for staff to rematch an evaluator.');
    expect(fixture.nativeElement.textContent).toContain('Info');
    const store = fixture.componentInstance.summary;
    const current = store.selectedCourse()!;
    store.courses.set([{ ...current, assignments: [current.assignments[0], { ...current.assignments[0], id: 2 }] }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('2 assignments waiting for staff to rematch an evaluator.');
    expect(fixture.nativeElement.querySelectorAll('.action-row').length).toBe(0);
  });
  it('B/C/J: compact actions use the correct routes, contribution totals are actual task counts', () => {
    const a = { ...assignment(), status: 'FeedbackRequired' as const, submissionState: 'Submitted' as const, evaluatorAssigned: 3, evaluatorCompleted: 1, evaluatorPending: 2 };
    const fixture = TestBed.createComponent(DashboardComponent); fixture.detectChanges(); flush([course([a])]); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('2 evaluator tasks are waiting');
    expect(fixture.nativeElement.textContent).toContain('Respond to feedback on Assignment 1');
    expect(fixture.nativeElement.textContent).toContain('1 / 3');
    const component = fixture.componentInstance;
    component.openAction(component.actions()[0]);
    expect(navigation).toHaveBeenLastCalledWith(['/evaluation'], { queryParams: { classId: 1 } });
    component.openAction(component.actions()[1]);
    expect(navigation).toHaveBeenLastCalledWith(['/assignment-detail'], { queryParams: { assId: 1 } });
    expect(component.summary.metrics().passed).toBe(0);
    expect(Array.from(fixture.nativeElement.querySelectorAll('.metrics .muted'), (e: any) => e.textContent)).toEqual(['Evaluations passed', 'Assignments passed', 'Evaluator tasks completed']);
  });
  it('only staff-assigned groups create submission actions; nonleaders are not asked to reply', () => {
    expect(dashboardActions(course([assignment()]))).toEqual([]);
    expect(dashboardActions(course([{ ...assignment(), groupAssigned: true }]))[0].label).toContain('ready for submission');
    expect(dashboardActions(course([{ ...assignment(), submissionState: 'Open' }]))[0].label).toContain('Finish your submission');
    expect(dashboardActions(course([{ ...assignment(), status: 'FeedbackRequired', canReply: false, submissionState: 'Submitted' }]))).toEqual([]);
  });
  it('H/I: progress sorts and switches courses, showing summary only for evaluator contribution', () => {
    const first = { ...assignment(1), status: 'FeedbackRequired' as const, evaluationRounds: [{ round: 1, displayOutcome: 'FeedbackRequired' as const, waitingForRematch: false, passedAfterRetry: false }] };
    const fixture = TestBed.createComponent(ProgressComponent); fixture.detectChanges();
    flush([course([assignment(2), first]), course([{ ...assignment(3), status: 'Passed', completed: true, evaluatorAssigned: 2, evaluatorCompleted: 2 }], 2)]);
    fixture.detectChanges();
    expect(Array.from(fixture.nativeElement.querySelectorAll('.assignment-head h2'), (e: any) => e.textContent)).toEqual(['Assignment 1', 'Assignment 2']);
    expect(fixture.nativeElement.textContent).toContain('Feedback required');
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    const selector: HTMLSelectElement = fixture.nativeElement.querySelector('#learning-course');
    selector.value = '2'; selector.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(fixture.componentInstance.summary.selectedCourse()?.id).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('WU course 1421');
    expect(fixture.nativeElement.textContent).toContain('Completed 2 of 2 assigned evaluator tasks.');
    expect(fixture.nativeElement.textContent).not.toContain('Evaluation Task');
    fixture.componentInstance.viewAssignment(3);
    expect(navigation).toHaveBeenLastCalledWith(['/assignment-detail'], { queryParams: { assId: 3 } });
  });
  it('progress has calm empty states and no manufactured course score', () => {
    const fixture = TestBed.createComponent(ProgressComponent); fixture.detectChanges(); flush([course([])]); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No assignments are available for this course yet.');
    expect(fixture.nativeElement.textContent).toContain('No evaluator tasks have been assigned yet.');
  });
  it('finalized outcomes count completion; feedback waiting does not count as passed', () => {
    const metrics = courseMetrics(course([{ ...assignment(), status: 'Passed', completed: true }, { ...assignment(2), status: 'FeedbackRequired' }]));
    expect(metrics).toMatchObject({ passed: 1, completed: 1, total: 2 });
  });
  it('counts passed required rounds once, excluding feedback-required results', () => {
    const pending = { round: 3, displayOutcome: 'Pending' as const, waitingForRematch: false, passedAfterRetry: false };
    const metrics = courseMetrics(course([
      { ...assignment(), evaluationRounds: [
        { ...pending, round: 1, displayOutcome: 'Passed', passedAfterRetry: true },
        { ...pending, round: 2, displayOutcome: 'FeedbackRequired' }, pending,
      ] },
      { ...assignment(2), evaluationRounds: [pending, pending, pending] },
    ]));
    expect(metrics).toMatchObject({ evaluationsPassed: 1, evaluationsTotal: 6 });
  });

});
