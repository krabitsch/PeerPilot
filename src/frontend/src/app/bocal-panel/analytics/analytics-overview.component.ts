import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { AuthService } from '../../services/auth.service';
import { CourseService } from '../../core/services/course-service/course-service';
import {
  AssignmentService,
  AssignmentResponse
} from '../../core/services/course-service/Assignment.service';

import { GroupService } from '../../core/services/group-service/group-service';
import { EvalService } from '../../core/services/eval-service/eval-service';

interface CourseOption {
  id: number;
  name: string;
}

interface GroupSummary {
  id: number;
}

interface PairingSummary {
  round: number;
  status: string;
}

interface RoundProgress {
  round: number;
  assigned: number;
  completed: number;
}

interface AssignmentCard {
  id: number;
  name: string;
  requiredEvals: number;
  groupCount: number | null;

  assigned: number;
  completed: number;

  rounds: RoundProgress[];
  dataError: boolean;
}

@Component({
  selector: 'app-analytics-overview',
  standalone: true,
  templateUrl: './analytics-overview.component.html',
  styleUrls: ['./analytics-overview.component.css']
})
export class AnalyticsOverviewComponent implements OnInit {

  private auth = inject(AuthService);
  private courseService = inject(CourseService);
  private assignmentService = inject(AssignmentService);
  private groupService = inject(GroupService);
  private evalService = inject(EvalService);

  private route = inject(ActivatedRoute);
  private router = inject(Router);

  courses = signal<CourseOption[]>([]);
  selectedCourseId = signal<number | null>(null);

  cards = signal<AssignmentCard[]>([]);

  loadingCourses = signal(false);
  loadingAssignments = signal(false);
  error = signal<string | null>(null);

  // Preserve the selection supplied by the URL.
  private requestedCourseId: number | null = null;

  // Prevent an older API response from overwriting a new selection.
  private loadToken = 0;


  ngOnInit(): void {

    this.route.queryParamMap.subscribe(params => {

      const raw = params.get('classId');
      const id = raw ? Number(raw) : null;

      this.requestedCourseId =
        id !== null && Number.isInteger(id) && id > 0
          ? id
          : null;

      this.applyCourseSelection();
    });

    this.loadCourses();
  }


  private loadCourses(): void {

    const orgId = this.auth.user()?.orgId;

    if (!orgId) {
      this.error.set('Could not identify your organization.');
      return;
    }

    this.loadingCourses.set(true);
    this.error.set(null);

    this.courseService.getClassByOrgId(orgId).subscribe({

      next: courses => {

        this.courses.set(
          courses.map(c => ({
            id: c.id,
            name: c.name
          }))
        );

        this.loadingCourses.set(false);

        this.applyCourseSelection();
      },

      error: () => {
        this.loadingCourses.set(false);
        this.error.set('Failed to load courses.');
      }

    });
  }


  private applyCourseSelection(): void {

    const courses = this.courses();

    if (courses.length === 0) return;

    const selected =
      courses.find(c => c.id === this.requestedCourseId)
      ?? courses[0];

    // Don't reload if the same course is already selected.
    if (this.selectedCourseId() === selected.id) return;

    this.selectedCourseId.set(selected.id);

    this.loadAssignmentCards(selected.id);
  }


  onCourseChanged(value: string): void {

    const classId = Number(value);

    if (!Number.isInteger(classId)) return;

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        classId,
        assId: null
      },
      queryParamsHandling: 'merge'
    });
  }

  openAssignmentAnalytics(assignmentId: number): void {
  const classId = this.selectedCourseId();

  if (classId === null) return;

  this.router.navigate(['/bocal/analytics/assignment'], {
    queryParams: {
      classId,
      assId: assignmentId
    }
  });
}


  private loadAssignmentCards(classId: number): void {

    const token = ++this.loadToken;

    this.cards.set([]);
    this.error.set(null);
    this.loadingAssignments.set(true);

    this.assignmentService.getAssignments(classId).subscribe({

      next: assignments => {

        if (token !== this.loadToken) return;

        if (assignments.length === 0) {
          this.loadingAssignments.set(false);
          return;
        }

        // Load groups and evaluation pairings
        // separately for each assignment.
        const requests = assignments.map(a =>

          forkJoin({

            groups:
              this.groupService
                .getGroupsForAssignment(a.id)
                .pipe(
                  catchError(() => of(null))
                ),

            pairings:
              this.evalService
                .getEvalAssignments(a.id)
                .pipe(
                  catchError(() => of(null))
                )

          })

        );

        forkJoin(requests).subscribe({

          next: results => {

            if (token !== this.loadToken) return;

            const cards = assignments.map((a, i) =>
              this.buildCard(
                a,
                results[i].groups,
                results[i].pairings
              )
            );

            this.cards.set(cards);
            this.loadingAssignments.set(false);
          },

          error: () => {

            if (token !== this.loadToken) return;

            this.loadingAssignments.set(false);
            this.error.set(
              'Failed to load assignment progress.'
            );
          }

        });
      },

      error: () => {

        if (token !== this.loadToken) return;

        this.loadingAssignments.set(false);
        this.error.set('Failed to load assignments.');
      }

    });
  }


  private buildCard(
    a: AssignmentResponse,
    groups: GroupSummary[] | null,
    pairings: PairingSummary[] | null
  ): AssignmentCard {

    const requiredEvals = Math.max(
      0,
      Math.trunc(Number(a.req_eval) || 0)
    );

    // A failed request is not the same as zero pairings.
    if (groups === null || pairings === null) {

      return {
        id: a.id,
        name: a.name,
        requiredEvals,
        groupCount: groups?.length ?? null,
        assigned: 0,
        completed: 0,
        rounds: [],
        dataError: true
      };
    }

    // Cancelled pairings are excluded from active workload.
    const active = pairings.filter(
      p => p.status !== 'Cancelled'
    );

    const completed = active.filter(
      p => p.status === 'Submitted'
    ).length;

    // Include required rounds and any additional
    // rounds that already exist in the database.
    const highestRecordedRound = Math.max(
      0,
      ...pairings.map(p => Number(p.round) || 0)
    );

    const roundCount = Math.max(
      requiredEvals,
      highestRecordedRound
    );

    const rounds: RoundProgress[] =
      Array.from({ length: roundCount }, (_, i) => {

        const round = i + 1;

        const rows = active.filter(
          p => Number(p.round) === round
        );

        return {
          round,
          assigned: rows.length,
          completed: rows.filter(
            p => p.status === 'Submitted'
          ).length
        };
      });

    return {
      id: a.id,
      name: a.name,
      requiredEvals,
      groupCount: groups.length,
      assigned: active.length,
      completed,
      rounds,
      dataError: false
    };
  }

}