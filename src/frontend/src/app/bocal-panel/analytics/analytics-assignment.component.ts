import {
  Component, OnInit, computed, inject, signal
} from '@angular/core';

import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';

import { CourseService } from '../../core/services/course-service/course-service';
import {
  AssignmentService,
  AssignmentResponse
} from '../../core/services/course-service/Assignment.service';

import { GroupService } from '../../core/services/group-service/group-service';
import { EvalService } from '../../core/services/eval-service/eval-service';
import { SubmissionService } from '../../core/services/submission-service/submission-service';
import { ExportService } from '../../core/services/export-service/export-service';


interface GroupInfo {
  id: number;
  name: string;
  members: { userId: number }[];
}

interface PairingInfo {
  round: number;
  status: string;
  evalueeGroupId: number;
  evaluatorUserId: number;
}

// 'complete'/'pending' are used by the "As evaluator" column (did the student
// do their evaluation task). The "As evaluee" column uses the submission-aware
// states: 'evaluated' (round's evaluation done), 'submitted' (work handed in,
// evaluation still pending) and 'notSubmitted' (no closed submission yet).
interface ProgressCell {
  label: string;
  kind: 'complete' | 'pending' | 'none' | 'evaluated' | 'submitted' | 'notSubmitted';
}

interface StudentProgress {
  id: number;
  name: string;
  groupName: string;
  groupId: number | null;
  received: ProgressCell[];
  evaluator: ProgressCell[];
  incomplete: boolean;
}

interface AssignmentStats {
  students: number;
  groups: number;
  pairings: number;
  groupsMissingPairings: number;
  unallocatedStudents: number;
}

type StudentFilter = 'All' | 'Incomplete' | 'Unallocated';


@Component({
  selector: 'app-analytics-assignment',
  standalone: true,
  templateUrl: './analytics-assignment.component.html',
  styleUrls: [
    './analytics-overview.component.css',
    './analytics-assignment.component.css'
  ]
})
export class AnalyticsAssignmentComponent implements OnInit {

  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private courseService = inject(CourseService);
  private assignmentService = inject(AssignmentService);
  private groupService = inject(GroupService);
  private evalService = inject(EvalService);
  private submissionService = inject(SubmissionService);
  private exportService = inject(ExportService);


  classId = signal<number | null>(null);
  assignmentId = signal<number | null>(null);

  courseName = signal('');
  assignments = signal<AssignmentResponse[]>([]);

  selectedAssignmentName = signal('');
  rounds = signal<number[]>([]);

  stats = signal<AssignmentStats | null>(null);
  students = signal<StudentProgress[]>([]);

  filter = signal<StudentFilter>('All');

  loading = signal(false);
  error = signal<string | null>(null);

  // Downloads (teacher exports).
  includeRecordings = signal(true);
  downloading = signal<null | 'archive' | 'csv'>(null);
  downloadError = signal<string | null>(null);

  // Prevent outdated API responses from changing the page
  // when users switch assignments quickly.
  private requestVersion = 0;


  filteredStudents = computed(() => {

    const rows = this.students();

    switch (this.filter()) {

      case 'Incomplete':
        return rows.filter(s => s.incomplete);

      case 'Unallocated':
        return rows.filter(s => s.groupId === null);

      default:
        return rows;
    }
  });


  ngOnInit(): void {

    this.route.queryParamMap.subscribe(params => {

      const classId = Number(params.get('classId'));
      const assId = Number(params.get('assId'));

      if (
        !Number.isInteger(classId) || classId <= 0 ||
        !Number.isInteger(assId) || assId <= 0
      ) {
        this.error.set('Invalid course or assignment ID.');
        return;
      }

      this.classId.set(classId);
      this.assignmentId.set(assId);

      this.loadAssignmentContext(classId, assId);
    });
  }


  private loadAssignmentContext(
    classId: number,
    assId: number
  ): void {

    const version = ++this.requestVersion;

    this.loading.set(true);
    this.error.set(null);
    this.stats.set(null);
    this.students.set([]);
    this.rounds.set([]);

    forkJoin({

      course: this.courseService.getClass(classId),

      assignments: this.assignmentService.getAssignments(classId)

    }).subscribe({

      next: ({ course, assignments }) => {

        if (version !== this.requestVersion) return;

        this.courseName.set(course.name);
        this.assignments.set(assignments);

        const selected = assignments.find(a => a.id === assId);

        if (!selected) {
          this.loading.set(false);
          this.error.set(
            'This assignment does not belong to the selected course.'
          );
          return;
        }

        this.selectedAssignmentName.set(selected.name);

        this.loadProgress(classId, selected, version);
      },

      error: () => {

        if (version !== this.requestVersion) return;

        this.loading.set(false);
        this.error.set(
          'Could not load the selected course or its assignments.'
        );
      }

    });
  }


  private loadProgress(
    classId: number,
    assignment: AssignmentResponse,
    version: number
  ): void {

    forkJoin({

      students: this.courseService.getClassStudents(classId),

      groups:
        this.groupService.getGroupsForAssignment(assignment.id),

      pairings:
        this.evalService.getEvalAssignments(assignment.id),

      submissions:
        this.submissionService.getSubmissionsForAssignment(assignment.id)

    }).subscribe({

      next: data => {

        if (version !== this.requestVersion) return;

        const enrolled = data.students.filter(
          s => !s.role || s.role === 'Student'
        );

        const groups: GroupInfo[] = data.groups.map((g: any) => ({
          id: Number(g.id),
          name: String(g.name),
          members: (g.members ?? []).map((m: any) => ({
            userId: Number(m.userId)
          }))
        }));

        // Cancelled pairings do not constitute active tasks.
        const pairings: PairingInfo[] = data.pairings
          .filter(p => p.status !== 'Cancelled')
          .map(p => ({
            round: Number(p.round),
            status: p.status,
            evalueeGroupId: Number(p.evalueeGroupId),
            evaluatorUserId: Number(p.evaluatorUserId)
          }));

        // Groups that have handed in work (a closed submission). Submission is
        // per group, so it gates every round of that group's "As evaluee" cells.
        const submittedGroupIds = new Set<number>(
          (data.submissions ?? [])
            .filter((s: any) => s.status === 'Close')
            .map((s: any) => Number(s.groupId))
        );

        const requiredRounds = Math.max(
          0,
          Math.trunc(Number(assignment.req_eval) || 0)
        );

        // Display all required rounds, plus any additional
        // rounds already represented by existing pairings.
        const maxRound = Math.max(
          1,
          requiredRounds,
          ...pairings.map(p => p.round)
        );

        const rounds = Array.from(
          { length: maxRound },
          (_, i) => i + 1
        );

        this.rounds.set(rounds);


        // Map each student to their assignment group.
        const groupByStudent = new Map<number, GroupInfo>();

        for (const group of groups) {
          for (const member of group.members) {
            groupByStudent.set(member.userId, group);
          }
        }


        // Count groups missing at least one required
        // incoming evaluation round.
        const missingGroups = groups.filter(group => {

          for (
            let round = 1;
            round <= requiredRounds;
            round++
          ) {

            const hasPairing = pairings.some(p =>
              p.evalueeGroupId === group.id &&
              p.round === round
            );

            if (!hasPairing) return true;
          }

          return false;

        }).length;


        const unallocatedStudents = enrolled.filter(
          student => !groupByStudent.has(student.id)
        ).length;


        this.stats.set({
          students: enrolled.length,
          groups: groups.length,
          pairings: pairings.length,
          groupsMissingPairings: missingGroups,
          unallocatedStudents
        });


        // Construct a row for every enrolled student.
        const studentRows: StudentProgress[] =
          enrolled.map(student => {

            const group =
              groupByStudent.get(student.id) ?? null;

            const received = rounds.map(round => {

              if (!group) return this.emptyCell();

              return this.evalueeCell(
                pairings.filter(p =>
                  p.evalueeGroupId === group.id &&
                  p.round === round
                ),
                submittedGroupIds.has(group.id)
              );
            });


            const evaluator = rounds.map(round =>

              this.progressCell(
                pairings.filter(p =>
                  p.evaluatorUserId === student.id &&
                  p.round === round
                )
              )

            );


            // Missing incoming evaluations affect the group.
            // Pending evaluator tasks affect the individual.
            // No evaluator assignment is not automatically
            // an incomplete task.
            const incomplete =
              group === null ||
              received
                .slice(0, requiredRounds)
                .some(c => c.kind !== 'evaluated') ||
              evaluator.some(c => c.kind === 'pending');


            return {
              id: student.id,
              name: student.username,
              groupName: group?.name ?? 'Unallocated',
              groupId: group?.id ?? null,
              received,
              evaluator,
              incomplete
            };
          });


        studentRows.sort((a, b) =>
          a.name.localeCompare(
            b.name,
            undefined,
            { numeric: true }
          )
        );

        this.students.set(studentRows);
        this.loading.set(false);
      },


      error: () => {

        if (version !== this.requestVersion) return;

        this.error.set(
          'Could not load students, groups or evaluation pairings.'
        );

        this.loading.set(false);
      }

    });
  }


  private emptyCell(): ProgressCell {

    return {
      label: '—',
      kind: 'none'
    };
  }


  // "As evaluee" cell: reflects the group's submission + this round's evaluation.
  //   no pairing          → none ("—", not assigned)
  //   round fully evaluated → evaluated ("✓")
  //   work submitted, eval pending → submitted ("●")
  //   no closed submission yet     → notSubmitted ("○")
  private evalueeCell(
    pairings: PairingInfo[],
    submitted: boolean
  ): ProgressCell {

    if (pairings.length === 0) {
      return this.emptyCell();
    }

    const completed = pairings.filter(
      p => p.status === 'Submitted'
    ).length;

    if (completed === pairings.length) {
      return { label: '✓', kind: 'evaluated' };
    }

    if (submitted) {
      return { label: '●', kind: 'submitted' };
    }

    return { label: '○', kind: 'notSubmitted' };
  }


  private progressCell(
    pairings: PairingInfo[]
  ): ProgressCell {

    const total = pairings.length;

    if (total === 0) {
      return this.emptyCell();
    }

    const completed = pairings.filter(
      p => p.status === 'Submitted'
    ).length;

    if (completed === total) {
      return {
        label: '✓',
        kind: 'complete'
      };
    }

    return {
      label: `${completed}/${total}`,
      kind: 'pending'
    };
  }


  onAssignmentChanged(value: string): void {

    const assId = Number(value);
    const classId = this.classId();

    if (!classId || !Number.isInteger(assId)) return;

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { classId, assId },
      queryParamsHandling: 'merge'
    });
  }


  onFilterChanged(value: string): void {

    if (
      value === 'All' ||
      value === 'Incomplete' ||
      value === 'Unallocated'
    ) {
      this.filter.set(value);
    }
  }


  backToAnalytics(): void {

    this.router.navigate(['/bocal/analytics'], {
      queryParams: { classId: this.classId() }
    });
  }

  downloadArchive(): void {

    const assId = this.assignmentId();
    if (!assId || this.downloading()) return;

    this.downloading.set('archive');
    this.downloadError.set(null);

    this.exportService
      .downloadAssignmentArchive(assId, { recordings: this.includeRecordings() })
      .subscribe({
        next: () => this.downloading.set(null),
        error: () => {
          this.downloading.set(null);
          this.downloadError.set('Could not download the assignment archive.');
        }
      });
  }


  downloadCsv(): void {

    const assId = this.assignmentId();
    if (!assId || this.downloading()) return;

    this.downloading.set('csv');
    this.downloadError.set(null);

    this.exportService
      .downloadEvaluationsCsv(assId)
      .subscribe({
        next: () => this.downloading.set(null),
        error: () => {
          this.downloading.set(null);
          this.downloadError.set('Could not download the evaluations CSV.');
        }
      });
  }


  toggleRecordings(checked: boolean): void {
    this.includeRecordings.set(checked);
  }


  // A group's submission file, via the staff presigned-URL path. Opening the
  // presigned URL lets the browser fetch straight from storage (no token).
  downloadSubmission(groupId: number | null): void {

    if (!groupId) return;

    this.submissionService.getDownloadUrl(groupId).subscribe({
      next: (res: any) => {
        if (res?.url) window.open(res.url, '_blank');
      },
      error: () => {
        this.downloadError.set('Could not download that submission.');
      }
    });
  }


openStudentAnalytics(studentId: number): void {
  const classId = this.classId();
  const assId = this.assignmentId();

  if (!classId || !assId) return;

  this.router.navigate(['/bocal/analytics/student'], {
    queryParams: {
      classId,
      assId,
      studentId
    }
  });
}

}