import { describe, it, expect } from 'vitest';
import {
  buildVerifyUrl,
  extractTokenFromScanInput,
  generateBatchCodeSet,
  generateTraceToken,
  verifyTraceTokenSignature,
} from './index';

const SECRET = 'unit_test_secret_key_2026';

describe('trace-crypto anti-counterfeiting engine', () => {
  it('generates valid 16-char Crockford Base32 tokens for UNIT and CARTON', () => {
    const unitToken = generateTraceToken(SECRET, 'UNIT');
    const cartonToken = generateTraceToken(SECRET, 'CARTON');

    expect(unitToken).toHaveLength(16);
    expect(cartonToken).toHaveLength(16);

    const uCheck = verifyTraceTokenSignature(unitToken, SECRET);
    expect(uCheck.valid).toBe(true);
    expect(uCheck.level).toBe('UNIT');

    const cCheck = verifyTraceTokenSignature(cartonToken, SECRET);
    expect(cCheck.valid).toBe(true);
    expect(cCheck.level).toBe('CARTON');
  });

  it('rejects any single-character tampering or wrong secret', () => {
    const token = generateTraceToken(SECRET, 'UNIT');
    const lastChar = token[15];
    const tampered = token.slice(0, 15) + (lastChar === 'A' ? 'B' : 'A');

    expect(verifyTraceTokenSignature(tampered, SECRET).valid).toBe(false);
    expect(verifyTraceTokenSignature(token, 'wrong_secret').valid).toBe(false);
    expect(verifyTraceTokenSignature('SHORT', SECRET).valid).toBe(false);
  });

  it('extracts tokens cleanly from full QR URLs, query params, and hyphenated input', () => {
    const token = generateTraceToken(SECRET, 'UNIT');
    const url = buildVerifyUrl('https://v.lumina.cn/v', token);

    expect(extractTokenFromScanInput(url)).toBe(token);
    expect(extractTokenFromScanInput(`https://v.lumina.cn/verify?code=${token}`)).toBe(token);
    expect(
      extractTokenFromScanInput(
        `${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8, 12)}-${token.slice(12, 16)}`,
      ),
    ).toBe(token);
    expect(extractTokenFromScanInput('invalid-text')).toBeNull();
  });

  it('generates 5,000 collision-free codes with paired carton-unit hierarchy', () => {
    const res = generateBatchCodeSet({
      unitCount: 5000,
      cartonQty: 24,
      secret: SECRET,
      verifyBaseUrl: 'https://v.lumina.cn/v',
      enableCarton: true,
    });
    expect(res.cartons).toHaveLength(208); // 208 * 24 = 4992
    expect(res.looseUnits).toHaveLength(8);

    const all = new Set<string>();
    for (const c of res.cartons) {
      all.add(c.cartonToken);
      for (const u of c.unitTokens) {
        all.add(u.token);
      }
    }
    for (const u of res.looseUnits) {
      all.add(u.token);
    }
    expect(all.size).toBe(208 + 5000);
  });
});
