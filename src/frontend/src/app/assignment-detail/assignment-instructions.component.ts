import { Component, input } from '@angular/core';
import type { AssignmentResponse } from '../core/services/course-service/Assignment.service';
import { ContainerComponent, ContainerConfig } from '../shared/container.component';
import { MarkdownMathComponent } from '../shared/markdown-math.component';
import { DS } from '../tokens';
@Component({
  selector: 'app-assignment-instructions', standalone: true,
  imports: [ContainerComponent, MarkdownMathComponent],
  template: `
    <app-container [config]="card">
      <div class="instructions" data-testid="assignment-instructions">
        <div class="heading">Assignment description</div>
        @if (assignment().description.trim()) {
          <app-markdown-math [text]="assignment().description" />
        } @else {
          <p>{{ assignment().file ? 'The assignment questions are provided in the attached file.' : 'Assignment description has not been provided yet.' }}</p>
        }
        @if (assignment().file; as file) {
          <div class="file-action"><a [href]="file.url" target="_blank" rel="noopener noreferrer">Download assignment file</a></div>
        }
      </div>
    </app-container>
  `,
  styles: [`
    .instructions { padding: 18px 20px; }
    .heading { font-size: .6875rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: ${DS.colors.violet}; margin-bottom: 8px; }
    p { margin: 0; font-size: .9375rem; color: ${DS.colors.fg2}; line-height: 1.75; }
    .file-action { display: flex; justify-content: flex-end; margin-top: 16px; }
    a { display: inline-flex; align-items: center; justify-content: center; padding: 9px 18px; border-radius: 8px; font-size: .875rem; font-weight: 500; color: ${DS.colors.violet}; background: ${DS.colors.violetSubtle}; border: 1px solid ${DS.colors.violetBorder}; text-decoration: none; }
    a:hover { background: oklch(27% 0.09 296); }
  `],
})
export class AssignmentInstructionsComponent {
  assignment = input.required<Pick<AssignmentResponse, 'description' | 'file'>>();
  readonly card: ContainerConfig = { variant: 'flat', height: 'auto', scrollable: false };
}
