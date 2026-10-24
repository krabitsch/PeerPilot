import { scoreColor as outcomeScoreColor } from '../shared/score-color';
import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { NgStyle } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { DS } from '../tokens';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AvatarComponent } from '../shared/avatar.component';
import { BtnComponent } from '../shared/btn.component';
import { AuthService } from '../services/auth.service';
import { LoadingService } from '../core/services/loading-service/loading.service';
import { EvalService, EvalSection, StartEvaluationResponse, EvaluatorTask, EvaluatorTaskOverview } from '../core/services/eval-service/eval-service';
import { BadgeComponent } from '../shared/badge.component';
import { ContainerComponent, ContainerConfig } from '../shared/container.component';
import { evaluatorTasksFor, evalueeNames } from './evaluator-tasks';
import { MarkdownMathComponent } from '../shared/markdown-math.component';

@Component({
  selector: 'app-evaluation-flow',
  standalone: true,
  imports: [NgStyle, AvatarComponent, BtnComponent, BadgeComponent, ContainerComponent, TranslateModule, MarkdownMathComponent],
  templateUrl: './evaluation-flow.component.html',
  styles: [`
    .overline { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.12em;
      text-transform: uppercase; color: ${DS.colors.cyan}; margin-bottom: 6px; }
    .course-panel { padding: 24px; display: grid; grid-template-columns: 1fr 280px; gap: 24px; }
    .course-name { font-family: ${DS.fonts.display}; font-size: 1.125rem; font-weight: 600; color: ${DS.colors.fg1}; }
    .course-description { color: ${DS.colors.fg2}; font-size: 0.875rem; line-height: 1.6; margin: 8px 0; }
    .filter-stack { display: flex; flex-direction: column; gap: 14px; }
    .task-row { padding: 22px 24px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
    .task-heading, .task-meta { overflow-wrap: anywhere; }
    .task-heading { font-family: ${DS.fonts.display}; font-weight: 600; color: ${DS.colors.fg1}; margin: 6px 0; }
    .task-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .task-meta, .empty-state { color: ${DS.colors.fg2}; font-size: 0.875rem; line-height: 1.6; }
    .empty-state { padding: 28px; text-align: center; }
    .score-row { display: flex; justify-content: space-between; gap: 16px; }
    .feedback-text { white-space: pre-wrap; color: ${DS.colors.fg2}; line-height: 1.6; }
    @media (max-width: 760px) {
      .course-panel { grid-template-columns: 1fr; }
      .task-row { align-items: flex-start; flex-direction: column; }
    }
    .section-card {
      background: ${DS.colors.surface};
      border: 1px solid ${DS.colors.border};
      border-radius: 14px;
      padding: 22px 24px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .section-title {
      font-family: ${DS.fonts.display};
      font-size: 1.125rem;
      font-weight: 700;
      color: ${DS.colors.fg1};
      margin-bottom: 6px;
    }
    .section-desc {
      font-size: 0.9375rem;
      color: ${DS.colors.fg2};
      line-height: 1.6;
    }
    .big-toggle-row {
      display: flex;
      gap: 14px;
    }
    .big-toggle-btn {
      flex: 1;
      padding: 22px 16px;
      border-radius: 12px;
      font-family: ${DS.fonts.display};
      font-size: 1.25rem;
      font-weight: 700;
      cursor: pointer;
      border: 2px solid ${DS.colors.border};
      background: ${DS.colors.surfaceRaised};
      color: ${DS.colors.fg2};
      transition: all 150ms;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .big-toggle-btn:hover { border-color: ${DS.colors.violetBorder}; }
    .big-toggle-pts {
      font-family: ${DS.fonts.mono};
      font-size: 0.8125rem;
      font-weight: 500;
      opacity: 0.75;
    }
    .big-toggle-btn.yes.selected {
      background: ${DS.colors.greenSubtle};
      border-color: ${DS.colors.greenBorder};
      color: ${DS.colors.green};
    }
    .big-toggle-btn.no.selected {
      background: ${DS.colors.redSubtle};
      border-color: ${DS.colors.redBorder};
      color: ${DS.colors.red};
    }
    .big-slider-wrap {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .big-slider-value {
      font-family: ${DS.fonts.display};
      font-size: 2rem;
      font-weight: 700;
      color: ${DS.colors.violet};
    }
    .big-slider-max {
      font-size: 1rem;
      font-weight: 500;
      color: ${DS.colors.fg3};
    }
    .big-slider {
      width: 100%;
      height: 14px;
      border-radius: 999px;
      accent-color: ${DS.colors.violet};
      cursor: pointer;
    }
    .feedback-panel {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px;
    }
    .feedback-card { text-align: center; max-width: 420px; }
  `],
})
export class EvaluationFlowComponent implements OnInit {
  router  = inject(Router);
  private route = inject(ActivatedRoute);
  private auth         = inject(AuthService);
  private evalService  = inject(EvalService);
  private loading      = inject(LoadingService);
  private translate    = inject(TranslateService);

  phase = signal<'overview' | 'start' | 'flow' | 'view'>('overview');
  courses = signal<EvaluatorTaskOverview['courses']>([]);
  tasks = signal<EvaluatorTask[]>([]);
  courseId = signal<number | null>(null);
  assignmentId = signal<number | null>(null);
  readonly outcomeScoreColor = outcomeScoreColor;
  selectedTask = signal<EvaluatorTask | null>(null);
  tasksLoading = signal(false);
  tasksError = signal<string | null>(null);
  starting = signal(false);
  submittingEvaluation = signal(false);
  passkeyInput = signal('');
  loginError = signal<string | null>(null);
  readonly taskNames = evalueeNames;
  readonly flatConfig: ContainerConfig = { variant: 'flat', height: 'auto', scrollable: false };

  selectedCourse = computed(() => this.courses().find(c => c.id === this.courseId()) ?? null);
  assignments = computed(() => [...(this.selectedCourse()?.assignments ?? [])].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id));
  visibleTasks = computed(() => evaluatorTasksFor(this.tasks(), this.courseId(), this.assignmentId()));
  taskCounts = computed(() => {
    const tasks = this.visibleTasks();
    return {
      assigned: tasks.filter(t => t.status !== 'Cancelled').length,
      pending: tasks.filter(t => t.status === 'Pending').length,
      completed: tasks.filter(t => t.status === 'Submitted').length,
      cancelled: tasks.filter(t => t.status === 'Cancelled').length,
    };
  });

  ngOnInit() {
    const id = Number(this.route.snapshot.queryParamMap.get('classId'));
    if (id) this.courseId.set(id);
    this.loadOverview();
  }

  loadOverview() {
    this.tasksLoading.set(true);
    this.tasksError.set(null);
    this.evalService.getMyEvaluatorTasks().subscribe({
      next: ({ courses, tasks }) => {
        this.courses.set(courses);
        this.tasks.set(tasks);
        if (!courses.some(c => c.id === this.courseId())) this.courseId.set(courses[0]?.id ?? null);
        if (!this.assignments().some(a => a.id === this.assignmentId())) this.assignmentId.set(null);
        this.tasksLoading.set(false);
      },
      error: err => {
        this.tasksError.set(err?.error?.error ?? 'Could not load your evaluator tasks.');
        this.tasksLoading.set(false);
      },
    });
  }

  selectCourse(value: string) {
    this.courseId.set(Number(value));
    this.assignmentId.set(null);
    this.backToTasks();
  }

  selectAssignment(value: string) {
    this.assignmentId.set(value ? Number(value) : null);
    this.backToTasks();
  }

  openTask(task: EvaluatorTask) {
    if (task.status === 'Cancelled') return;
    this.selectedTask.set(task);
    this.passkeyInput.set('');
    this.loginError.set(null);
    this.phase.set(task.status === 'Submitted' ? 'view' : 'start');
  }

  backToTasks() {
    this.phase.set('overview');
    this.selectedTask.set(null);
    this.session.set(null);
    this.submitted.set(false);
    this.passkeyInput.set('');
    this.loginError.set(null);
  }

  // ── Phase 2: eval sheet ──────────────────────────────────────
  session   = signal<StartEvaluationResponse | null>(null);
  submitted = signal(false);
  sectionScores = signal<Map<number, number | null>>(new Map());
  comment  = signal('');
  submitError = signal<string | null>(null);

  sections   = computed(() => [...(this.session()?.evalSheet.sections ?? [])].sort((a,b)=>(a.sortOrder??a.id)-(b.sortOrder??b.id)||a.id-b.id));
  maxScore   = computed(() => this.session()?.assignment.max_score ?? 0);
  coreScore = computed(() => this.sections().filter(s=>!s.isBonus).reduce((n,s)=>n+(this.sectionScores().get(s.id)??0),0));
  bonusScore = computed(() => this.sections().filter(s=>s.isBonus).reduce((n,s)=>n+(this.sectionScores().get(s.id)??0),0));
  allScored  = computed(() => this.sections().every(s => this.sectionScores().get(s.id) != null));
  totalScore = computed(() => [...this.sectionScores().values()].reduce((sum: number, v) => sum + (v ?? 0), 0));
  commentOk  = computed(() => this.comment().trim().length >= 100);
  canSubmit  = computed(() => this.allScored() && this.commentOk());

  scoreColor = computed(() => outcomeScoreColor(this.coreScore(), this.maxScore(),
    this.session()?.assignment.pass_threshold ?? 50));

  // Start only the selected, evaluator-owned pairing.
  startEvaluation() {
    const task = this.selectedTask();
    if (!task || task.status !== 'Pending' || this.starting()) return;
    const passkey = this.passkeyInput().trim();
    if (!/^\d{6}$/.test(passkey)) {
      this.loginError.set('Enter the six-digit evaluation passkey.');
      return;
    }
    this.loginError.set(null);
    this.starting.set(true);
    this.evalService.startEvaluation({ evalAssignmentId: task.id, passkey }).subscribe({
      next: res => {
        this.session.set(res);
        const initial = new Map<number, number | null>();
        for (const s of res.evalSheet.sections) initial.set(s.id, s.isBonus || s.sectionType === 'Slider' ? 0 : null);
        this.sectionScores.set(initial);
        this.comment.set('');
        this.submitError.set(null);
        this.submitted.set(false);
        this.phase.set('flow');
        this.starting.set(false);
      },
      error: err => {
        this.loginError.set(err?.error?.error ?? this.translate.instant('eval_cannot_start'));
        this.starting.set(false);
      },
    });
  }

  // ── Grading ──────────────────────────────────────────────────
  setToggle(section: EvalSection, value: boolean) {
    this.sectionScores.update(map => new Map(map).set(section.id, value ? section.marks : 0));
  }

  setSlider(section: EvalSection, value: number) {
    this.sectionScores.update(map => new Map(map).set(section.id, value));
  }

  scoreFor(sectionId: number): number | null {
    return this.sectionScores().get(sectionId) ?? null;
  }

  isToggleSelected(section: EvalSection, value: boolean): boolean {
    const score = this.scoreFor(section.id);
    if (score == null) return false;
    return value ? score === section.marks : score === 0;
  }

  // ── Submit ───────────────────────────────────────────────────
  submit() {
    const session = this.session();
    const evaluatorUserId = this.auth.user()?.id;
    if (!session || !evaluatorUserId || !this.canSubmit() || this.submittingEvaluation() || this.submitted()) return;

    const scores = this.sections().map(s => ({ sectionId: s.id, score: this.scoreFor(s.id) ?? 0 }));

    this.submitError.set(null);
    this.submittingEvaluation.set(true);
    this.loading.show();
    this.evalService.submitEvaluation({
      evalAssignmentId: session.evalAssignmentId,
      comment: this.comment().trim(),
      scores,
    }).subscribe({
      next: () => {
        this.loading.hide();
        this.submitted.set(true);
        this.submittingEvaluation.set(false);
        this.loadOverview();
      },
      error: (err) => {
        this.submittingEvaluation.set(false);
        this.submitError.set(err?.error?.error ?? this.translate.instant('eval_failed'));
        this.loading.hide();
      },
    });
  }

  // Shared styles
  readonly pageStyle = { flex: '1', overflowY: 'auto', padding: '32px', maxWidth: '1120px', width: '100%', boxSizing: 'border-box' as const, display: 'flex', flexDirection: 'column' as const, gap: '20px' };
  readonly crumbStyle = { fontSize: '0.8125rem', color: DS.colors.fg3, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' };
  readonly h1Style = { fontFamily: DS.fonts.display, fontSize: '1.75rem', fontWeight: '700', letterSpacing: '-0.03em', color: DS.colors.fg1, marginBottom: '4px' };
  readonly subStyle = { fontSize: '0.9375rem', color: DS.colors.fg2 };
  readonly subCardStyle = { background: DS.colors.surface, border: `1px solid ${DS.colors.border}`, borderRadius: '12px', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '14px' };
  readonly panelStyle = { background: DS.colors.surface, border: `1px solid ${DS.colors.border}`, borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column' as const, gap: '16px' };
  readonly sectionHeadStyle = { fontFamily: DS.fonts.display, fontSize: '1rem', fontWeight: '600', color: DS.colors.fg1, marginBottom: '4px' };
  readonly textareaStyle = { width: '100%', boxSizing: 'border-box' as const, background: DS.colors.surfaceRaised, border: `1px solid ${DS.colors.border}`, borderRadius: '8px', padding: '14px 16px', fontFamily: DS.fonts.body, fontSize: '0.9375rem', color: DS.colors.fg1, outline: 'none', resize: 'vertical' as const, minHeight: '120px', lineHeight: '1.6' };
  readonly donePgStyle = { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px' };
  readonly doneCardStyle = { textAlign: 'center' as const, maxWidth: '400px' };
  readonly inputStyle = { width: '100%', boxSizing: 'border-box' as const, padding: '9px 12px', background: DS.colors.bg, border: `1px solid ${DS.colors.border}`, borderRadius: DS.radius.md, color: DS.colors.fg1, fontFamily: DS.fonts.body, fontSize: '0.875rem', outline: 'none' };
  readonly fieldLabelStyle = { fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: DS.colors.fg3, marginBottom: '4px', display: 'block' };
  readonly errorStyle = { fontSize: '0.8125rem', color: DS.colors.red, background: DS.colors.redSubtle, border: `1px solid ${DS.colors.redBorder}`, borderRadius: DS.radius.md, padding: `${DS.space[2]} ${DS.space[3]}` };
}
