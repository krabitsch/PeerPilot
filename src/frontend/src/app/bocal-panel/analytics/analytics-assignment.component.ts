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

interface ProgressCell {
  label: string;
  kind: 'complete' | 'pending' | 'none';
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
        this.evalService.getEvalAssignments(assignment.id)

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

              return this.progressCell(
                pairings.filter(p =>
                  p.evalueeGroupId === group.id &&
                  p.round === round
                )
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
                .some(c => c.kind !== 'complete') ||
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