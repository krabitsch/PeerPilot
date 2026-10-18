import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import type { BadgeVariant, EvaluationOutcome } from '../../tokens';

export type LearningStatus = 'NotStarted' | 'InProgress' | 'FeedbackRequired' | 'Failed' | 'Passed';
export interface LearningAssignment {
  id: number; name: string; created_at: string; status: LearningStatus;
  groupAssigned: boolean; canReply: boolean; submissionState: 'NotSubmitted' | 'Open' | 'Submitted';
  completed: boolean; retryAvailable: boolean;
  evaluationRounds: { round: number; displayOutcome: EvaluationOutcome; waitingForRematch: boolean; pairingPending?: boolean; meetingEvaluator?: { id: number; username: string; email: string } | null; passedAfterRetry: boolean }[];
  evaluatorAssigned: number; evaluatorCompleted: number; evaluatorPending: number;
}
export interface LearningCourse {
  id: number; name: string; description: string; term: string | null; externalCourseCode: string | null;
  assignments: LearningAssignment[];
}
export const learningStatusMeta: Record<LearningStatus, { label: string; variant: BadgeVariant }> = {
  NotStarted: { label: 'Not started', variant: 'pending' },
  InProgress: { label: 'In progress', variant: 'under_review' },
  FeedbackRequired: { label: 'Feedback required', variant: 'reply_needed' },
  Failed: { label: 'Failed', variant: 'failed' },
  Passed: { label: 'Passed', variant: 'validated' },
};
export function courseMetrics(course: LearningCourse | null) {
  const assignments = course?.assignments ?? [];
  return { total: assignments.length, passed: assignments.filter(a => a.status === 'Passed').length,
    evaluationsTotal: assignments.reduce((n, a) => n + a.evaluationRounds.length, 0),
    evaluationsPassed: assignments.reduce((n, a) => n + a.evaluationRounds.filter(r => r.displayOutcome === 'Passed').length, 0),
    completed: assignments.filter(a => a.completed).length,
    evaluatorAssigned: assignments.reduce((n, a) => n + a.evaluatorAssigned, 0),
    evaluatorCompleted: assignments.reduce((n, a) => n + a.evaluatorCompleted, 0) };
}
export function dashboardActions(course: LearningCourse | null) {
  const actions: { label: string; route: string; queryParams?: { assId?: number; classId?: number } }[] = [];
  for (const a of [...(course?.assignments ?? [])].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id)) {
    const label = a.status === 'FeedbackRequired' && a.canReply ? `Respond to feedback on ${a.name}` :
      a.groupAssigned && a.submissionState === 'NotSubmitted' ? `${a.name} is ready for submission` :
      a.submissionState === 'Open' ? `Finish your submission for ${a.name}` :
      a.retryAvailable ? `Review the failed evaluation on ${a.name}` : null;
    if (label) actions.push({ label, route: '/assignment-detail', queryParams: { assId: a.id } });
    for (const round of [...a.evaluationRounds].sort((a, b) => a.round - b.round)) {
      const evaluator = round.meetingEvaluator;
      if (a.groupAssigned && round.displayOutcome === 'Pending' && !round.waitingForRematch && evaluator) {
        actions.push({ label: `Schedule and complete your peer-evaluation session with ${evaluator.username} (${evaluator.email}) for ${a.name} — Round ${round.round}.`,
          route: '/assignment-detail', queryParams: { assId: a.id } });
      }
    }
  }
  const pending = (course?.assignments ?? []).reduce((n, a) => n + a.evaluatorPending, 0);
  if (pending) actions.push({ label: `${pending} evaluator ${pending === 1 ? 'task is' : 'tasks are'} waiting`, route: '/evaluation', queryParams: { classId: course!.id } });
  return actions;
}
export function dashboardInformation(course: LearningCourse | null) {
  const information: { id: string; label: string }[] = [];
  for (const assignment of course?.assignments ?? []) {
    if (!assignment.groupAssigned) {
      information.push({ id: `group:${assignment.id}`, label: `Group assignment for ${assignment.name} is pending.` });
      continue;
    }
    for (const round of assignment.evaluationRounds) {
      const context = `${assignment.name} — Round ${round.round}`;
      if (round.waitingForRematch) {
        information.push({ id: `rematch:${assignment.id}:${round.round}`, label: `Rematching with a new evaluator for ${context} is pending.` });
      } else if (round.pairingPending) {
        information.push({ id: `pairing:${assignment.id}:${round.round}`, label: `Evaluation pairing for ${context} is pending.` });
      } else if (round.displayOutcome === 'FeedbackRequired' && !assignment.canReply) {
        information.push({ id: `reply:${assignment.id}:${round.round}`, label: `Your group leader needs to respond to evaluator feedback for ${context}.` });
      }
    }
  }
  return information;
}

@Injectable({ providedIn: 'root' })
export class LearningSummaryService {
  private http = inject(HttpClient);
  courses = signal<LearningCourse[]>([]);
  courseId = signal<number | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);
  selectedCourse = computed(() => this.courses().find(c => c.id === this.courseId()) ?? null);
  metrics = computed(() => courseMetrics(this.selectedCourse()));
  load() {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<{ courses: LearningCourse[] }>('/api/user/me/learning-summary').subscribe({
      next: ({ courses }) => {
        this.courses.set(courses.map(c => ({ ...c, assignments: [...c.assignments].sort((a,b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id) })));
        if (!courses.some(c => c.id === this.courseId())) this.courseId.set(courses[0]?.id ?? null);
        this.loading.set(false);
      },
      error: err => { this.error.set(err?.error?.error ?? 'Could not load your learning summary.'); this.loading.set(false); },
    });
  }
}
