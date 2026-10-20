import { DS } from '../tokens';

// Passing is assignment-specific; high failing scores must never appear green.
export function scoreTone(score: number, max: number, threshold = 50): 'green' | 'amber' | 'red' {
  const percentage = max > 0 ? score / max * 100 : 0;
  if (max > 0 && percentage >= threshold) return 'green';
  return percentage >= 50 ? 'amber' : 'red';
}
export function scoreColor(score: number, max: number, threshold = 50): string {
  return DS.colors[scoreTone(score, max, threshold)];
}
