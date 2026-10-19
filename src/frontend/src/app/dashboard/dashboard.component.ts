import { Component, computed, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { LearningSummaryService, dashboardActions, dashboardInformation } from '../core/services/learning-summary.service';
import { ContainerComponent, ContainerConfig } from '../shared/container.component';
import { BtnComponent } from '../shared/btn.component';
import { LearningCourseComponent } from '../shared/learning-course.component';
@Component({
  selector: 'app-dashboard', standalone: true,
  imports: [ContainerComponent, BtnComponent, LearningCourseComponent],
  templateUrl: './dashboard.component.html', styleUrls: ['../shared/learning-summary.css'],
})
export class DashboardComponent implements OnInit {
  summary = inject(LearningSummaryService);
  router = inject(Router);
  private route = inject(ActivatedRoute);
  private auth = inject(AuthService);
  username = computed(() => this.auth.user()?.username ?? 'there');
  actions = computed(() => dashboardActions(this.summary.selectedCourse()));
  information = computed(() => dashboardInformation(this.summary.selectedCourse()));
  readonly card: ContainerConfig = { variant: 'flat', height: 'auto', scrollable: false };
  ngOnInit() {
    const id = Number(this.route.snapshot.queryParamMap.get('classId'));
    if (id) this.summary.courseId.set(id);
    this.summary.load();
  }
  openAction(action: ReturnType<typeof dashboardActions>[number]) {
    this.router.navigate([action.route], { queryParams: action.queryParams });
  }
  assignments() { this.router.navigate(['/assignment'], { queryParams: { classId: this.summary.courseId() } }); }
  progress() { this.router.navigate(['/progress'], { queryParams: { classId: this.summary.courseId() } }); }
}
