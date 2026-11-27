import { extractTokenFromScanInput } from '@lumina/trace-crypto';

/**
 * Normalizes raw barcode / QR scanner input:
 * 1. Accepts canonical 16-char Lumina HMAC trace tokens (and /v/<token> URLs).
 * 2. Also accepts external factory product barcodes / serial numbers (4-64 safe chars)
 *    registered via warehouse scan-to-register inbound.
 */
export function normalizeScanCode(rawInput?: string | null): string | null {
  if (!rawInput) return null;
  const lumina = extractTokenFromScanInput(rawInput);
  if (lumina) return lumina;

  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const q =
        u.searchParams.get('code') ||
        u.searchParams.get('token') ||
        u.searchParams.get('sn') ||
        u.searchParams.get('id');
      const candidate = (q || u.pathname.split('/').filter(Boolean).pop() || '').trim();
      if (/^[0-9A-Za-z._-]{4,64}$/.test(candidate)) {
        return candidate.toUpperCase();
      }
    } catch {
      return null;
    }
    return null;
  }

  const compact = trimmed.replace(/\s+/g, '');
  if (/^[0-9A-Za-z._-]{4,64}$/.test(compact)) {
    return compact.toUpperCase();
  }
  return null;
}
