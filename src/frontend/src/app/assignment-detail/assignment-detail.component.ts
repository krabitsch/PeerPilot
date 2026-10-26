import {fileAllowed, SUBMISSION_MAX_BYTES, AUDIO_MAX_BYTES, SUBMISSION_ACCEPT, AUDIO_ACCEPT, AUDIO_FORMAT_ERROR} from '../shared/upload-formats';
import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { AssignmentInstructionsComponent } from './assignment-instructions.component';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../services/auth.service';
import { CourseService } from '../core/services/course-service/course-service';
import { AssignmentService, AssignmentResponse } from '../core/services/course-service/Assignment.service';
import { GroupService } from '../core/services/group-service/group-service';
import { SubmissionService } from '../core/services/submission-service/submission-service';
import { EnrollService } from '../core/services/enroll-service/enroll-service';
import { EvalService, EvalAssignment } from '../core/services/eval-service/eval-service';
import { LoadingService } from '../core/services/loading-service/loading.service';
import { Group, DS, Submission, EvalResponse } from '../tokens';

import { ContainerComponent, ContainerConfig } from '../shared/container.component';
import { BadgeComponent } from '../shared/badge.component';
import { BtnComponent } from '../shared/btn.component';
import { AvatarComponent } from '../shared/avatar.component';
import { ScorePillComponent } from '../shared/score-pill.component';

import { MarkdownMathComponent } from '../shared/markdown-math.component';

@Component({
  selector: 'app-assignment-detail',
  standalone: true,
  imports: [AssignmentInstructionsComponent, DecimalPipe, ContainerComponent, BadgeComponent, BtnComponent, AvatarComponent, ScorePillComponent, TranslateModule, MarkdownMathComponent],
  templateUrl: './assignment-detail.component.html',
  styles: [`
    .page {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 32px;
      max-width: 860px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .crumb {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8125rem;
      color: ${DS.colors.fg3};
    }
    .crumb-link {
      color: ${DS.colors.violet};
      cursor: pointer;
      transition: opacity 120ms;
    }
    .crumb-link:hover { opacity: 0.75; }
    .hero {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      flex-wrap: wrap;
    }
    .hero-title {
      margin: 0 0 10px;
      font-family: ${DS.fonts.display};
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: ${DS.colors.fg1};
      line-height: 1.15;
    }
    .hero-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .mono-tag {
      font-family: ${DS.fonts.mono};
      font-size: 0.75rem;
      color: ${DS.colors.fg3};
      background: ${DS.colors.surfaceRaised};
      border: 1px solid ${DS.colors.border};
      border-radius: 6px;
      padding: 2px 8px;
    }
    .mono-tag-cyan {
      color: ${DS.colors.cyan};
      background: ${DS.colors.cyanSubtle};
      border-color: ${DS.colors.cyanBorder};
    }
    .mono-tag-amber {
      color: ${DS.colors.amber};
      background: ${DS.colors.amberSubtle};
      border-color: ${DS.colors.amberBorder};
    }
    .mono-tag-violet {
      color: ${DS.colors.violet};
      background: ${DS.colors.violetSubtle};
      border-color: ${DS.colors.violetBorder};
    }
    .mono-tag-green {
      color: ${DS.colors.green};
      background: ${DS.colors.greenSubtle};
      border-color: ${DS.colors.greenBorder};
    }

    /* Subject file */
    .subject-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 20px;
    }
    .subject-info { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .subject-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: ${DS.radius.md};
      background: ${DS.colors.violetSubtle};
      border: 1px solid ${DS.colors.violetBorder};
      color: ${DS.colors.violet};
      flex-shrink: 0;
    }
    .subject-name {
      font-size: 0.9375rem;
      font-weight: 500;
      color: ${DS.colors.fg1};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .subject-meta {
      font-size: 0.75rem;
      color: ${DS.colors.fg3};
    }
    .subject-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 20px;
    }
    .subject-info { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .subject-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: ${DS.radius.md};
      background: ${DS.colors.violetSubtle};
      border: 1px solid ${DS.colors.violetBorder};
      color: ${DS.colors.violet};
      flex-shrink: 0;
    }
    .subject-name {
      font-size: 0.9375rem;
      font-weight: 500;
      color: ${DS.colors.fg1};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .subject-meta {
      font-size: 0.75rem;
      color: ${DS.colors.fg3};
    }
    .desc-body { padding: 18px 20px; }
    .desc-label {
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: ${DS.colors.violet};
      margin-bottom: 8px;
    }
    .desc-text {
      margin: 0;
      font-size: 0.9375rem;
      color: ${DS.colors.fg2};
      line-height: 1.75;
    }
    .two-col {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      align-items: stretch;
    }
    .two-col app-container {
      display: flex;
      flex-direction: column;
    }
    .two-col app-container ::ng-deep > div {
      flex: 1;
      min-height: 0;
    }
    .card-inner {
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      height: 100%;
      box-sizing: border-box;
    }
    .card-inner .action-row {
      margin-top: auto;
    }
    .card-title {
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: ${DS.colors.fg3};
      margin-bottom: 2px;
    }
    .hint-text {
      margin: 0;
      font-size: 0.875rem;
      color: ${DS.colors.fg3};
    }
    .members-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .member-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 8px;
      background: ${DS.colors.bg};
    }
    .member-name {
      font-size: 0.875rem;
      color: ${DS.colors.fg1};
      font-weight: 500;
      flex: 1;
    }
    .invite-item {
      padding: 10px 12px;
      border-radius: 8px;
      background: ${DS.colors.violetSubtle};
      border: 1px solid ${DS.colors.violetBorder};
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    .invite-from {
      font-size: 0.8125rem;
      color: ${DS.colors.fg3};
    }
    .invite-btns { display: flex; gap: 6px; }
    .submission-card { gap: 10px; }
    .submission-closed-title {
      font-size: 0.9375rem;
      font-weight: 600;
      color: ${DS.colors.fg1};
    }
    .upload-panel {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 14px;
      border: 1px solid ${DS.colors.border};
      border-radius: ${DS.radius.lg};
      background: ${DS.colors.surface};
      margin-top: auto;
    }
    .upload-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .upload-meta {
      font-size: 0.75rem;
      color: ${DS.colors.fg3};
      margin-left: auto;
      white-space: nowrap;
    }
    .upload-picker {
      position: relative;
      overflow: hidden;
      display: inline-flex;
    }
    .file-input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
      font-size: 0;
    }
    .upload-error {
      font-size: 0.8125rem;
      color: ${DS.colors.red};
      background: ${DS.colors.redSubtle};
      border: 1px solid ${DS.colors.redBorder};
      border-radius: ${DS.radius.md};
      padding: 9px 12px;
    }
    /* Evaluations */
    .evaluations-inner {
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .evaluation-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .evaluation-row {
      display: grid;
      grid-template-columns: minmax(120px, 0.8fr) minmax(170px, 1.35fr) minmax(150px, 1fr) minmax(110px, auto);
      align-items: center;
      gap: 14px;
      padding: 12px 14px;
      border-radius: ${DS.radius.lg};
      background: ${DS.colors.surface};
      border: 1px solid ${DS.colors.border};
    }
    .evaluation-row.before-close { grid-template-columns: minmax(120px, .8fr) minmax(170px, 1.35fr) minmax(110px, auto); }
    .evaluation-round {
      font-family: ${DS.fonts.display};
      font-size: 0.9375rem;
      font-weight: 600;
      color: ${DS.colors.fg1};
    }
    .evaluation-evaluator {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .evaluation-label {
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: ${DS.colors.fg3};
    }
    .evaluation-value {
      font-size: 0.875rem;
      color: ${DS.colors.fg1};
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .evaluation-passkey {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 8px 11px;
      border-radius: ${DS.radius.md};
      background: ${DS.colors.violetSubtle};
      border: 1px solid ${DS.colors.violetBorder};
    }
    .evaluation-passkey-label {
      font-size: 0.625rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: ${DS.colors.fg2};
    }
    .evaluation-passkey-value {
      font-family: ${DS.fonts.mono};
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: ${DS.colors.violet};
    }
    .evaluation-status {
      justify-self: end;
      font-family: ${DS.fonts.mono};
      font-size: 0.75rem;
      font-weight: 600;
      white-space: nowrap;
      padding: 4px 8px;
      border-radius: ${DS.radius.full};
      border: 1px solid ${DS.colors.border};
      background: ${DS.colors.surfaceRaised};
      color: ${DS.colors.fg3};
    }
    .evaluation-status.pending {
      color: ${DS.colors.amber};
      background: ${DS.colors.amberSubtle};
      border-color: ${DS.colors.amberBorder};
    }
    .evaluation-status.passed {
      color: ${DS.colors.green};
      background: ${DS.colors.greenSubtle};
      border-color: ${DS.colors.greenBorder};
    }
    .evaluation-status.failed {
      color: ${DS.colors.red};
      background: ${DS.colors.redSubtle};
      border-color: ${DS.colors.redBorder};
    }
    .evaluation-retry {
      margin-top: 8px;
      color: ${DS.colors.amber};
      font-size: 0.875rem;
    }

    .evaluation-status.cancelled,
    .evaluation-status.not-assigned {
      color: ${DS.colors.fg3};
      background: ${DS.colors.surfaceRaised};
      border-color: ${DS.colors.border};
    }

    @media (max-width: 760px) {
      .evaluation-row, .evaluation-row.before-close {
        grid-template-columns: 1fr;
        gap: 8px;
      }
      .evaluation-status {
        justify-self: start;
      }
    }

    .staff-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    .sstat {
      padding: 16px 18px;
      background: ${DS.colors.surface};
      border: 1px solid ${DS.colors.border};
      border-radius: ${DS.radius.lg};
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .sstat-label {
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: ${DS.colors.fg3};
    }
    .sstat-value {
      font-family: ${DS.fonts.display};
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: ${DS.colors.fg1};
    }
    .sub-row {
      padding: 14px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .sub-row-left { display: flex; align-items: center; gap: 10px; }
    .sub-group-name { font-weight: 600; color: ${DS.colors.fg1}; font-size: 0.9375rem; }
    .sub-members { font-size: 0.8125rem; color: ${DS.colors.fg3}; }
    .sub-row-right { display: flex; align-items: center; gap: 12px; }
    .not-found {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      overflow-y: auto;
      padding: 32px;
    }
    .not-found-icon { font-size: 3rem; margin-bottom: 12px; }
    .not-found-title { font-family: ${DS.fonts.display}; font-size: 1.25rem; font-weight: 600; color: ${DS.colors.fg1}; margin-bottom: 6px; }
    .not-found-sub { font-size: 0.875rem; color: ${DS.colors.fg3}; margin-bottom: 20px; }
    .section-title {
      font-family: ${DS.fonts.display};
      font-size: 1rem;
      font-weight: 600;
      color: ${DS.colors.fg1};
      margin: 0;
    }
    .action-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .name-input {
      width: 100%;
      box-sizing: border-box;
      padding: 9px 12px;
      background: ${DS.colors.bg};
      border: 1px solid ${DS.colors.border};
      border-radius: ${DS.radius.md};
      color: ${DS.colors.fg1};
      font-family: ${DS.fonts.body};
      font-size: 0.875rem;
      outline: none;
      transition: border-color 150ms;
    }
    .name-input::placeholder { color: ${DS.colors.fg3}; }
    .name-input:focus { border-color: ${DS.colors.violet}; }
    .file-preview {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: ${DS.radius.md};
      border: 1px solid ${DS.colors.cyanBorder};
      background: ${DS.colors.cyanSubtle};
    }
    .file-preview-ext {
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      border-radius: 6px;
      background: ${DS.colors.cyan};
      color: ${DS.colors.bg};
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: ${DS.fonts.mono};
      font-size: 0.625rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .file-preview-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .file-preview-name {
      font-size: 0.875rem;
      font-weight: 600;
      color: ${DS.colors.fg1};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .file-preview-meta {
      font-size: 0.75rem;
      color: ${DS.colors.fg3};
      font-family: ${DS.fonts.mono};
    }
    .file-preview-clear {
      flex-shrink: 0;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: 1px solid ${DS.colors.border};
      color: ${DS.colors.fg3};
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 120ms;
    }
    .file-preview-clear:hover {
      background: ${DS.colors.redSubtle};
      border-color: ${DS.colors.redBorder};
      color: ${DS.colors.red};
    }
    /* Grade & feedback */
    .grade-inner {
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .grade-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .feedback-item {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px 16px;
      border-radius: ${DS.radius.lg};
      background: ${DS.colors.surface};
      border: 1px solid ${DS.colors.border};
    }
    .feedback-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .feedback-evaluator {
      font-weight: 600;
      font-size: 0.875rem;
      color: ${DS.colors.fg1};
    }
    .feedback-marks {
      font-family: ${DS.fonts.mono};
      font-size: 0.8125rem;
      color: ${DS.colors.fg3};
    }
    .feedback-comment {
      margin: 0;
      font-size: 0.875rem;
      color: ${DS.colors.fg2};
      line-height: 1.6;
    }
    .feedback-reply {
      padding-top: 8px;
      border-top: 1px solid ${DS.colors.borderSubtle};
    }
    .feedback-reply-label {
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: ${DS.colors.violet};
      margin-bottom: 4px;
    }
    .feedback-reply-text {
      margin: 0;
      font-size: 0.875rem;
      color: ${DS.colors.fg2};
      line-height: 1.6;
    }
    .feedback-reply-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 8px;
      border-top: 1px solid ${DS.colors.borderSubtle};
    }
    .feedback-reply-input {
      width: 100%;
      box-sizing: border-box;
      min-height: 64px;
      padding: 8px 10px;
      background: ${DS.colors.bg};
      border: 1px solid ${DS.colors.border};
      border-radius: ${DS.radius.md};
      color: ${DS.colors.fg1};
      font-family: ${DS.fonts.body};
      font-size: 0.8125rem;
      resize: vertical;
      outline: none;
    }
    .desc-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 8px;
    }

    .desc-header .desc-label {
      margin-bottom: 0;
    }

    .assignment-file-link {
      font-size: 0.8125rem;
      color: ${DS.colors.violet};
      text-decoration: none;
      white-space: nowrap;
    }

    .assignment-file-link:hover {
      text-decoration: underline;
    }
    .card-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .group-size-note {
      font-size: 0.75rem;
      color: ${DS.colors.fg3};
    }
  `],
})
export class AssignmentDetailComponent implements OnInit {
  readonly submissionAccept = SUBMISSION_ACCEPT;
  readonly audioAccept = AUDIO_ACCEPT;

  private auth          = inject(AuthService);
  private route         = inject(ActivatedRoute);
  private translate     = inject(TranslateService);
  router                = inject(Router);
  private assService    = inject(AssignmentService);
  private courseService = inject(CourseService);
  private groupService  = inject(GroupService);
  private subService    = inject(SubmissionService);
  private enrollService = inject(EnrollService);
  private evalService   = inject(EvalService);
  private loading       = inject(LoadingService);

  readonly role    = this.auth.role;
  readonly user    = this.auth.user;
  readonly isStaff = computed(() => this.role() === 'Bocal' || this.role() === 'Admin');

  isEnrolled  = signal(false);
  viewAsStaff = computed(() => this.isStaff() && !this.isEnrolled());

  assignment    = signal<AssignmentResponse | null>(null);
  className     = signal<string | null>(null);
  notFound      = signal(false);

  // Student state
  myGroup         = signal<Group | null>(null);
  mySubmission    = signal<Submission | null>(null);
  myInvites       = signal<any[]>([]);
  actionError     = signal<string | null>(null);
  submissionError = signal<string | null>(null);
  selectedFile = signal<File | null>(null);
  uploadingFile = signal(false);
  uploadedFileMeta = signal<{ name: string; size: string; ext: string; type: string } | null>(null);
  myEvaluators = signal<EvalAssignment[]>([]);
  myResponses  = signal<EvalResponse[]>([]);
  replyDrafts  = signal<Map<number, string>>(new Map());
  replyError   = signal<string | null>(null);
  replyRecordings = signal<Map<number, File>>(new Map());
  replying = signal(false);

  // Staff state
  allSubs = signal<Submission[]>([]);

  groupStatus = computed<'no-group' | 'has-invites' | 'in-group'>(() => {
    if (this.myGroup()) return 'in-group';
    if (this.myInvites().length > 0) return 'has-invites';
    return 'no-group';
  });

  isLeader = computed(() => {
    const group = this.myGroup();
    return !!group && group.leaderId === this.currentUserId();
  });

  retryError = signal<string | null>(null);
  requestingRetry = signal<number | null>(null);

  statusBadge = computed(() => {
    const sub = this.mySubmission();
    if (!sub) return 'pending' as const;
    if (sub.status !== 'Close') return 'submitted' as const;
    if (sub.workflowStatus === 'FeedbackRequired') return 'reply_needed' as const;
    if (sub.passed === true) return 'validated' as const;
    if (sub.passed === false) return 'failed' as const;
    return 'under_review' as const;
  });

  statusLabel = computed(() => {
    const sub = this.mySubmission();
    if (!sub) return 'Not started';
    if (sub.status === 'Close' && sub.workflowStatus === 'FeedbackRequired') return 'Feedback required';
    if (sub.status === 'Close' && sub.passed === true) return 'Passed';
    if (sub.status === 'Close' && sub.passed === false) return 'Failed';
    return 'In progress';
  });

  // The backend chooses the current attempt and computes round/assignment
  // outcomes; this page only joins those IDs to display data.
  evaluationRows = computed(() => {
    const summaries = this.mySubmission()?.evaluationRounds ?? [];
    const pairings = this.myEvaluators();
    const closed = this.mySubmission()?.status === 'Close';
    const rounds = closed
      ? Array.from({ length: this.assignment()?.req_eval ?? 0 }, (_, i) => i + 1)
      : [...new Set(pairings.filter(p => p.status !== 'Cancelled').map(p => p.round))].sort((a, b) => a - b);
    return rounds.map(round => {
      const summary = summaries.find(r => r.round === round);
      return {
        round,
        outcome: summary?.displayOutcome ?? 'Pending',
        waitingForRematch: summary?.waitingForRematch ?? false,
        pairing: closed ? pairings.find(p => p.id === summary?.evalAssignmentId) ?? null
          : pairings.filter(p => p.round === round && p.status !== 'Cancelled')
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id)[0] ?? null,
      };
    });
  });

  feedbackRows = computed(() => {
    const responses = this.myResponses();
    const pairings = this.myEvaluators();
    const rows = this.evaluationRows().flatMap(row => {
      const attempts = pairings.filter(p => p.round === row.round && p.evalResponseId != null)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id);
      if (!attempts.length) return [{ label: `Evaluation ${row.round}`, response: null as EvalResponse | null, outcome: 'Pending' }];
      return attempts.map((p, i) => ({
        label: `Evaluation ${row.round}${attempts.length > 1 ? ` · Attempt ${i + 1}` : ''}`,
        response: responses.find(r => r.id === p.evalResponseId) ?? null,
        outcome: p.studentOutcome ?? 'Pending',
      }));
    });
    const linkedIds = new Set(pairings.map(p => p.evalResponseId));
    for (const response of responses.filter(r => !linkedIds.has(r.id))) {
      rows.push({ label: response.isStaffReview ? 'Staff feedback' : 'Additional feedback', response, outcome: '' });
    }
    return rows;
  });

  requestRetry(pairing: EvalAssignment) {
    if (this.requestingRetry() !== null) return;
    this.retryError.set(null);
    this.requestingRetry.set(pairing.id);
    this.evalService.requestRetry(pairing.id).subscribe({
      next: () => {
        this.requestingRetry.set(null);
        const id = this.assignment()?.id;
        if (id) this.loadSubmissions(id);
      },
      error: err => {
        this.requestingRetry.set(null);
        this.retryError.set(err?.error?.error ?? 'Could not request an evaluation retry.');
      },
    });
  }

  evalPassKey(pairing: EvalAssignment | null): string {
    if (!pairing) return '—';

    const value = pairing.passKey;

    return value ? String(value) : '—';
  }

  selectedFileMeta = computed(() => {
    const file = this.selectedFile();
    if (!file) return null;
    return {
      name: file.name,
      size: this.formatFileSize(file.size),
      ext: file.name.includes('.') ? file.name.split('.').pop()!.toUpperCase() : '?',
      type: file.type || 'unknown',
    };
  });

  private currentUserId() {
    const user = this.user() as { id?: number; userId?: number } | null;
    return user?.id ?? user?.userId ?? null;
  }

  submissionFiles = computed(() => this.mySubmission()?.files ?? (this.mySubmission()?.file ? [this.mySubmission()!.file!] : []));

  downloadSubmissionFile(fileId: number) {
    const group = this.myGroup();
    if (!group) return;
    this.subService.getDownloadUrl(group.id, undefined, fileId).subscribe({
      next: result => window.open(result.url, '_blank', 'noopener'),
      error: err => this.submissionError.set(err?.error?.error ?? 'Could not open submission file.'),
    });
  }

  submittedFileMeta(submission: Submission | null) {
    const local = this.uploadedFileMeta();
    if (local) return local;
    const file = submission?.file;
    if (!file) return null;
    return {
      name: file.name,
      size: this.formatFileSize(file.size),
      ext: file.name.includes('.') ? file.name.split('.').pop()!.toUpperCase() : '?',
      type: file.mimiType || 'unknown',
    };
  }

  staffGroupCount = computed(() => new Set(this.allSubs().map((s) => s.groupId)).size);
  staffSubmittedCount = computed(() => this.allSubs().filter((s) => s.status === 'Close').length);
  staffAvgScore = computed(() => {
    const scored = this.allSubs().filter((s) => s.finalScore != null);
    if (!scored.length) return null;
    return Math.round(scored.reduce((a, s) => a + (s.finalScore ?? 0), 0) / scored.length);
  });

  readonly flatConfig: ContainerConfig = { variant: 'flat', height: 'auto', scrollable: false };
  readonly cardConfig: ContainerConfig = { variant: 'card', height: 'auto', scrollable: false };

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      const id = parseInt(params['assId'], 10);
      if (!id) { this.notFound.set(true); return; }
      this.load(id);
    });
  }

  private load(id: number) {
    this.loading.show();
    this.myGroup.set(null);
    this.mySubmission.set(null);
    this.myInvites.set([]);
    this.allSubs.set([]);
    this.myEvaluators.set([]);
    this.myResponses.set([]);
    this.replyDrafts.set(new Map());
    this.replyRecordings.set(new Map());
    this.replyError.set(null);
    this.retryError.set(null);
    this.actionError.set(null);
    this.isEnrolled.set(false);

    this.assService.getAssignmentById(id).subscribe({
      next: (a) => {
        this.assignment.set(a);
        this.courseService.getClass(a.classid).subscribe({
          next: (c) => this.className.set(c.name),
          error: () => {},
        });

        const userId = this.user()?.id;
        const enrollment$ = (this.isStaff() && userId)
          ? this.enrollService.getStudenEnrolledClasses(userId)
          : of([]);

        enrollment$.subscribe({
          next: (courses) => {
            if (this.isStaff()) this.isEnrolled.set(courses.some(c => c.id === a.classid));
            this.loadSubmissions(id);
          },
          error: () => this.loadSubmissions(id),
        });
      },
      error: () => { this.notFound.set(true); this.loading.hide(); },
    });
  }

  private loadSubmissions(id: number) {
    this.subService.getSubmissionsForAssignment(id).subscribe({
      next: (subs: any[]) => {
        if (this.viewAsStaff()) {
          this.allSubs.set(subs);
          this.loading.hide();
        } else {
          const userId = this.user()?.id;
          const mine = subs.find(s => s.group?.members?.some((m: any) => m.userId === userId));
          if (mine) {
            this.myGroup.set(mine.group);
            this.mySubmission.set(mine);
            this.loadEvaluators(id, mine.groupId, mine);
            this.loading.hide();
          } else if (userId) {
            this.groupService.getMyGroupForAssignment(userId, id).subscribe({
              next: (group: any) => {
                if (group) {
                  this.myGroup.set(group);
                  const existingSubmission = subs.find(sub => sub.groupId === group.id);
                  if (existingSubmission) {
                    this.mySubmission.set(existingSubmission);
                  }
                  this.loadEvaluators(id, group.id, existingSubmission);
                  this.loading.hide();
                } else {
                  this.groupService.getInvites({ userId }).subscribe({
                    next: (invites) => { this.myInvites.set(invites); this.loading.hide(); },
                    error: () => this.loading.hide(),
                  });
                }
              },
              error: () => {
                this.groupService.getInvites({ userId }).subscribe({
                  next: (invites) => { this.myInvites.set(invites); this.loading.hide(); },
                  error: () => this.loading.hide(),
                });
              },
            });
          } else {
            this.loading.hide();
          }
        }
      },
      error: () => this.loading.hide(),
    });
  }

  /** Pairings are available before submission; feedback remains closed-only. */
  private loadEvaluators(assignmentId: number, groupId: number, submission?: Submission) {
    this.evalService.getEvalAssignments(assignmentId).subscribe({
      next: (assignments) => {
        this.myEvaluators.set(assignments.filter(ea => ea.evalueeGroupId === groupId));
      },
      error: () => this.myEvaluators.set([]),
    });

    if (submission?.status !== 'Close') { this.myResponses.set([]); return; }
    this.evalService.getResponsesForSubmission(submission.id).subscribe({
      next: (responses) => this.myResponses.set(responses),
      error: () => this.myResponses.set([]),
    });
  }

  replyDraft(responseId: number): string {
    return this.replyDrafts().get(responseId) ?? '';
  }

  setReplyDraft(responseId: number, value: string) {
    this.replyDrafts.update(map => new Map(map).set(responseId, value));
  }

  // Fetch a presigned URL for the evaluation recording and open it in a new tab.
  playRecording(responseId: number) {
    this.evalService.getRecordingUrl(responseId).subscribe({
      next: (res) => window.open(res.url, '_blank', 'noopener'),
      error: () => this.replyError.set('Could not load the recording.'),
    });
  }

  onReplyRecordingSelected(responseId: number, event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    this.replyError.set(null);
    const invalid = file && (!fileAllowed(file.name,file.type,true) ? AUDIO_FORMAT_ERROR :
      file.size > AUDIO_MAX_BYTES ? 'Audio recording is too large. The maximum size is 200 MB.' : null);
    if (invalid) {
      this.replyError.set(invalid);
      (event.target as HTMLInputElement).value = '';
    }
    this.replyRecordings.update(map => {
      const next = new Map(map);
      if (file && !invalid) next.set(responseId, file); else next.delete(responseId);
      return next;
    });
  }

  submitReply(response: EvalResponse) {
    if (this.replying()) return;
    const userId = this.currentUserId();
    const reply = (this.replyDraft(response.id) || response.reply || "").trim();
    const recording = this.replyRecordings().get(response.id);
    if (!userId) return;
    if (!reply) { this.replyError.set(this.translate.instant('error_reply_required')); return; }

    if (!response.isStaffReview && !response.recordingFile && !recording) {
      this.replyError.set('Upload the evaluation recording with your feedback response.');
      return;
    }
    this.replyError.set(null);
    this.replying.set(true);
    this.loading.show();
    this.evalService.replyToResponse(response.id, { userId, reply, recording }).subscribe({
      next: (updated) => {
        this.replying.set(false);
        this.myResponses.update(list => list.map(r => r.id === updated.id ? { ...r, ...updated } : r));
        this.replyRecordings.update(map => { const next = new Map(map); next.delete(response.id); return next; });
        this.replyDrafts.update(map => { const m = new Map(map); m.delete(response.id); return m; });
        const assId = this.assignment()?.id;
        // loadSubmissions hides the loading indicator itself once it settles (refreshes finalScore/passed too).
        if (assId) this.loadSubmissions(assId);
        else this.loading.hide();
      },
      error: (err) => {
        this.replying.set(false);
        this.replyError.set(err?.error?.error ?? 'Failed to submit reply.');
        this.loading.hide();
      },
    });
  }

  acceptInvite(inviteId: number) {
    const userId = this.currentUserId();
    if (!userId) return;
    this.actionError.set(null);
    this.submissionError.set(null);
    this.loading.show();
    this.groupService.respondToInvite(inviteId, { userId, status: 'Accepted' }).subscribe({
      next: (res: any) => {
        if (res.group) this.myGroup.set(res.group);
        this.myInvites.set([]);
        this.loading.hide();
      },
      error: (err) => {
        this.actionError.set(err?.error?.error ?? err?.error?.message ?? this.translate.instant('error_accept_invite_failed'));
        this.loading.hide();
      },
    });
  }

  declineInvite(inviteId: number) {
    const userId = this.currentUserId();
    if (!userId) return;
    this.groupService.respondToInvite(inviteId, { userId, status: 'Declined' }).subscribe({
      next: () => this.myInvites.update(inv => inv.filter(i => i.id !== inviteId)),
      error: () => {},
    });
  }

  startSubmission() {
    const a = this.assignment();
    const group = this.myGroup();
    const userId = this.currentUserId();
    if (!a || !group || !userId) return;
    this.actionError.set(null);
    this.submissionError.set(null);
    this.selectedFile.set(null);
    this.loading.show();
    this.subService.createSubmission({ groupId: group.id, userId, type: 'FILE' }).subscribe({
      next: (sub) => { this.mySubmission.set(sub); this.loading.hide(); },
      error: (err) => {
        const body = err?.error ?? err?.message ?? err;
        this.actionError.set(typeof body === 'string' ? body : JSON.stringify(body));
        this.loading.hide();
      },
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    this.actionError.set(null);
    this.submissionError.set(null);
    const validationError = this.validateSubmissionFile(file);
    if (validationError) {
      this.selectedFile.set(null);
      this.submissionError.set(validationError);
      return;
    }
    this.selectedFile.set(file);
    this.uploadSelectedFile();
  }

  uploadSelectedFile() {
    const file = this.selectedFile();
    const group = this.myGroup();
    const userId = this.currentUserId();
    if (!file || !group || !userId) return;

    const meta = this.selectedFileMeta();
    this.actionError.set(null);
    this.submissionError.set(null);
    this.uploadingFile.set(true);
    this.loading.show();
    const upload = this.mySubmission()?.status === 'Close'
      ? this.subService.uploadRetryFile(group.id, file)
      : this.subService.uploadFile(group.id, userId, file);
    upload.subscribe({
      next: (sub) => {
        this.mySubmission.set(sub);
        this.selectedFile.set(null);
        this.uploadedFileMeta.set(meta);
        this.uploadingFile.set(false);
        this.loading.hide();
      },
      error: (err) => {
        const body = err?.error ?? err?.message ?? err;
        this.submissionError.set(typeof body === 'string' ? body : JSON.stringify(body));
        this.uploadingFile.set(false);
        this.loading.hide();
      },
    });
  }

  closeSubmission() {
    const group = this.myGroup();
    const userId = this.currentUserId();
    if (!group || !userId) return;
    if (!confirm(this.translate.instant('confirm_close_submission'))) return;
    this.actionError.set(null);
    this.submissionError.set(null);
    this.loading.show();
    this.subService.closeSubmission(group.id, { userId }).subscribe({
      next: (sub) => {
        this.mySubmission.set(sub);
        const assId = this.assignment()?.id;
        if (assId) this.loadEvaluators(assId, group.id, sub);
        this.loading.hide();
      },
      error: (err) => {
        this.actionError.set(err?.error?.error ?? err?.error?.message ?? this.translate.instant('error_close_submission_failed'));
        this.loading.hide();
      },
    });
  }

  private validateSubmissionFile(file: File): string | null {
    if (!fileAllowed(file.name,file.type,false)) {
      return 'Unsupported file type. Please upload a supported document, image, or archive.';
    }
    if (file.size > SUBMISSION_MAX_BYTES) {
      return this.translate.instant('error_file_too_large');
    }
    return null;
  }

  goToClasses() {
    if (this.viewAsStaff()) this.router.navigate(['/bocal/classes']);
    else this.router.navigate(['/classes']);
  }

  goToClass() {
    const a = this.assignment();
    if (!a) return;
    if (this.viewAsStaff()) this.router.navigate(['/bocal/classes'], { queryParams: { classId: a.classid } });
    else this.router.navigate(['/assignment'], { queryParams: { classId: a.classid } });
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  subStatusVariant(status: string): 'submitted' | 'validated' | 'under_review' | 'pending' {
    if (status === 'Open') return 'submitted';
    return 'under_review';
  }
}