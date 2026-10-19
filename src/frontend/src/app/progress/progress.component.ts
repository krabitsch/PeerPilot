import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LearningSummaryService, learningStatusMeta } from '../core/services/learning-summary.service';
import { ContainerComponent, ContainerConfig } from '../shared/container.component';
import { BtnComponent } from '../shared/btn.component';
import { BadgeComponent } from '../shared/badge.component';
import { LearningCourseComponent } from '../shared/learning-course.component';
@Component({
  selector: 'app-progress', standalone: true,
  imports: [ContainerComponent, BtnComponent, BadgeComponent, LearningCourseComponent],
  templateUrl: './progress.component.html', styleUrls: ['../shared/learning-summary.css'],
})
export class ProgressComponent implements OnInit {
  summary = inject(LearningSummaryService);
  router = inject(Router);
  private route = inject(ActivatedRoute);
  readonly statusMeta = learningStatusMeta;
  readonly card: ContainerConfig = { variant: 'flat', height: 'auto', scrollable: false };
  ngOnInit() {
    const id = Number(this.route.snapshot.queryParamMap.get('classId'));
    if (id) this.summary.courseId.set(id);
    this.summary.load();
  }
  viewAssignment(assId: number) { this.router.navigate(['/assignment-detail'], { queryParams: { assId } }); }
  evaluatorTasks() { this.router.navigate(['/evaluation'], { queryParams: { classId: this.summary.courseId() } }); }
}
