export function formatDateTime(input?: string | Date | null, withSeconds = false): string {
  if (!input) return '—';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) {
    return typeof input === 'string' ? input.replace('T', ' ').slice(0, withSeconds ? 19 : 16) : '—';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timePart = withSeconds
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${datePart} ${timePart}`;
}
