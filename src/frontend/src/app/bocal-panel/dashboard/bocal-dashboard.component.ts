import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ContainerComponent, ContainerConfig } from '../../shared/container.component';
import { BtnComponent } from '../../shared/btn.component';
export interface StaffDashboardData {
  courses: { id: number; name: string; description: string; term: string | null }[];
  actions: { id: string; kind: string; label: string; courseId: number; courseName: string; assignmentId: number;
    occurredAt: string; route: string; queryParams: Record<string, number> }[];
}
@Component({
  selector: 'app-bocal-dashboard', standalone: true,
  imports: [ContainerComponent, BtnComponent, DatePipe],
  styleUrls: ['../../shared/learning-summary.css'],
  template: `
    <div class="learning-page" style="padding:0">
      <div><div class="section-label">Dashboard</div><h1>Welcome back, {{ auth.user()?.username ?? 'there' }}</h1></div>
      @if (loading()) { <div class="muted" role="status">Loading staff actions…</div> }
      @else if (error()) {
        <div class="error" role="alert">{{ error() }}</div><app-btn variant="secondary" (clicked)="load()">Try again</app-btn>
      } @else {
        <app-container [config]="card"><div class="card-content">
          <div class="section-label">Courses</div>
          <label class="muted" for="staff-dashboard-course">Select course</label>
          <select id="staff-dashboard-course" [value]="courseId() ?? ''" (change)="selectCourse($any($event.target).value)">
            <option value="">All courses</option>
            @for (course of data().courses; track course.id) { <option [value]="course.id">{{ course.name }}</option> }
          </select>
          @if (selectedCourse(); as course) { <p class="description">{{ course.description }}</p><span class="muted">{{ course.term }}</span> }
        </div></app-container>
        <app-container [config]="card"><div class="card-content">
          <div class="section-label">Action required · {{ actions().length }}</div>
          @if (!actions().length) { <div class="empty">You're all caught up.</div> }
          @for (action of actions(); track action.id) {
            <div class="action-row">
              <div><div class="action-text">{{ action.label }}</div><div class="muted">Course: {{ action.courseName }}</div>
                @if (action.kind === 'rematch') { <div class="muted">Requested {{ action.occurredAt | date:'medium' }}</div> }
              </div>
              <app-btn variant="secondary" size="sm" (clicked)="open(action)">{{ action.kind === 'rematch' ? 'Review pairing →' : 'Open →' }}</app-btn>
            </div>
          }
        </div></app-container>
        <div class="muted">Actions update automatically when instructions, evaluation sheets, groups or pairings are completed. Rematch requests clear when a replacement pairing exists or the round passes.</div>
      }
    </div>
  `,
})
export class BocalDashboardComponent implements OnInit {
  auth = inject(AuthService);
  private http = inject(HttpClient);
  private router = inject(Router);
  data = signal<StaffDashboardData>({ courses: [], actions: [] });
  loading = signal(false); error = signal<string | null>(null);
  courseId = signal<number | null>(null);
  selectedCourse = computed(() => this.data().courses.find(c => c.id === this.courseId()) ?? null);
  actions = computed(() => this.data().actions.filter(a => this.courseId() === null || a.courseId === this.courseId()));
  readonly card: ContainerConfig = { variant: 'flat', height: 'auto', scrollable: false };
  ngOnInit() { this.load(); }
  load() {
    this.loading.set(true); this.error.set(null);
    this.http.get<StaffDashboardData>('/api/user/me/staff-dashboard').subscribe({
      next: data => { this.data.set(data); this.loading.set(false); },
      error: err => { this.error.set(err?.error?.error ?? 'Could not load staff actions.'); this.loading.set(false); },
    });
  }
  selectCourse(value: string) { this.courseId.set(value ? Number(value) : null); }
  open(action: StaffDashboardData['actions'][number]) { this.router.navigate([action.route], { queryParams: action.queryParams }); }
}
