import { AssignmentWorkflowService } from '../../core/services/assignment-workflow.service';
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
  id:number; createdAt:string; outcome?:string; evaluatorName?:string;
  round: number;
  status: string;
  evalueeGroupId: number;
  evaluatorUserId: number;
}

// Evaluee cells show academic outcomes; evaluator cells show task completion.
interface ProgressCell {
  label: string;
  kind: 'passed' | 'failed' | 'pending' | 'none' | 'cancelled';
}

interface StudentProgress {
  id: number;
  name: string;
  groupName: string;
  groupId: number | null;
  evalueeEligible:boolean;
  received: ProgressCell[][];
  evaluator: ProgressCell[][];
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
  private workflow = inject(AssignmentWorkflowService);


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
        return rows.filter(s => s.evalueeEligible && s.groupId === null);

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

      management: this.workflow.summary(assignment.id),

      groups:
        this.groupService.getGroupsForAssignment(assignment.id),

      pairings:
        this.evalService.getEvalAssignments(assignment.id),

      submissions:
        this.submissionService.getSubmissionsForAssignment(assignment.id)

    }).subscribe({

      next: data => {

        if (version !== this.requestVersion) return;

        const enrolled = data.management.participants.filter(p => p.role === 'Student' ||
          p.evalueeEligible || p.evaluatorEligible || data.pairings.some(task=>task.evaluatorUserId===p.id));
        const eligibleEvaluees = new Set(data.management.participants.filter(p=>p.evalueeEligible).map(p=>p.id));

        const groups: GroupInfo[] = data.groups.map((g: any) => ({
          id: Number(g.id),
          name: String(g.name),
          members: (g.members ?? []).map((m: any) => ({
            userId: Number(m.userId)
          }))
        }));

        // Preserve historical attempts; exclude cancellations only from active counts.
        const pairings: PairingInfo[] = data.pairings
          .sort((a,b)=>new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime()||a.id-b.id)
          .map(p => ({
            id:p.id, createdAt:p.createdAt, outcome:p.outcome, evaluatorName:p.evaluatorUser?.username,
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
        const missingGroups = new Set(data.management.slots.map(slot=>slot.groupId)).size;

        const unallocatedStudents = enrolled.filter(
          student => eligibleEvaluees.has(student.id) && !groupByStudent.has(student.id)
        ).length;


        this.stats.set({
          students: enrolled.length,
          groups: groups.length,
          pairings: pairings.filter(p=>p.status!=='Cancelled').length,
          groupsMissingPairings: missingGroups,
          unallocatedStudents
        });


        // Construct a row for every enrolled student.
        const studentRows: StudentProgress[] =
          enrolled.map(student => {

            const group =
              groupByStudent.get(student.id) ?? null;

            const received = rounds.map(round => {

              if (!group) return [this.emptyCell()];

              return this.evalueeCell(
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
                ), groups
              )

            );


            // Missing incoming evaluations affect the group.
            // Pending evaluator tasks affect the individual.
            // No evaluator assignment is not automatically
            // an incomplete task.
            const incomplete =
              (eligibleEvaluees.has(student.id) && (group === null || received
                .slice(0, requiredRounds)
                .some(cells => !cells.some(c => c.kind === 'passed')))) ||
              evaluator.some(cells => cells.some(c => c.kind === 'pending'));


            return {
              id: student.id,
              name: student.username,
              groupName: group?.name ?? (eligibleEvaluees.has(student.id) ? 'Unallocated' : 'Not an evaluee'),
              groupId: group?.id ?? null,
              evalueeEligible:eligibleEvaluees.has(student.id),
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
      label: 'Not assigned',
      kind: 'none'
    };
  }


  private attemptCell(p:PairingInfo, detail:string):ProgressCell {
    const outcome = p.status === 'Cancelled' ? 'Cancelled' : p.outcome ?? 'Pending';
    return {label:`${detail} — ${outcome}`,kind:outcome==='Passed'?'passed':outcome==='Failed'?'failed':outcome==='Cancelled'?'cancelled':'pending'};
  }

  private evalueeCell(pairings:PairingInfo[]):ProgressCell[] {
    return pairings.length ? pairings.map((p,i)=>this.attemptCell(p,
      `Attempt ${i+1} — evaluated by ${p.evaluatorName ?? 'user '+p.evaluatorUserId}`)) : [this.emptyCell()];
  }

  private progressCell(pairings:PairingInfo[], groups:GroupInfo[]):ProgressCell[] {
    return pairings.length ? pairings.map(p => ({
      label: `Evaluates ${groups.find(g=>g.id===p.evalueeGroupId)?.name ?? 'group '+p.evalueeGroupId} — task ${p.id} — ${p.status === 'Submitted' ? 'Completed' : p.status}`,
      kind: p.status === 'Submitted' ? 'passed' as const : p.status === 'Cancelled' ? 'cancelled' as const : 'pending' as const
    })) : [this.emptyCell()];
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
        error: err => {
          this.downloading.set(null);
          this.downloadError.set(err?.message ?? 'Could not download the assignment archive.');
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