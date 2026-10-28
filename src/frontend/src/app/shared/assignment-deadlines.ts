// datetime-local represents browser local time; the API always receives an instant.
export const deadlineInput = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19);
};
export const deadlineIso = (value: string): string | null => value ? new Date(value).toISOString() : null;
export const deadlineOrderError = (submission: string, evaluation: string): string | null =>
  submission && evaluation && new Date(evaluation) < new Date(submission)
    ? 'Peer-evaluation deadline must be on or after the submission deadline.' : null;
export const deadlinePassed = (value?: string | null): boolean => !!value && Date.now() > new Date(value).getTime();
export const formatDeadline = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date)}, ${pad(date.getDate())}.${pad(date.getMonth()+1)}.${date.getFullYear()} at ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
