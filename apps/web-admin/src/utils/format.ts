import { onMounted, onUnmounted, ref } from 'vue';

/**
 * Format an ISO timestamp in China local time (YYYY-MM-DD HH:mm or YYYY-MM-DD HH:mm:ss).
 */
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

export function formatCodeGroups(token?: string | null): string {
  if (!token) return '—';
  const clean = token.trim();
  if (clean.length === 16) {
    return clean.replace(/(.{4})(?=.)/g, '$1 ');
  }
  return clean;
}

export function useViewport() {
  const width = ref(typeof window !== 'undefined' ? window.innerWidth : 1440);
  const update = () => {
    width.value = window.innerWidth;
  };
  onMounted(() => window.addEventListener('resize', update, { passive: true }));
  onUnmounted(() => window.removeEventListener('resize', update));
  return {
    width,
  };
}
