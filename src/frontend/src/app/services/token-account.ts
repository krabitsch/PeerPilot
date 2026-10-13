// This compares account identity only; the API verifies token signatures.
export function sameTokenAccount(current: string | null, refreshed: string): boolean {
  const userId = (token: string | null): number | null => {
    try {
      const payload = token?.split('.')[1];
      if (!payload) return null;
      const account = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).userId;
      const id = Number(account);
      return Number.isInteger(id) && id > 0 ? id : null;
    } catch {
      return null;
    }
  };
  const currentId = userId(current);
  return currentId !== null && currentId === userId(refreshed);
}
