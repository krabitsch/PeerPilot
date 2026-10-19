import type { EvaluatorTask } from '../core/services/eval-service/eval-service';

export function evaluatorTasksFor(tasks: EvaluatorTask[], courseId: number | null, assignmentId: number | null) {
  return tasks.filter(task => task.assignment.classid === courseId &&
    (assignmentId === null || task.assignmentId === assignmentId))
    .sort((a, b) => new Date(a.assignment.created_at).getTime() - new Date(b.assignment.created_at).getTime() ||
      a.assignmentId - b.assignmentId || a.round - b.round || a.id - b.id);
}

export function evalueeNames(task: EvaluatorTask): string {
  return task.evalueeGroup.members.map(member => `${member.user.username}${member.user.email ? ` (${member.user.email})` : ''}`).join(', ') || task.evalueeGroup.name;
}
