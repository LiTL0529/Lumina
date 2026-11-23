import { describe, it, expect } from 'vitest';
import { buildClinicFingerprint, evaluateSupplyRedline } from './index';

describe('evaluateSupplyRedline (3.5折供货红线校验)', () => {
  it('passes when order is exactly at 3.5折 (35%)', () => {
    const res = evaluateSupplyRedline({
      lines: [
        {
          skuCode: 'SP001',
          productName: 'Lumina多维养护油',
          qty: 10,
          retailPrice: 880,
          unitPrice: 880,
          discountPercent: 35,
        },
      ],
    });
    expect(res.passed).toBe(true);
    expect(res.compositeRatio).toBe(0.35);
    expect(res.totalNetReceivable).toBe(3080);
  });

  it('blocks when single line drops below 3.5折', () => {
    const res = evaluateSupplyRedline({
      lines: [
        {
          skuCode: 'SP001',
          productName: 'Lumina多维养护油',
          qty: 10,
          retailPrice: 880,
          unitPrice: 880,
          discountPercent: 32,
        },
      ],
    });
    expect(res.passed).toBe(false);
    expect(res.violations.some((v) => v.scope === 'LINE')).toBe(true);
  });

  it('catches gift bypass where paid lines are 4.0折 but free gifts pull composite below 3.5折', () => {
    const res = evaluateSupplyRedline({
      lines: [
        {
          skuCode: 'SP001',
          productName: 'Lumina多维养护油',
          qty: 10,
          retailPrice: 880,
          unitPrice: 880,
          discountPercent: 40,
        },
        {
          skuCode: 'SP001',
          productName: 'Lumina多维养护油(赠品)',
          qty: 3,
          retailPrice: 880,
          unitPrice: 880,
          discountPercent: 0,
          isGift: true,
        },
      ],
    });
    // 10 * 0.40 / 13 = 0.3077 < 0.35
    expect(res.passed).toBe(false);
    expect(res.compositeRatio).toBeLessThan(0.35);
    expect(res.violations.some((v) => v.scope === 'ORDER_COMPOSITE')).toBe(true);
  });

  it('catches rounding deduction bypass (抹零破红线)', () => {
    const res = evaluateSupplyRedline({
      lines: [
        {
          skuCode: 'SP006',
          productName: 'Lumina多维养护霜',
          qty: 10,
          retailPrice: 698,
          unitPrice: 698,
          discountPercent: 36,
        },
      ],
      roundingAmount: 150,
    });
    // 2512.8 - 150 = 2362.8 / 6980 = 0.3385 < 0.35
    expect(res.passed).toBe(false);
    expect(res.violations[0].scope).toBe('ORDER_COMPOSITE');
  });
});

describe('buildClinicFingerprint', () => {
  it('normalizes minor punctuation and company suffixes identically', () => {
    const a = buildClinicFingerprint({
      name: '南昌 妆典医疗美容诊所',
      cityCode: '360100',
      contactPhone: '13800138000',
    });
    const b = buildClinicFingerprint({
      name: '南昌妆典（有限公司）',
      cityCode: '360100',
      contactPhone: '138-0013-8000',
    });
    expect(a).toBe(b);
  });

  it('prioritizes unified social credit code when present', () => {
    const fp = buildClinicFingerprint({
      creditCode: '91360100MA38XXXXXX',
      name: '任意名称',
      cityCode: '360100',
    });
    expect(fp).toBe('USCC:91360100MA38XXXXXX');
  });
});
