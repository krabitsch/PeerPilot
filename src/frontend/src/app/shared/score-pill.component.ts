import { Component, input, computed } from '@angular/core';
import { NgStyle } from '@angular/common';
import { DS } from '../tokens';
import { scoreTone } from './score-color';

@Component({
  selector: 'app-score-pill',
  standalone: true,
  imports: [NgStyle],
  template: `<span [ngStyle]="styles()">{{ score() }} / {{ max() }}</span>`,
  styles: [`
    span { font-family: 'JetBrains Mono', monospace; font-size: 0.8125rem;
           font-weight: 500; padding: 3px 10px; border-radius: 9999px; }
  `],
})
export class ScorePillComponent {
  score = input<number>(0);
  max   = input<number>(100);
  passThreshold = input<number>(50);

  styles = computed(() => {
    const tone = scoreTone(this.score(), this.max(), this.passThreshold());
    return { background: DS.colors[`${tone}Subtle`], color: DS.colors[tone] };
  });
}
