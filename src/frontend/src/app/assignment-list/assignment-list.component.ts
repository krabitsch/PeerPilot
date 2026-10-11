import {
  Component,
  inject,
  signal,
  computed,
  OnInit
} from '@angular/core';

import {
  ActivatedRoute,
  Router
} from '@angular/router';

import {
  NgStyle,
  SlicePipe
} from '@angular/common';

import {
  forkJoin,
  of
} from 'rxjs';

import {
  catchError
} from 'rxjs/operators';

import {
  TranslateModule,
  TranslateService
} from '@ngx-translate/core';

import {
  DS,
  BadgeVariant,
  Course
} from '../tokens';

import {
  AssignmentResponse
} from '../core/services/course-service/Assignment.service';

import {
  EnrollService
} from '../core/services/enroll-service/enroll-service';

import {
  SubmissionService
} from '../core/services/submission-service/submission-service';

import {
  GroupService
} from '../core/services/group-service/group-service';

import {
  AuthService
} from '../services/auth.service';

import {
  LoadingService
} from '../core/services/loading-service/loading.service';

import {
  BadgeComponent
} from '../shared/badge.component';

import {
  BtnComponent
} from '../shared/btn.component';

import {
  ContainerComponent,
  ContainerConfig
} from '../shared/container.component';


type AssignmentStatus =
  | 'not_started'
  | 'in_progress'
  | 'awaiting_review'
  | 'failed'
  | 'passed';


interface AssignmentGroup {
  id: number;
  name: string;
  leaderId: number;

  members: {
    id: number;
    userId: number;

    user?: {
      id: number;
      username: string;
      email: string;
    };
  }[];
}


interface AssignmentItem {
  assignment: AssignmentResponse;

  classId: number;
  className: string;

  status: AssignmentStatus;

  /*
   * Human-readable member list for the current student's
   * assignment group.
   *
   * Examples:
   *   student42
   *   student42, student57
   *   Not assigned
   */
  groupMembers: string;
}


const STATUS_VARIANTS:
  Record<AssignmentStatus, BadgeVariant> = {

  not_started:
    'pending',

  in_progress:
    'submitted',

  awaiting_review:
    'under_review',

  failed:
    'failed',

  passed:
    'validated',
};


const STATUS_LABEL_KEYS:
  Record<AssignmentStatus, string> = {

  not_started:
    'status_not_started',

  in_progress:
    'status_in_progress',

  awaiting_review:
    'status_awaiting_review',

  failed:
    'status_not_passed_yet',

  passed:
    'status_passed',
};


@Component({
  selector: 'app-assignment-list',

  standalone: true,

  imports: [
    NgStyle,
    SlicePipe,
    BadgeComponent,
    BtnComponent,
    ContainerComponent,
    TranslateModule
  ],

  templateUrl:
    './assignment-list.component.html',
})


export class AssignmentListComponent
  implements OnInit {

  private router =
    inject(Router);

  private route =
    inject(ActivatedRoute);

  private enrollService =
    inject(EnrollService);

  private subService =
    inject(SubmissionService);

  private groupService =
    inject(GroupService);

  private auth =
    inject(AuthService);

  private loading =
    inject(LoadingService);

  private translate =
    inject(TranslateService);


  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------

  courses =
    signal<Course[]>([]);

  classFilter =
    signal<number | null>(null);

  items =
    signal<AssignmentItem[]>([]);

  loaded =
    signal(false);


  // ----------------------------------------------------------
  // Current course
  // ----------------------------------------------------------

  selectedCourse = computed(() => {

    const courses =
      this.courses();

    if (courses.length === 0)
      return null;

    const classId =
      this.classFilter();

    if (classId) {
      const selected =
        courses.find(
          c => c.id === classId
        );

      if (selected)
        return selected;
    }

    return courses[0];
  });


  // ----------------------------------------------------------
  // Assignments shown on page
  //
  // The Assignments page is now always course-specific.
  // ----------------------------------------------------------

  displayedItems = computed(() => {

    const course =
      this.selectedCourse();

    if (!course)
      return [];

    return this.items().filter(
      item =>
        item.classId === course.id
    );
  });


  // ----------------------------------------------------------
  // Initialisation
  // ----------------------------------------------------------

  ngOnInit() {

    /*
     * Keep the page selection synced with:
     *
     * /assignment?classId=...
     *
     * This means:
     *
     * My classes
     * -> Assignments
     *
     * opens exactly the course whose Assignments button
     * the student clicked.
     */
    this.route.queryParams.subscribe(
      params => {

        const id =
          parseInt(
            params['classId'],
            10
          );

        this.classFilter.set(
          Number.isFinite(id)
            ? id
            : null
        );
      }
    );

    this.loadAssignments();
  }


  // ----------------------------------------------------------
  // Load courses + assignments + submission/group state
  // ----------------------------------------------------------

  private loadAssignments() {

    const userId =
      this.auth.user()?.id;

    if (!userId)
      return;

    this.loading.show();


    this.enrollService
      .getStudenEnrolledClasses(userId)
      .subscribe({

        next: (courses) => {

          this.courses.set(courses);

          /*
           * If Assignments was opened from the sidebar rather
           * than from a particular course, select the first
           * enrolled course and put that course in the URL.
           *
           * Also repairs an invalid/stale classId.
           */
          this.ensureCourseSelection(
            courses
          );


          const pairs =
            courses.flatMap(
              course =>

                (course.assignments ?? [])
                  .map(
                    assignment => ({

                      classId:
                        course.id,

                      className:
                        course.name,

                      assignment:
                        assignment as unknown as AssignmentResponse
                    })
                  )
            );


          if (pairs.length === 0) {

            this.items.set([]);

            this.loaded.set(true);

            this.loading.hide();

            return;
          }


          /*
           * For every assignment load:
           *
           * 1. submissions
           *    -> determines status
           *
           * 2. assignment groups
           *    -> determines the student's group members
           */
          forkJoin(

            pairs.map(
              pair =>

                forkJoin({

                  submissions:
                    this.subService
                      .getSubmissionsForAssignment(
                        pair.assignment.id
                      )
                      .pipe(
                        catchError(
                          () =>
                            of([] as any[])
                        )
                      ),

                  groups:
                    this.groupService
                      .getGroupsForAssignment(
                        pair.assignment.id
                      )
                      .pipe(
                        catchError(
                          () =>
                            of([] as AssignmentGroup[])
                        )
                      )

                })

            )

          ).subscribe({

            next: (results) => {

              this.items.set(

                pairs.map(
                  (pair, index) => ({

                    ...pair,

                    status:
                      this.statusFor(
                        results[index]
                          .submissions ?? [],
                        userId
                      ),

                    groupMembers:
                      this.groupMembersFor(
                        results[index]
                          .groups ?? [],
                        userId
                      )

                  })
                )

              );

              this.loaded.set(true);

              this.loading.hide();
            },


            error: () => {

              /*
               * Should rarely be reached because each request
               * above has its own catchError, but keep a safe
               * fallback.
               */
              this.items.set(

                pairs.map(
                  pair => ({

                    ...pair,

                    status:
                      'not_started' as AssignmentStatus,

                    groupMembers:
                      'Not assigned'
                  })
                )

              );

              this.loaded.set(true);

              this.loading.hide();
            }

          });

        },


        error: () => {

          this.loaded.set(true);

          this.loading.hide();
        }

      });
  }


  // ----------------------------------------------------------
  // Normalize course selection
  // ----------------------------------------------------------

  private ensureCourseSelection(
    courses: Course[]
  ) {

    if (courses.length === 0)
      return;


    const requestedId =
      this.classFilter();


    const validRequestedCourse =
      requestedId
        ? courses.some(
            c =>
              c.id === requestedId
          )
        : false;


    if (validRequestedCourse)
      return;


    /*
     * No valid classId was supplied.
     * Use first enrolled course and normalize URL.
     */
    const firstCourse =
      courses[0];


    this.router.navigate(
      ['/assignment'],
      {
        queryParams: {
          classId:
            firstCourse.id
        },

        replaceUrl: true
      }
    );
  }


  // ----------------------------------------------------------
  // Determine student's group-member names
  // ----------------------------------------------------------

  private groupMembersFor(
    groups: AssignmentGroup[],
    userId: number
  ): string {

    const myGroup =
      groups.find(
        group =>
          group.members?.some(
            member =>
              member.userId === userId
          )
      );


    if (!myGroup)
      return 'Not assigned';


    const names =
      (myGroup.members ?? [])
        .map(
          member =>
            member.user?.username
        )
        .filter(
          (
            name
          ): name is string =>
            Boolean(name)
        );


    if (names.length === 0)
      return 'Assigned';


    return names.join(', ');
  }


  // ----------------------------------------------------------
  // Determine assignment status
  // ----------------------------------------------------------

  private statusFor(
    submissions: any[],
    userId: number
  ): AssignmentStatus {

    const mine =
      submissions.find(
        submission =>
          submission.group?.members
            ?.some(
              (member: any) =>
                member.userId === userId
            )
      );


    if (!mine)
      return 'not_started';


    if (mine.status === 'Open')
      return 'in_progress';


    if (mine.passed === true)
      return 'passed';


    if (mine.passed === false)
      return 'failed';


    return 'awaiting_review';
  }


  // ----------------------------------------------------------
  // Course dropdown
  // ----------------------------------------------------------

  selectCourse(
    rawValue: string
  ) {

    const classId =
      parseInt(
        rawValue,
        10
      );


    if (!Number.isFinite(classId))
      return;


    this.router.navigate(
      ['/assignment'],
      {
        queryParams: {
          classId
        }
      }
    );
  }


  // ----------------------------------------------------------
  // Assignment status metadata
  // ----------------------------------------------------------

  statusMeta(
    status: AssignmentStatus
  ) {

    return {
      variant:
        STATUS_VARIANTS[status],

      label:
        STATUS_LABEL_KEYS[status]
    };
  }


  // ----------------------------------------------------------
  // Open assignment detail
  // ----------------------------------------------------------

  open(
    item: AssignmentItem
  ) {

    this.router.navigate(
      ['/assignment-detail'],
      {
        queryParams: {
          assId:
            item.assignment.id
        }
      }
    );
  }


  // ----------------------------------------------------------
  // Container
  // ----------------------------------------------------------

  readonly flatConfig:
    ContainerConfig = {

    variant: 'flat',
    height: 'auto',
    scrollable: false
  };


  // ----------------------------------------------------------
  // Styles
  // ----------------------------------------------------------

  readonly pageStyle = {
    display:
      'flex',

    flexDirection:
      'column' as const,

    gap:
      '20px',

    padding:
      '32px',

    overflowY:
      'auto' as const,

    flex:
      '1'
  };


  readonly overlineStyle = {
    fontSize:
      '0.75rem',

    fontWeight:
      '600',

    letterSpacing:
      '0.12em',

    textTransform:
      'uppercase' as const,

    color:
      DS.colors.cyan,

    marginBottom:
      '6px'
  };


  readonly h1Style = {
    fontFamily:
      DS.fonts.display,

    fontSize:
      '1.75rem',

    fontWeight:
      '700',

    letterSpacing:
      '-0.03em',

    color:
      DS.colors.fg1,

    margin:
      '0'
  };


  // Current-course box

  readonly currentCourseStyle = {
    padding:
      '20px',

    display:
      'flex',

    flexDirection:
      'column' as const,

    gap:
      '14px'
  };


  readonly currentCourseLabelStyle = {
    fontSize:
      '0.6875rem',

    fontWeight:
      '600',

    letterSpacing:
      '0.1em',

    textTransform:
      'uppercase' as const,

    color:
      DS.colors.violet
  };


  readonly currentCourseNameStyle = {
    fontFamily:
      DS.fonts.display,

    fontSize:
      '1.05rem',

    fontWeight:
      '600',

    color:
      DS.colors.fg1
  };


  readonly currentCourseDescriptionStyle = {
    fontSize:
      '0.875rem',

    lineHeight:
      '1.5',

    color:
      DS.colors.fg2
  };


  readonly currentCourseMetaStyle = {
    fontSize:
      '0.8rem',

    color:
      DS.colors.fg3
  };


  readonly selectLabelStyle = {
    display:
      'block',

    fontSize:
      '0.6875rem',

    fontWeight:
      '600',

    letterSpacing:
      '0.1em',

    textTransform:
      'uppercase' as const,

    color:
      DS.colors.fg3,

    marginBottom:
      '6px'
  };


  readonly courseSelectStyle = {
    width:
      '420px',

    maxWidth:
      '100%',

    padding:
      '9px 12px',

    background:
      DS.colors.bg,

    border:
      `1px solid ${DS.colors.border}`,

    borderRadius:
      DS.radius.md,

    color:
      DS.colors.fg1,

    fontFamily:
      DS.fonts.body,

    fontSize:
      '0.875rem',

    cursor:
      'pointer'
  };


  readonly assignmentSectionTitleStyle = {
    fontFamily:
      DS.fonts.display,

    fontSize:
      '1.1rem',

    fontWeight:
      '600',

    color:
      DS.colors.fg1,

    marginTop:
      '4px'
  };


  readonly emptyStyle = {
    textAlign:
      'center' as const,

    padding:
      '48px',

    color:
      DS.colors.fg3,

    fontSize:
      '0.9rem'
  };


  /*
   * One assignment per row.
   * This deliberately matches the Bocal assignment layout
   * rather than creating multiple columns.
   */
  readonly gridStyle = {
    display:
      'grid',

    gridTemplateColumns:
      '1fr',

    gap:
      '14px'
  };


  readonly cardStyle = {
    padding:
      '18px 20px',

    display:
      'flex',

    flexDirection:
      'column' as const,

    gap:
      '12px',

    height:
      '100%',

    boxSizing:
      'border-box' as const
  };


  readonly cardTitleStyle = {
    fontFamily:
      DS.fonts.display,

    fontSize:
      '1.0625rem',

    fontWeight:
      '600',

    color:
      DS.colors.fg1
  };


  readonly classNameStyle = {
    fontSize:
      '0.75rem',

    fontWeight:
      '600',

    letterSpacing:
      '0.08em',

    textTransform:
      'uppercase' as const,

    color:
      DS.colors.violet,

    marginBottom:
      '4px'
  };


  readonly descStyle = {
    fontSize:
      '0.8125rem',

    color:
      DS.colors.fg2,

    lineHeight:
      '1.5',

    flex:
      '1',

    margin:
      '0'
  };


  readonly metaStyle = {
    display:
      'flex',

    flexWrap:
      'wrap' as const,

    alignItems:
      'center',

    gap:
      '5px',

    fontSize:
      '0.75rem',

    color:
      DS.colors.fg3
  };


  readonly footerStyle = {
    display:
      'flex',

    justifyContent:
      'space-between' as const,

    alignItems:
      'center' as const,

    marginTop:
      'auto'
  };

}