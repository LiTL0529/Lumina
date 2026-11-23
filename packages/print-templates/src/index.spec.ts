import { describe, it, expect } from 'vitest';
import { PrintPaperType } from '@lumina/shared-types';
import { buildHiprintTemplate, ORDER_TABLE_COLUMNS, PAPER_DIMENSIONS } from './index';

describe('print-templates needle printer builder', () => {
  it('builds 241x140mm needle template matching selected columns', () => {
    const visible = ['index', 'productName', 'skuCode', 'qty', 'unitPrice', 'lineAmount'];
    const payload = buildHiprintTemplate({
      paperType: PrintPaperType.NEEDLE_241_140,
      title: 'Lumina 品牌供销出库单',
      visibleColumns: visible,
      systemVars: ['docNo', 'docDate', 'customerName', 'totalAmount'],
    });

    expect(payload.panels).toHaveLength(1);
    expect(payload.panels[0].width).toBe(PAPER_DIMENSIONS[PrintPaperType.NEEDLE_241_140].widthMm);
    expect(payload.panels[0].height).toBe(140);

    const tableEl = payload.panels[0].printElements.find(
      (e) => (e.printElementType as { type: string }).type === 'table',
    );
    expect(tableEl).toBeDefined();
    const cols = ((tableEl!.options as { columns: Array<Array<{ field: string }>> }).columns)[0];
    expect(cols.map((c) => c.field)).toEqual(visible);
    expect(ORDER_TABLE_COLUMNS.length).toBeGreaterThanOrEqual(10);
  });
});
