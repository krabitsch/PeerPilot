import { Component, input, output } from '@angular/core';
import { LearningCourse } from '../core/services/learning-summary.service';
@Component({
  selector: 'app-learning-course', standalone: true,
  styleUrls: ['./learning-summary.css'],
  template: `
    <div class="course-grid">
      <div>
        <div class="section-label">Current course</div>
        <h2>{{ selected()?.name }}</h2>
        <div class="muted">{{ selected()?.term }}
          @if (selected()?.externalCourseCode) { · WU course {{ selected()?.externalCourseCode }} }
        </div>
        <p class="description">{{ selected()?.description }}</p>
      </div>
      <div>
        <label class="section-label" for="learning-course">Select course</label>
        <select id="learning-course" [value]="selected()?.id" (change)="selectedId.emit(+$any($event.target).value)">
          @for (course of courses(); track course.id) { <option [value]="course.id">{{ course.name }}</option> }
        </select>
      </div>
    </div>
  `,
})
export class LearningCourseComponent {
  courses = input<LearningCourse[]>([]);
  selected = input<LearningCourse | null>(null);
  selectedId = output<number>();
}
