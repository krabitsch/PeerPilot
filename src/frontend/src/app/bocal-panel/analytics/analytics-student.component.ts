import { AssignmentWorkflowService } from '../../core/services/assignment-workflow.service';
import {
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';

import {
  ActivatedRoute,
  Router
} from '@angular/router';

import { forkJoin } from 'rxjs';
import { DatePipe } from '@angular/common';

import { CourseService } from '../../core/services/course-service/course-service';

import {
  AssignmentService,
  AssignmentResponse
} from '../../core/services/course-service/Assignment.service';

import {
  GroupService
} from '../../core/services/group-service/group-service';

import {
  EvalService
} from '../../core/services/eval-service/eval-service';

import { SubmissionService } from '../../core/services/submission-service/submission-service';
import { ExportService } from '../../core/services/export-service/export-service';
import { followDownload } from '../../core/download';
import { formatBytes } from '../../core/format-bytes';


// One downloadable file of the student's group submission (original + retries).
interface SubmissionFileRow {
  id: number;
  name: string;
  size: number;
  uploadedAt: string | null;
  version: string;
}

// One evaluation involving the student that has an audio recording.
interface RecordingRow {
  responseId: number;
  direction: 'Received' | 'Given';
  round: number;
  counterpart: string;
}


interface StudentInfo {
  id: number;
  username: string;
  email: string;
  role?: string;
}


interface GroupMember {
  userId: number;

  user?: {
    id: number;
    username: string;
    email: string;
  };
}


interface GroupInfo {
  id: number;
  name: string;
  members: GroupMember[];
}


interface PairingInfo {
  outcome?:string; createdAt:string; evaluatorName?:string;
  id: number;

  round: number;

  status: string;

  evalueeGroupId: number;

  evaluatorUserId: number;

  evaluatorGroupId: number | null;
}


interface EvalueeRoundRow {
  attempt?:number;
  round: number;

  evaluatorName: string;

  evaluatorGroupName: string;

  status: string;
}


interface EvaluatorRoundRow {
  attempt?:number;
  round: number;

  evalueeGroupName: string;

  status: string;
}


@Component({
  selector: 'app-analytics-student',
  standalone: true,
  imports: [DatePipe],

  templateUrl: './analytics-student.component.html',

  styleUrls: [
    './analytics-overview.component.css',
    './analytics-student.component.css'
  ]
})
export class AnalyticsStudentComponent implements OnInit {

  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private courseService = inject(CourseService);
  private assignmentService = inject(AssignmentService);
  private groupService = inject(GroupService);
  private evalService = inject(EvalService);
  private workflow = inject(AssignmentWorkflowService);
  private submissionService = inject(SubmissionService);
  private exportService = inject(ExportService);


  classId = signal<number | null>(null);

  assignmentId = signal<number | null>(null);

  studentId = signal<number | null>(null);


  courseName = signal('');

  assignmentName = signal('');

  student = signal<StudentInfo | null>(null);

  studentGroup = signal<GroupInfo | null>(null);


  requiredRounds = signal(0);


  evalueeRows = signal<EvalueeRoundRow[]>([]);

  evaluatorRows = signal<EvaluatorRoundRow[]>([]);


  loading = signal(false);

  error = signal<string | null>(null);


  // Downloads for this student.
  submissionFiles = signal<SubmissionFileRow[]>([]);
  submissionFilesState = signal<'idle' | 'loading' | 'error'>('idle');
  recordings = signal<RecordingRow[]>([]);
  downloading = signal<null | 'zip' | 'csv'>(null);
  downloadError = signal<string | null>(null);
  downloadNotice = signal<string | null>(null);


  groupCompletedCount = computed(() => new Set(this.evalueeRows()
    .filter(row => row.status === 'Passed' || row.status === 'Failed').map(row=>row.round)).size);


  evaluatorCompletedCount = computed(() =>
    this.evaluatorRows()
      .filter(row => row.status === 'Submitted')
      .length
  );


  evaluatorAssignedCount = computed(() =>
    this.evaluatorRows().filter(row=>row.status !== 'Cancelled').length
  );


  ngOnInit(): void {

    this.route.queryParamMap.subscribe(params => {

      const classId =
        Number(params.get('classId'));

      const assId =
        Number(params.get('assId'));

      const studentId =
        Number(params.get('studentId'));


      if (
        !Number.isInteger(classId) ||
        classId <= 0 ||

        !Number.isInteger(assId) ||
        assId <= 0 ||

        !Number.isInteger(studentId) ||
        studentId <= 0
      ) {

        this.error.set(
          'Invalid course, assignment or student ID.'
        );

        return;
      }


      this.classId.set(classId);

      this.assignmentId.set(assId);

      this.studentId.set(studentId);


      this.loadStudentAnalytics(
        classId,
        assId,
        studentId
      );

    });

  }


  private loadStudentAnalytics(
    classId: number,
    assId: number,
    studentId: number
  ): void {

    this.loading.set(true);

    this.error.set(null);


    forkJoin({

      course:
        this.courseService.getClass(classId),

      assignments:
        this.assignmentService.getAssignments(classId),

      students:
        this.workflow.summary(assId),

      groups:
        this.groupService.getGroupsForAssignment(assId),

      pairings:
        this.evalService.getEvalAssignments(assId)

    }).subscribe({

      next: data => {

        /*
         * Course
         */

        this.courseName.set(
          data.course.name
        );


        /*
         * Assignment
         */

        const assignment =
          data.assignments.find(
            a => a.id === assId
          );


        if (!assignment) {

          this.loading.set(false);

          this.error.set(
            'This assignment does not belong to the selected course.'
          );

          return;
        }


        this.assignmentName.set(
          assignment.name
        );


        const requiredRounds =
          Math.max(
            0,
            Math.trunc(
              Number(assignment.req_eval) || 0
            )
          );


        this.requiredRounds.set(
          requiredRounds
        );


        /*
         * Student
         */

        const student =
          data.students.participants.find(
            s => s.id === studentId
          );


        if (!student) {

          this.loading.set(false);

          this.error.set(
            'This participant is not in the selected course.'
          );

          return;
        }


        this.student.set({
          id: student.id,
          username: student.username,
          email: student.email,
          role: student.role
        });


        /*
         * Normalize groups
         */

        const groups: GroupInfo[] =
          data.groups.map((g: any) => ({

            id: Number(g.id),

            name: String(g.name),

            members:
              (g.members ?? []).map(
                (m: any) => ({

                  userId:
                    Number(m.userId),

                  user: m.user

                })
              )

          }));


        /*
         * Find student's group
         */

        const ownGroup =
          groups.find(group =>
            group.members.some(
              member =>
                member.userId === studentId
            )
          ) ?? null;


        this.studentGroup.set(
          ownGroup
        );


        // Historical analytics includes all attempts, including cancellations.

        const pairings: PairingInfo[] =
          data.pairings


            .map(p => ({

              outcome:p.outcome, createdAt:p.createdAt, evaluatorName:p.evaluatorUser?.username,
              id:
                Number(p.id),

              round:
                Number(p.round),

              status:
                String(p.status),

              evalueeGroupId:
                Number(p.evalueeGroupId),

              evaluatorUserId:
                Number(p.evaluatorUserId),

              evaluatorGroupId:
                p.evaluatorGroupId == null
                  ? null
                  : Number(p.evaluatorGroupId)

            })).sort((a,b)=>a.round-b.round || new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime() || a.id-b.id);


        /*
         * Small lookup helpers
         */

        const groupById =
          new Map<number, GroupInfo>();


        for (const group of groups) {
          groupById.set(
            group.id,
            group
          );
        }


        const studentNameById =
          new Map<number, string>();


        for (const group of groups) {

          for (const member of group.members) {

            if (member.user) {

              studentNameById.set(
                member.userId,
                member.user.username
              );

            }

          }

        }


        /*
         * As evaluee:
         * evaluations received by the student's own group
         */

        const evalueeRows: EvalueeRoundRow[] = [];


        if (ownGroup) {

          for (
            let round = 1;
            round <= requiredRounds;
            round++
          ) {

            const rows =
              pairings.filter(p =>
                p.evalueeGroupId === ownGroup.id &&
                p.round === round
              );


            if (rows.length === 0) {

              evalueeRows.push({

                round,

                evaluatorName:
                  'Not assigned',

                evaluatorGroupName:
                  '—',

                status:
                  'Not assigned'

              });

              continue;
            }


            for (const [index,row] of rows.entries()) {

              const evaluatorGroup =
                row.evaluatorGroupId
                  ? groupById.get(
                      row.evaluatorGroupId
                    )
                  : null;


              evalueeRows.push({

                round,

                attempt:index+1,
                evaluatorName:
                  row.evaluatorName ?? studentNameById.get(
                    row.evaluatorUserId
                  )
                  ?? `student #${row.evaluatorUserId}`,

                evaluatorGroupName:
                  evaluatorGroup?.name ?? '—',

                status:
                  row.status === 'Cancelled' ? 'Cancelled' : row.outcome ?? 'Pending'

              });

            }

          }

        } else {

          for (
            let round = 1;
            round <= requiredRounds;
            round++
          ) {

            evalueeRows.push({

              round,

              evaluatorName:
                'Student not allocated to a group',

              evaluatorGroupName:
                '—',

              status:
                'Not assigned'

            });

          }

        }


        this.evalueeRows.set(
          evalueeRows
        );


        /*
         * As evaluator:
         * evaluations assigned personally to this student
         */

        const evaluatorRows: EvaluatorRoundRow[] =
          pairings

            .filter(
              p =>
                p.evaluatorUserId === studentId
            )

            .map(p => ({

              round:
                p.round,

              evalueeGroupName:
                groupById.get(
                  p.evalueeGroupId
                )?.name
                ?? `Group #${p.evalueeGroupId}`,

              attempt:pairings.filter(other=>other.evalueeGroupId===p.evalueeGroupId && other.round===p.round).findIndex(other=>other.id===p.id)+1,
              status:
                p.status

            }))

            .sort(
              (a, b) =>
                a.round - b.round
            );


        this.evaluatorRows.set(
          evaluatorRows
        );


        // Recordings: one per evaluation response that has one, on either side.
        this.recordings.set(
          (data.pairings as any[])
            .filter(p => p.evalResponse?.id && p.evalResponse?.recordingFileId)
            .map(p => {
              const received = !!ownGroup && Number(p.evalueeGroupId) === ownGroup.id;
              const given = Number(p.evaluatorUserId) === studentId;
              if (!received && !given) return null;
              return {
                responseId: Number(p.evalResponse.id),
                direction: received ? 'Received' : 'Given',
                round: Number(p.round),
                counterpart: received
                  ? `from ${p.evaluatorUser?.username ?? studentNameById.get(Number(p.evaluatorUserId)) ?? 'evaluator'}`
                  : `for ${groupById.get(Number(p.evalueeGroupId))?.name ?? `group #${p.evalueeGroupId}`}`,
              } as RecordingRow;
            })
            .filter((r): r is RecordingRow => r !== null)
            .sort((a, b) => (a.direction === b.direction ? 0 : a.direction === 'Received' ? -1 : 1) || a.round - b.round)
        );

        this.loading.set(false);

        // Last, so the rest of the page renders even if this request fails.
        this.loadSubmissionFiles(ownGroup?.id ?? null);

      },


      error: () => {

        this.loading.set(false);

        this.error.set(
          'Could not load student analytics.'
        );

      }

    });

  }


  private loadSubmissionFiles(groupId: number | null): void {
    this.submissionFiles.set([]);
    if (!groupId) { this.submissionFilesState.set('idle'); return; }
    this.submissionFilesState.set('loading');
    this.submissionService.getGroupSubmissions(groupId).subscribe({
      next: (subs: any) => {
        const sub = subs?.[0];
        const files: any[] = sub?.files ?? (sub?.file ? [sub.file] : []);
        this.submissionFiles.set(files.map((f, i) => ({
          id: Number(f.id), name: String(f.name), size: Number(f.size) || 0,
          uploadedAt: f.createdAt ?? null,
          version: i === 0 ? 'Original' : `Retry ${i}`,
        })));
        this.submissionFilesState.set('idle');
      },
      error: () => this.submissionFilesState.set('error'),
    });
  }


  downloadSubmissionFile(fileId: number): void {
    const group = this.studentGroup();
    if (!group) return;
    this.downloadError.set(null);
    this.submissionService.getDownloadUrl(group.id, undefined, fileId).subscribe({
      next: res => { if (res?.url) followDownload(res.url); },
      error: () => this.downloadError.set('Could not download that submission file.'),
    });
  }


  downloadRecording(responseId: number): void {
    this.downloadError.set(null);
    this.evalService.getRecordingUrl(responseId).subscribe({
      next: res => { if (res?.url) followDownload(res.url); },
      error: () => this.downloadError.set('Could not download that recording.'),
    });
  }


  // Everything involving this student as one ZIP (submission files, the
  // evaluations they received and gave with comments/replies, recordings).
  downloadStudentArchive(): void {
    const assId = this.assignmentId(), studentId = this.studentId();
    if (!assId || !studentId || this.downloading()) return;
    this.downloading.set('zip');
    this.downloadError.set(null);
    this.downloadNotice.set(null);
    this.exportService.downloadAssignmentArchive(assId, { recordings: true, studentId }, refused => {
      this.downloadNotice.set(null);
      this.downloadError.set(refused);
    }).subscribe({
      next: grant => {
        this.downloading.set(null);
        this.downloadNotice.set(`Download started: ~${formatBytes(grant.totalBytes)} ` +
          `(${grant.submissions} submission file${grant.submissions === 1 ? '' : 's'}, ` +
          `${grant.recordings} recording${grant.recordings === 1 ? '' : 's'}).`);
      },
      error: err => {
        this.downloading.set(null);
        this.downloadError.set(err?.message ?? 'Could not download this student\'s files.');
      },
    });
  }


  downloadStudentCsv(): void {
    const assId = this.assignmentId(), studentId = this.studentId();
    if (!assId || !studentId || this.downloading()) return;
    this.downloading.set('csv');
    this.downloadError.set(null);
    this.exportService.downloadEvaluationsCsv(assId, studentId).subscribe({
      next: () => this.downloading.set(null),
      error: err => {
        this.downloading.set(null);
        this.downloadError.set(err?.message ?? 'Could not download the evaluations CSV.');
      },
    });
  }


  formatSize(bytes: number): string { return formatBytes(bytes); }


  backToAssignmentAnalytics(): void {

    const classId =
      this.classId();

    const assId =
      this.assignmentId();


    if (!classId || !assId) return;


    this.router.navigate(
      ['/bocal/analytics/assignment'],
      {
        queryParams: {
          classId,
          assId
        }
      }
    );

  }

}
