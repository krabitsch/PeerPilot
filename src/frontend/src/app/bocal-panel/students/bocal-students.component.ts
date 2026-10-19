import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { NgStyle, DatePipe } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DS, Course } from '../../tokens';
import { AvatarComponent } from '../../shared/avatar.component';
import { BtnComponent } from '../../shared/btn.component';
import { ListComponent } from '../../shared/list.component';
import { AuthService } from '../../services/auth.service';
import { OrgService } from '../../core/services/org-service/org-service';
import { CourseService } from '../../core/services/course-service/course-service';
import { AssignmentService, AssignmentResponse } from '../../core/services/course-service/Assignment.service';
import { EnrollService, RosterRow, RosterResult } from '../../core/services/enroll-service/enroll-service';
import { LoadingService } from '../../core/services/loading-service/loading.service';
import { ActivatedRoute, RouterLink } from '@angular/router';

export interface OrgMember {
  id: number;
  username: string;
  email: string;
  role: string;
  created_at: string;
  // Enrolled by staff, not signed up yet.
  pending?: boolean;
}

interface ClassOption { id: number; name: string; externalCourseCodes: string[]; }

const ROLE_OPTIONS = ['All', 'Student', 'Bocal', 'Admin'];

@Component({
  selector: 'app-bocal-students',
  standalone: true,
  imports: [
    NgStyle, DatePipe,
    AvatarComponent, BtnComponent, ListComponent,
    TranslateModule, RouterLink, A11yModule,
  ],
  templateUrl: './bocal-students.component.html',
})
export class BocalStudentsComponent implements OnInit {
  private auth          = inject(AuthService);
  private orgService    = inject(OrgService);
  private courseService = inject(CourseService);
  private assignService = inject(AssignmentService);
  private enrollService = inject(EnrollService);
  private loading       = inject(LoadingService);
  private translate     = inject(TranslateService);
  private route         = inject(ActivatedRoute);

  // ── Data signals ───────────────────────────────────────────
  members = signal<OrgMember[]>([]);

  // ── Filters ────────────────────────────────────────────────
  searchQuery  = signal('');
  roleFilter   = signal('Student');
  readonly roleOptions = ROLE_OPTIONS;

  // ── Advanced filters: class & subject (assignment) ─────────
  classes  = signal<ClassOption[]>([]);
  subjects = signal<AssignmentResponse[]>([]);
  classFilter   = signal<number | null>(null);
  subjectFilter = signal<number | null>(null);
  classStudentIds   = signal<Set<number> | null>(null);
  subjectStudentIds = signal<Set<number> | null>(null);

  filteredMembers = computed(() => {
    const query    = this.searchQuery().trim().toLowerCase();
    const role     = this.roleFilter();
    const classIds = this.classStudentIds();
    const subjIds  = this.subjectStudentIds();
    return this.members().filter(m => {
      if (role !== 'All' && m.role !== role) return false;
      if (classIds && !classIds.has(m.id)) return false;
      if (subjIds && !subjIds.has(m.id)) return false;
      if (!query) return true;
      return m.username.toLowerCase().includes(query) || m.email.toLowerCase().includes(query);
    }).sort((a, b) => {
      const ranks: Record<string, number> = { Admin: 0, Bocal: 1, Student: 2 };
      return (ranks[a.role] ?? 3) - (ranks[b.role] ?? 3) ||
        a.username.localeCompare(b.username, undefined, { sensitivity: 'base', numeric: true }) || a.id - b.id;
    });
  });

  selectedStudent = signal<OrgMember | null>(null);
  studentCourses = signal<Course[]>([]);
  studentDetailsLoading = signal(false);
  studentDetailsError = signal('');

  openStudent(member: OrgMember) {
    this.selectedStudent.set(member);
    this.studentCourses.set([]);
    this.studentDetailsError.set('');
    this.studentDetailsLoading.set(true);
    this.enrollService.getStudenEnrolledClasses(member.id).subscribe({
      next: courses => {
        if (this.selectedStudent()?.id !== member.id) return;
        this.studentCourses.set(courses.map(course => ({
          ...course,
          assignments: [...(course.assignments ?? [])].sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.id - b.id
          ),
        })));
        this.studentDetailsLoading.set(false);
      },
      error: () => {
        if (this.selectedStudent()?.id !== member.id) return;
        this.studentDetailsError.set('Could not load student details. Please try again.');
        this.studentDetailsLoading.set(false);
      },
    });
  }

  students = computed(() => this.members().filter(m => m.role === 'Student'));

  // ── Add students to the selected course ────────────────────
  // By email, so students can be enrolled (and grouped and paired) before they
  // sign up: the API creates a pending account they claim by signing up.
  addEmail     = signal('');
  addCode      = signal('');
  bulkOpen     = signal(false);
  bulkText     = signal('');
  rosterNotice = signal('');
  rosterFailures = signal<RosterResult[]>([]);
  // Official course number per enrolled student of the selected course.
  classCourseCodes = signal<Map<number, string | null>>(new Map());

  courseCodes = computed(() =>
    this.classes().find(c => c.id === this.classFilter())?.externalCourseCodes ?? []);
  // A course with a single official number needs no choice.
  selectedCode = computed(() => {
    const codes = this.courseCodes();
    return this.addCode() || (codes.length === 1 ? codes[0] : '');
  });
  canAddSingle = computed(() =>
    !!this.addEmail().trim() && (this.courseCodes().length === 0 || !!this.selectedCode()));

  // Students in the org who are not yet enrolled in the selected course —
  // suggestions for the email field. Empty until a course is selected and its
  // roster has loaded.
  enrollableStudents = computed(() => {
    const enrolled = this.classStudentIds();
    if (this.classFilter() === null || !enrolled) return [];
    return this.students().filter(m => !enrolled.has(m.id));
  });

  readonly memberTrackFn = (m: OrgMember) => m.id;

  private get orgId() { return this.auth.user()?.orgId; }

  ngOnInit() {
    this.loadMembers();
    this.loadClasses();
    this.route.queryParams.subscribe(params => {
    const classId = parseInt(params['classId'], 10);

    if (!classId) return;

    // If we arrive via "Show students" for a course, this page is specifically showing students.
    this.roleFilter.set('Student');

    this.onClassFilterChanged(String(classId));
    });
  }

  loadMembers() {
    const orgId = this.orgId;
    if (!orgId) return;

    this.loading.show();
    this.orgService.listOrgMembers(orgId).subscribe({
      next: (members) => {
        this.members.set(members as OrgMember[]);
        this.loading.hide();
      },
      error: () => this.loading.hide(),
    });
  }

  loadClasses() {
    const orgId = this.orgId;
    if (!orgId) return;

    this.courseService.getClassByOrgId(orgId).subscribe({
      next: (classes) => this.classes.set(classes.map(c => ({
        id: c.id, name: c.name, externalCourseCodes: c.externalCourseCodes ?? [],
      }))),
      error: () => {},
    });
  }

  // ── Remove student from the currently filtered class ───────
  removeFromClass(member: OrgMember) {
    const classId = this.classFilter();
    const cls = this.classes().find(c => c.id === classId);
    if (!classId || !cls) return;
    if (!confirm(this.translate.instant('confirm_remove_from_class', { username: member.username, className: cls.name }))) return;

    this.loading.show();
    this.enrollService.dropStudent({ classId, studentId: member.id }).subscribe({
      next: () => {
        this.classStudentIds.update(ids => {
          if (!ids) return ids;
          const next = new Set(ids);
          next.delete(member.id);
          return next;
        });
        this.loading.hide();
      },
      error: () => this.loading.hide(),
    });
  }

  // ── Enrol students into the currently filtered class ───────
  addToClass() {
    if (!this.canAddSingle()) return;
    this.submitRoster(
      [{ email: this.addEmail().trim(), externalCourseCode: this.selectedCode() || null }],
      () => this.addEmail.set(''),
    );
  }

  // One student per line: "email, course number". Lines without a number use
  // the one selected above. Failed lines stay in the box to be fixed.
  addBulk() {
    const rows: RosterRow[] = this.bulkText().split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [email, code] = line.split(/[\s,;]+/);
        return { email, externalCourseCode: code || this.selectedCode() || null };
      });
    if (!rows.length) return;
    this.submitRoster(rows, failures =>
      this.bulkText.set(failures.map(f => [f.email, f.externalCourseCode].filter(Boolean).join(', ')).join('\n')));
  }

  private submitRoster(rows: RosterRow[], onDone: (failures: RosterResult[]) => void) {
    const classId = this.classFilter();
    if (!classId) return;

    this.rosterNotice.set('');
    this.rosterFailures.set([]);
    this.loading.show();
    this.enrollService.enrollByEmail(classId, rows).subscribe({
      next: ({ results }) => {
        this.loading.hide();
        const failures = results.filter(r => r.status === 'failed');
        this.rosterNotice.set(this.rosterSummary(results));
        this.rosterFailures.set(results.length > 1 ? failures : []);
        onDone(failures);
        // New pending accounts join the org; refresh both lists.
        this.loadMembers();
        this.loadClassRoster(classId);
      },
      error: (err) => {
        this.loading.hide();
        this.rosterNotice.set(err?.error?.error ?? this.translate.instant('error_add_students_failed'));
      },
    });
  }

  private rosterSummary(results: RosterResult[]): string {
    if (results.length === 1) {
      const r = results[0];
      if (r.status === 'failed') return `${r.email}: ${r.error}`;
      if (r.status === 'updated') return this.translate.instant('roster_code_updated', { email: r.email, code: r.externalCourseCode });
      if (r.status === 'unchanged') return this.translate.instant('roster_unchanged', { email: r.email });
      return this.translate.instant(r.account === 'registered' ? 'roster_added' : 'roster_added_pending', { email: r.email });
    }
    const count = (match: (r: RosterResult) => boolean) => results.filter(match).length;
    return this.translate.instant('roster_summary', {
      added:     count(r => r.status === 'enrolled'),
      pending:   count(r => r.status === 'enrolled' && r.account !== 'registered'),
      updated:   count(r => r.status === 'updated'),
      unchanged: count(r => r.status === 'unchanged'),
      failed:    count(r => r.status === 'failed'),
    });
  }

  private loadClassRoster(classId: number) {
    this.courseService.getClassStudents(classId).subscribe({
      next: (students) => {
        if (this.classFilter() !== classId) return;
        this.classStudentIds.set(new Set(students.map(s => s.id)));
        this.classCourseCodes.set(new Map(students.map(s => [s.id, s.externalCourseCode ?? null])));
      },
      error: () => this.classStudentIds.set(null),
    });
  }

  // ── Advanced filters: class & subject ──────────────────────
  onClassFilterChanged(value: string) {
    const classId = value ? parseInt(value, 10) : null;
    this.classFilter.set(classId);
    this.subjectFilter.set(null);
    this.subjects.set([]);
    this.subjectStudentIds.set(null);
    this.addEmail.set('');
    this.addCode.set('');
    this.rosterNotice.set('');
    this.rosterFailures.set([]);
    this.classCourseCodes.set(new Map());

    if (classId === null) {
      this.classStudentIds.set(null);
      return;
    }

    this.loadClassRoster(classId);
    this.assignService.getAssignments(classId).subscribe({
      next: (assignments) => this.subjects.set(assignments),
      error: () => this.subjects.set([]),
    });
  }

  onSubjectFilterChanged(value: string) {
    const assignmentId = value ? parseInt(value, 10) : null;
    this.subjectFilter.set(assignmentId);

    if (assignmentId === null) {
      this.subjectStudentIds.set(null);
      return;
    }

    this.assignService.getAssignmentById(assignmentId).subscribe({
      next: (assignment) => {
        const ids = new Set<number>();
        for (const group of assignment.groups ?? []) {
          for (const member of group.members ?? []) ids.add(member.userId);
        }
        this.subjectStudentIds.set(ids);
      },
      error: () => this.subjectStudentIds.set(null),
    });
  }

  // ── Add member ─────────────────────────────────────────────
  // ── Role badge style ───────────────────────────────────────
  roleStyle(role: string) {
    const map: Record<string, { bg: string; color: string; border: string }> = {
      Student: { bg: DS.colors.cyanSubtle,   color: DS.colors.cyan,   border: DS.colors.cyanBorder   },
      Bocal:   { bg: DS.colors.violetSubtle, color: DS.colors.violet, border: DS.colors.violetBorder },
      Admin:   { bg: DS.colors.amberSubtle,  color: DS.colors.amber,  border: DS.colors.amberBorder  },
    };
    const s = map[role] ?? { bg: DS.colors.surfaceRaised, color: DS.colors.fg3, border: DS.colors.border };
    return {
      fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase',
      padding: '2px 8px', borderRadius: '9999px',
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    };
  }

  // ── Styles ─────────────────────────────────────────────────
  readonly pendingBadgeStyle = {
    fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase' as const,
    padding: '2px 8px', borderRadius: '9999px',
    background: DS.colors.amberSubtle, color: DS.colors.amber, border: `1px solid ${DS.colors.amberBorder}`,
  };
  readonly failureListStyle = { margin: '0', paddingLeft: '18px', fontSize: '0.8125rem', color: DS.colors.red };
  readonly pageStyle       = { display: 'flex', flexDirection: 'column' as const, gap: '0' };
  readonly studentLinkStyle = { background: 'none', border: 'none', padding: '0', fontFamily: DS.fonts.body, fontWeight: '600', fontSize: '0.9375rem', color: DS.colors.cyan, cursor: 'pointer', textAlign: 'left' as const };
  readonly detailsOverlayStyle = { position: 'fixed' as const, inset: '0', background: 'oklch(0% 0 0 / 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', zIndex: '100' };
  readonly detailsCardStyle = { background: DS.colors.surface, color: DS.colors.fg1, border: `1px solid ${DS.colors.border}`, borderRadius: DS.radius.xl, padding: '24px', width: '560px', maxWidth: '100%', maxHeight: '80vh', overflowY: 'auto' as const, fontFamily: DS.fonts.body };
  readonly overlineStyle   = { fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: DS.colors.cyan, marginBottom: '6px' };
  readonly h1Style         = { fontFamily: DS.fonts.display, fontSize: '1.75rem', fontWeight: '700', letterSpacing: '-0.03em', color: DS.colors.fg1 };
  readonly inputStyle      = { width: '100%', boxSizing: 'border-box' as const, padding: '9px 12px', background: DS.colors.bg, border: `1px solid ${DS.colors.border}`, borderRadius: DS.radius.md, color: DS.colors.fg1, fontFamily: DS.fonts.body, fontSize: '0.875rem', outline: 'none' };
  readonly filterBarStyle  = { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' as const };
  readonly filterFieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: '5px', };
  readonly filterLabelStyle = { fontSize: '0.6875rem', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: DS.colors.fg3, };  
}
