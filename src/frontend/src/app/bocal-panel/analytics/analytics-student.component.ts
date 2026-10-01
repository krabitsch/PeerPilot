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
  id: number;

  round: number;

  status: string;

  evalueeGroupId: number;

  evaluatorUserId: number;

  evaluatorGroupId: number | null;
}


interface EvalueeRoundRow {
  round: number;

  evaluatorName: string;

  evaluatorGroupName: string;

  status: string;
}


interface EvaluatorRoundRow {
  round: number;

  evalueeGroupName: string;

  status: string;
}


@Component({
  selector: 'app-analytics-student',
  standalone: true,

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


  groupCompletedCount = computed(() =>
    this.evalueeRows()
      .filter(row => row.status === 'Submitted')
      .length
  );


  evaluatorCompletedCount = computed(() =>
    this.evaluatorRows()
      .filter(row => row.status === 'Submitted')
      .length
  );


  evaluatorAssignedCount = computed(() =>
    this.evaluatorRows().length
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
        this.courseService.getClassStudents(classId),

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
          data.students.find(
            s => s.id === studentId
          );


        if (!student) {

          this.loading.set(false);

          this.error.set(
            'This student is not enrolled in the selected course.'
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


        /*
         * Normalize active pairings.
         *
         * Cancelled pairings are ignored here.
         */

        const pairings: PairingInfo[] =
          data.pairings

            .filter(
              p => p.status !== 'Cancelled'
            )

            .map(p => ({

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

            }));


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


            for (const row of rows) {

              const evaluatorGroup =
                row.evaluatorGroupId
                  ? groupById.get(
                      row.evaluatorGroupId
                    )
                  : null;


              evalueeRows.push({

                round,

                evaluatorName:
                  studentNameById.get(
                    row.evaluatorUserId
                  )
                  ?? `student #${row.evaluatorUserId}`,

                evaluatorGroupName:
                  evaluatorGroup?.name ?? '—',

                status:
                  row.status

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


        this.loading.set(false);

      },


      error: () => {

        this.loading.set(false);

        this.error.set(
          'Could not load student analytics.'
        );

      }

    });

  }


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