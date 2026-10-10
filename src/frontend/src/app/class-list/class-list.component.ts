import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Course, DS } from '../tokens';
import { AssignmentResponse } from '../core/services/course-service/Assignment.service';
import { CourseService } from '../core/services/course-service/course-service';
import { AuthService } from '../services/auth.service';
import { LoadingService } from '../core/services/loading-service/loading.service';
import { ListComponent } from '../shared/list.component';
import { SlicePipe } from '@angular/common';
import { BtnComponent } from '../shared/btn.component';
import { BadgeComponent } from '../shared/badge.component';
import { ProgressBarComponent } from '../shared/progress-bar.component';
import { hasPassedCourse, getProgressLabel, getAssignmentCount } from '../utilities/course-utilities';
import { EnrollService, EnrollmentEligibility} from '../core/services/enroll-service/enroll-service';

@Component({
  selector: 'app-class-list',
  standalone: true,
  imports: [ListComponent, BtnComponent, BadgeComponent, ProgressBarComponent, SlicePipe, TranslateModule],
  template: `
    <div class="page">

      <!-- ── Enrolled classes ──────────────────────────────── -->
      <app-list
        [items]="userCourses()"
        [trackBy]="trackFn"
        [title]="'page_my_classes' | translate"
        [overline]="'page_enrolled' | translate"
        [emptyMessage]="'empty_no_enrolled_classes' | translate"
        [pageSize]="8">
        <ng-template let-course>

          <div class="avail-row">

            <div class="avail-info">

              <div class="avail-name">
                {{ course.name }}
              </div>

              @if (course.description) {
                <div class="course-description">
                  {{ course.description }}
                </div>
              }

              <div class="course-meta">

                @if (
                  (course.externalCourseCodes?.length ?? 0) > 0
                ) {
                  <span>
                    WU courses
                    {{ course.externalCourseCodes!.join(' · ') }}
                  </span>

                  <span>·</span>
                }

                @if (course.term) {
                  <span>
                    {{ course.term }}
                  </span>

                  <span>·</span>
                }

                <span>
                  {{ course.assignments?.length ?? 0 }}
                  assignments
                </span>

              </div>

            </div>

            <app-btn
              variant="secondary"
              size="sm"
              (clicked)="openEnrollModal(course)">
              Enroll →
            </app-btn>

          </div>

        </ng-template>
      </app-list>

      <!-- ── Browse available classes ───────────────────────── -->
      @if (availableClasses().length > 0) {
        <app-list
          [items]="availableClasses()"
          [trackBy]="trackFn"
          [title]="'page_browse_classes' | translate"
          [overline]="'page_available' | translate"
          [pageSize]="8">
          <ng-template let-course>
            <div class="avail-row">
              <div class="avail-info">
                <span class="avail-name">{{ course.name }}</span>
                <span class="avail-meta">
                  {{ 'class_list_assignments_count' | translate:{ count: course.assignments?.length ?? 0 } }}
                  · {{ 'class_list_threshold' | translate:{ threshold: course.pass_threshold } }}
                  @if (course.description) { · {{ course.description | slice:0:60 }}{{ course.description.length > 60 ? '…' : '' }} }
                </span>
              </div>
              <app-btn variant="secondary" size="sm" (clicked)="openEnrollModal(course)">{{ 'btn_enroll' | translate }}</app-btn>
            </div>
          </ng-template>
        </app-list>
      }

      @if (enrollError()) {
        <div class="error-banner">{{ enrollError() }}</div>
      }

      @if (enrollCourse(); as course) {
        <div
          class="modal-backdrop"
          (click)="closeEnrollModal()">
          <div
            class="enroll-modal"
            (click)="$event.stopPropagation()">
            <div class="modal-title">
              Enroll in {{ course.name }}
            </div>
            <div>
              <label class="modal-label">
                UNIVERSITY'S OFFICIAL COURSE NUMBER *
              </label>
              <select
                class="course-code-select"
                [value]="selectedExternalCourseCode()"
                (change)="
                  selectedExternalCourseCode.set(
                    $any($event.target).value
                  )
                ">
                <option
                  value=""
                  disabled>
                  Select your course
                </option>
                @for (
                  code of eligibility()?.availableExternalCourseCodes ?? [];
                  track code
                ) {
                  <option
                    [value]="code"
                    [disabled]="
                      code !==
                      eligibility()
                        ?.allowedExternalCourseCode
                    ">
                    WU course, PI {{ code }}
                  </option>
                }
              </select>
            </div>
            <div class="modal-help">
              This should be the official course number
              of your university in which you are
              officially enrolled.
            </div>
            @if (eligibilityLoading()) {
              <div class="modal-help">
                Checking enrollment eligibility...
              </div>
            }
            @if (
              eligibility() &&
              !eligibility()!.eligible
            ) {
              <div class="modal-error">
                Your account is not authorised to
                enroll in this course.
              </div>
            }
            @if (enrollModalError()) {
              <div class="modal-error">
                {{ enrollModalError() }}
              </div>
            }
            <div class="modal-actions">
              <app-btn
                variant="ghost"
                (clicked)="closeEnrollModal()">
                Cancel
              </app-btn>
              <app-btn
                variant="primary"
                [disabled]="
                  !selectedExternalCourseCode() ||
                  selectedExternalCourseCode() !==
                    eligibility()
                      ?.allowedExternalCourseCode
                "
                (clicked)="confirmEnroll()">
                Enroll
              </app-btn>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .page {
      flex: 1;
      overflow-y: auto;
      padding: 32px;
      display: flex;
      flex-direction: column;
      gap: 40px;
    }

    .course-row {
      padding: 14px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }

    .course-row__main {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
      min-width: 0;
      cursor: pointer;
    }

    .course-row__head {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .course-name {
      font-family: ${DS.fonts.display};
      font-size: 1.0625rem;
      font-weight: 600;
      color: ${DS.colors.fg1};
    }

    .course-meta {
      font-size: 0.8125rem;
      color: ${DS.colors.fg3};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .assignment-drawer {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 4px 18px 16px;
      border-top: 1px solid ${DS.colors.borderSubtle};
    }

    .assignment-empty {
      padding-top: 12px;
      font-size: 0.8125rem;
      color: ${DS.colors.fg3};
    }

    .assignment-row {
      padding-top: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }

    .assignment-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .assignment-name {
      font-size: 0.9375rem;
      font-weight: 600;
      color: ${DS.colors.fg1};
    }

    .assignment-meta {
      font-size: 0.8125rem;
      color: ${DS.colors.fg3};
    }

    .avail-row {
      padding: 14px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }

    .avail-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
      flex: 1;
      min-width: 0;
    }

    .avail-name {
      font-family: ${DS.fonts.display};
      font-size: 1.0625rem;
      font-weight: 600;
      color: ${DS.colors.fg1};
    }

    .avail-meta {
      font-size: 0.8125rem;
      color: ${DS.colors.fg3};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .error-banner {
      font-size: 0.8125rem;
      color: ${DS.colors.red};
      background: ${DS.colors.redSubtle};
      border: 1px solid ${DS.colors.redBorder};
      border-radius: 8px;
      padding: 10px 14px;
    }

    .course-description {
      margin-top: 5px;
      font-size: 0.875rem;
      line-height: 1.45;
      color: ${DS.colors.fg2};
    }

    .course-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 7px;
      font-size: 0.8125rem;
      color: ${DS.colors.fg3};
    }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(0, 0, 0, 0.72);
    }

    .enroll-modal {
      width: min(460px, 100%);
      padding: 26px;
      border: 1px solid ${DS.colors.border};
      border-radius: 14px;
      background: ${DS.colors.surface};
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
    }

    .modal-title {
      margin-bottom: 22px;
      font-family: ${DS.fonts.display};
      font-size: 1.25rem;
      font-weight: 600;
      color: ${DS.colors.fg1};
    }

    .modal-label {
      display: block;
      margin-bottom: 6px;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.07em;
      color: ${DS.colors.fg3};
    }

    .course-code-select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid ${DS.colors.border};
      border-radius: 8px;
      background: ${DS.colors.bg};
      color: ${DS.colors.fg1};
      font: inherit;
    }

    .course-code-select option:disabled {
      color: ${DS.colors.fg3};
    }

    .modal-help {
      margin-top: 10px;
      font-size: 0.8rem;
      line-height: 1.45;
      color: ${DS.colors.fg3};
    }

    .modal-error {
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      color: ${DS.colors.red};
      background: ${DS.colors.redSubtle};
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 24px;
    }
  `],
})
export class ClassListComponent implements OnInit {
  private router        = inject(Router);
  private courseService = inject(CourseService);
  private enrollService = inject(EnrollService);
  private auth          = inject(AuthService);
  private loading       = inject(LoadingService);
  private translate     = inject(TranslateService);

  userCourses  = this.courseService.UserCourses;
  allClasses   = signal<Course[]>([]);
  enrollError  = signal<string | null>(null);
  enrollCourse = signal<Course | null>(null);
  eligibility =  signal<EnrollmentEligibility | null>(null);
  selectedExternalCourseCode =  signal('');
  enrollModalError =  signal<string | null>(null);
  eligibilityLoading = signal(false);

  availableClasses = computed(() => {
    const enrolled = new Set((this.userCourses() ?? []).map(c => c.id));
    return this.allClasses().filter(c => !enrolled.has(c.id));
  });

  ngOnInit() {
    const orgId = this.auth.user()?.orgId;
    if (!orgId) return;

    this.courseService.getClassByOrgId(orgId).subscribe({
      next: (all) => this.allClasses.set(all),
      error: () => {},
    });

    if (this.userCourses() === null) {
      const userId = this.auth.user()?.id;
      if (!userId) return;
      this.enrollService.getStudenEnrolledClasses(userId).subscribe({
        next: (courses) => this.courseService.setUserCourses(courses),
        error: () => {},
      });
    }
  }

  readonly trackFn = (c: Course) => c.id;

  hasPassed(course: Course)       { return hasPassedCourse(course); }
  assignmentCount(course: Course) { return getAssignmentCount(course); }
  progressLabel(course: Course)   { return getProgressLabel(course, this.translate); }

  /** "{n} assignment" / "{n} assignments" — picked at call time so re-evaluates on language change */
  assignmentCountLabel(course: Course): string {
    const count = this.assignmentCount(course);
    const key = count === 1 ? 'class_list_assignment_singular' : 'class_list_assignment_plural';
    return this.translate.instant(key, { count });
  }

  // ── Inline assignment expansion ────────────────────────────
  expandedClass = signal<number | null>(null);

  toggleAssignments(course: Course) {
    this.expandedClass.update(id => id === course.id ? null : course.id);
  }

  openAssignment(a: AssignmentResponse) {
    this.router.navigate(['/assignment-detail'], { queryParams: { assId: a.id } });
  }

  confirmEnroll(): void {
    const course = this.enrollCourse();
    const studentId = this.auth.user()?.id;

    const externalCourseCode =
      this.selectedExternalCourseCode();

    if (
      !course ||
      !studentId ||
      !externalCourseCode
    ) {
      return;
    }

    this.enrollError.set(null);
    this.loading.show();

    this.enrollService.enrollStudent({
      classId: course.id,
      studentId,
      externalCourseCode
    }).subscribe({
      next: () => {
        this.closeEnrollModal();

        this.enrollService
          .getStudenEnrolledClasses(studentId)
          .subscribe({
            next: (courses) => {
              this.courseService
                .setUserCourses(courses);

              this.loading.hide();

              this.router.navigate(
                ['/assignment'],
                {
                  queryParams: {
                    classId: course.id
                  }
                }
              );
            },

            error: () =>
              this.loading.hide()
          });
      },

      error: (err) => {
        this.enrollModalError.set(
          err?.error?.message ??
          'Failed to enroll. Please try again.'
        );

        this.loading.hide();
      }
    });
  }


  openEnrollModal(course: Course): void {
    const studentId = this.auth.user()?.id;

    if (!studentId) return;

    this.enrollCourse.set(course);
    this.eligibility.set(null);
    this.selectedExternalCourseCode.set('');
    this.enrollModalError.set(null);
    this.eligibilityLoading.set(true);

    this.enrollService
      .getEnrollmentEligibility(
        course.id,
        studentId
      )
      .subscribe({
        next: (result) => {
          this.eligibility.set(result);
          this.eligibilityLoading.set(false);
        },

        error: (err) => {
          this.enrollModalError.set(
            err?.error?.message ??
            'Could not check enrollment eligibility.'
          );

          this.eligibilityLoading.set(false);
        }
      });
  }

  closeEnrollModal(): void {
    this.enrollCourse.set(null);
    this.eligibility.set(null);
    this.selectedExternalCourseCode.set('');
    this.enrollModalError.set(null);
    this.eligibilityLoading.set(false);
  }

}