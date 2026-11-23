import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// Crockford Base32 alphabet without ambiguous characters (I, L, O, U)
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHAR_MAP: Record<string, number> = Object.fromEntries(
  ALPHABET.split('').map((c, idx) => [c, idx]),
);
// Common visual OCR / manual typing aliases
CHAR_MAP['O'] = 0;
CHAR_MAP['I'] = 1;
CHAR_MAP['L'] = 1;

function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(str: string): Buffer | null {
  const clean = str.trim().toUpperCase().replace(/[-\s]/g, '');
  if (!clean || clean.length !== 16) return null;

  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const v = CHAR_MAP[ch];
    if (v === undefined) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length !== 10) return null;
  return Buffer.from(out);
}

/**
 * Generates an unpredictable, tamper-evident 16-char anti-counterfeiting code token:
 * 7 bytes CSPRNG entropy (56 bits) + 3 bytes truncated HMAC-SHA256 signature (24 bits) = 80 bits -> 16 Crockford Base32 chars.
 * Prefixing level ('C' for carton vs 'U' for unit) is kept separate or encoded in payload metadata;
 * the 16-char token itself is purely cryptographic and non-enumerable.
 */
export function generateTraceToken(
  secret: string,
  level: 'UNIT' | 'CARTON' = 'UNIT',
): string {
  const payload = randomBytes(7);
  // Encode level bit in MSB of payload[0] for quick structural differentiation
  if (level === 'CARTON') {
    payload[0] = payload[0] | 0x80;
  } else {
    payload[0] = payload[0] & 0x7f;
  }
  const mac = createHmac('sha256', secret).update(payload).digest().subarray(0, 3);
  const full = Buffer.concat([payload, mac]); // 10 bytes = 80 bits = 16 Base32 chars
  return encodeBase32(full);
}

/**
 * Stateless constant-time HMAC signature validation to reject forged or mistyped codes
 * before touching the database.
 */
export function verifyTraceTokenSignature(
  token: string,
  secret: string,
): { valid: boolean; normalizedToken?: string; level?: 'UNIT' | 'CARTON' } {
  const raw = decodeBase32(token);
  if (!raw) return { valid: false };

  const payload = raw.subarray(0, 7);
  const providedMac = raw.subarray(7, 10);
  const expectedMac = createHmac('sha256', secret).update(payload).digest().subarray(0, 3);

  if (!timingSafeEqual(providedMac, expectedMac)) {
    return { valid: false };
  }

  const level: 'UNIT' | 'CARTON' = (payload[0] & 0x80) !== 0 ? 'CARTON' : 'UNIT';
  return {
    valid: true,
    normalizedToken: encodeBase32(raw),
    level,
  };
}

/**
 * Builds the canonical short verification URL encoded into product QR codes.
 * Compatible with WeChat "Scan URL QR to Open Mini Program" & independent-domain H5.
 */
export function buildVerifyUrl(baseUrl: string, token: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/${token}`;
}

/**
 * Extracts a clean 16-char trace token from raw USB scanner or camera input,
 * handling full URLs, query params, hyphens, whitespace, and stray IME characters.
 */
export function extractTokenFromScanInput(rawInput: string): string | null {
  if (!rawInput) return null;
  const trimmed = rawInput.trim();

  // Match /v/<token> or ?code=<token> or ?token=<token>
  const urlMatch = trimmed.match(/(?:\/v\/|[?&](?:code|token)=)([0-9A-Za-z-]{16,20})/i);
  if (urlMatch) {
    const cleaned = urlMatch[1].toUpperCase().replace(/[-\s]/g, '');
    return cleaned.length === 16 ? cleaned : null;
  }

  // Raw token input (with optional dashes like XXXX-XXXX-XXXX-XXXX)
  const rawClean = trimmed.toUpperCase().replace(/[-\s]/g, '');
  if (/^[0-9A-Z]{16}$/.test(rawClean)) {
    return rawClean;
  }
  return null;
}

export interface GeneratedBatchCodes {
  cartons: Array<{
    cartonToken: string;
    cartonUrl: string;
    unitTokens: Array<{ token: string; url: string }>;
  }>;
  looseUnits: Array<{ token: string; url: string }>;
}

/**
 * Generates a paired set of carton codes and nested unit codes for factory printing.
 */
export function generateBatchCodeSet(params: {
  unitCount: number;
  cartonQty: number;
  secret: string;
  verifyBaseUrl: string;
  enableCarton?: boolean;
}): GeneratedBatchCodes {
  const { unitCount, cartonQty, secret, verifyBaseUrl, enableCarton = true } = params;
  const used = new Set<string>();

  const nextUnique = (level: 'UNIT' | 'CARTON') => {
    let t = generateTraceToken(secret, level);
    while (used.has(t)) {
      t = generateTraceToken(secret, level);
    }
    used.add(t);
    return t;
  };

  const cartons: GeneratedBatchCodes['cartons'] = [];
  const looseUnits: GeneratedBatchCodes['looseUnits'] = [];

  if (!enableCarton || cartonQty <= 1) {
    for (let i = 0; i < unitCount; i++) {
      const token = nextUnique('UNIT');
      looseUnits.push({ token, url: buildVerifyUrl(verifyBaseUrl, token) });
    }
    return { cartons, looseUnits };
  }

  const fullCartons = Math.floor(unitCount / cartonQty);
  const remainder = unitCount % cartonQty;

  for (let c = 0; c < fullCartons; c++) {
    const cartonToken = nextUnique('CARTON');
    const unitTokens: Array<{ token: string; url: string }> = [];
    for (let u = 0; u < cartonQty; u++) {
      const token = nextUnique('UNIT');
      unitTokens.push({ token, url: buildVerifyUrl(verifyBaseUrl, token) });
    }
    cartons.push({
      cartonToken,
      cartonUrl: buildVerifyUrl(verifyBaseUrl, cartonToken),
      unitTokens,
    });
  }

  for (let r = 0; r < remainder; r++) {
    const token = nextUnique('UNIT');
    looseUnits.push({ token, url: buildVerifyUrl(verifyBaseUrl, token) });
  }

  return { cartons, looseUnits };
}
