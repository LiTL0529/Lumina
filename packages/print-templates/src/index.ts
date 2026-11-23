import { PrintPaperType } from '@lumina/shared-types';

export interface PrintColumnDef {
  key: string;
  label: string;
  widthMm: number;
  align?: 'left' | 'center' | 'right';
  defaultVisible: boolean;
}

export interface PaperDimension {
  type: PrintPaperType;
  label: string;
  description: string;
  widthMm: number;
  heightMm: number;
  marginMm: { top: number; right: number; bottom: number; left: number };
}

export const PAPER_DIMENSIONS: Record<PrintPaperType, PaperDimension> = {
  [PrintPaperType.NEEDLE_241_140]: {
    type: PrintPaperType.NEEDLE_241_140,
    label: '241×140mm 针式二等分三联单',
    description: '适用于老式针式打印机（爱普生 LQ-630K 等）标准无碳复写二等分联单',
    widthMm: 215,
    heightMm: 140,
    marginMm: { top: 6, right: 8, bottom: 6, left: 8 },
  },
  [PrintPaperType.NEEDLE_241_93]: {
    type: PrintPaperType.NEEDLE_241_93,
    label: '241×93mm 针式三等分短联单',
    description: '适用于精简出库单/提货单，三等分连续孔纸',
    widthMm: 215,
    heightMm: 93,
    marginMm: { top: 5, right: 8, bottom: 5, left: 8 },
  },
  [PrintPaperType.A4]: {
    type: PrintPaperType.A4,
    label: 'A4 标准溯源出库单',
    description: '完整呈现商品明细、溯源单品/箱码清单及双方签收栏',
    widthMm: 210,
    heightMm: 297,
    marginMm: { top: 10, right: 10, bottom: 10, left: 10 },
  },
  [PrintPaperType.THERMAL_50_30]: {
    type: PrintPaperType.THERMAL_50_30,
    label: '50×30mm 热敏箱码/盒码标贴',
    description: '适用于箱码/补码热敏打印机贴纸',
    widthMm: 50,
    heightMm: 30,
    marginMm: { top: 2, right: 2, bottom: 2, left: 2 },
  },
  [PrintPaperType.TICKET_80]: {
    type: PrintPaperType.TICKET_80,
    label: '80mm 热敏小票',
    description: '适用于门店或自提点热敏小票机',
    widthMm: 80,
    heightMm: 180,
    marginMm: { top: 4, right: 4, bottom: 4, left: 4 },
  },
};

export const ORDER_TABLE_COLUMNS: PrintColumnDef[] = [
  { key: 'index', label: '序号', widthMm: 10, align: 'center', defaultVisible: true },
  { key: 'productName', label: '商品名称', widthMm: 46, align: 'left', defaultVisible: true },
  { key: 'skuCode', label: '货号', widthMm: 22, align: 'left', defaultVisible: true },
  { key: 'spec', label: '型号规格', widthMm: 22, align: 'center', defaultVisible: true },
  { key: 'unitName', label: '单位', widthMm: 12, align: 'center', defaultVisible: true },
  { key: 'qty', label: '数量', widthMm: 14, align: 'right', defaultVisible: true },
  { key: 'unitPrice', label: '单价', widthMm: 18, align: 'right', defaultVisible: true },
  { key: 'discountPercent', label: '折扣(%)', widthMm: 16, align: 'right', defaultVisible: true },
  { key: 'discountedPrice', label: '折后价', widthMm: 18, align: 'right', defaultVisible: false },
  { key: 'lineAmount', label: '金额', widthMm: 22, align: 'right', defaultVisible: true },
  { key: 'traceCount', label: '已扫溯源码', widthMm: 18, align: 'center', defaultVisible: true },
  { key: 'remark', label: '商品备注', widthMm: 24, align: 'left', defaultVisible: false },
];

export const ORDER_SYSTEM_VARS = [
  { key: 'docNo', label: '单号', defaultVisible: true },
  { key: 'docDate', label: '单据日期', defaultVisible: true },
  { key: 'customerName', label: '客户/机构名称', defaultVisible: true },
  { key: 'warehouseName', label: '出库仓库', defaultVisible: true },
  { key: 'salesRepName', label: '销售员', defaultVisible: true },
  { key: 'creatorName', label: '制单人', defaultVisible: true },
  { key: 'shippingInfo', label: '发货方式/快递单号', defaultVisible: true },
  { key: 'docRemark', label: '单据备注', defaultVisible: true },
  { key: 'totalAmount', label: '本单应收', defaultVisible: true },
  { key: 'paidAmount', label: '本单实收', defaultVisible: true },
  { key: 'previousArrears', label: '上次欠款', defaultVisible: true },
  { key: 'totalArrears', label: '累计欠款', defaultVisible: true },
];

export interface PrintTemplateConfig {
  paperType: PrintPaperType;
  title: string;
  visibleColumns: string[];
  systemVars: string[];
}

export interface HiprintPanelPayload {
  panels: Array<{
    index: number;
    paperType: string;
    width: number;
    height: number;
    paperHeader: number;
    paperFooter: number;
    printElements: Array<Record<string, unknown>>;
  }>;
}

/**
 * Generates a hiprint-compatible JSON template with millimeter-calibrated coordinates
 * specifically optimized for dot-matrix continuous forms (241x140mm / 241x93mm) and A4.
 */
export function buildHiprintTemplate(config: PrintTemplateConfig): HiprintPanelPayload {
  const dim = PAPER_DIMENSIONS[config.paperType] ?? PAPER_DIMENSIONS[PrintPaperType.NEEDLE_241_140];
  const ptPerMm = 2.83465;
  const contentWidthPt = Math.round((dim.widthMm - dim.marginMm.left - dim.marginMm.right) * ptPerMm);
  const leftPt = Math.round(dim.marginMm.left * ptPerMm);

  const selectedCols = ORDER_TABLE_COLUMNS.filter((c) => config.visibleColumns.includes(c.key));
  const totalRawWidth = selectedCols.reduce((sum, c) => sum + c.widthMm, 0) || 1;

  const hiprintColumns = selectedCols.map((col) => ({
    title: col.label,
    field: col.key,
    width: Math.round((col.widthMm / totalRawWidth) * contentWidthPt),
    align: col.align ?? 'left',
    halign: 'center',
  }));

  const headerLines: string[] = [];
  if (config.systemVars.includes('customerName')) headerLines.push('客户：#customerName#');
  if (config.systemVars.includes('docNo')) headerLines.push('单号：#docNo#');
  if (config.systemVars.includes('docDate')) headerLines.push('日期：#docDate#');
  if (config.systemVars.includes('warehouseName')) headerLines.push('仓库：#warehouseName#');
  if (config.systemVars.includes('salesRepName')) headerLines.push('销售员：#salesRepName#');

  const footerLines: string[] = [];
  if (config.systemVars.includes('totalAmount')) footerLines.push('本单应收：¥#totalAmount#');
  if (config.systemVars.includes('paidAmount')) footerLines.push('实收：¥#paidAmount#');
  if (config.systemVars.includes('previousArrears')) footerLines.push('上次欠款：¥#previousArrears#');
  if (config.systemVars.includes('totalArrears')) footerLines.push('总欠款：¥#totalArrears#');

  const elements: Array<Record<string, unknown>> = [
    {
      options: {
        left: leftPt,
        top: 10,
        width: contentWidthPt,
        height: 24,
        title: config.title,
        textAlign: 'center',
        fontSize: config.paperType === PrintPaperType.NEEDLE_241_93 ? 13 : 15,
        fontWeight: '700',
      },
      printElementType: { type: 'text' },
    },
    {
      options: {
        left: leftPt,
        top: 38,
        width: contentWidthPt,
        height: 22,
        title: headerLines.join('   '),
        fontSize: 9.5,
      },
      printElementType: { type: 'text' },
    },
    {
      options: {
        left: leftPt,
        top: 64,
        width: contentWidthPt,
        height: Math.max(80, Math.round(dim.heightMm * ptPerMm) - 135),
        field: 'items',
        columns: [hiprintColumns],
        fontSize: 9,
      },
      printElementType: { type: 'table' },
    },
    {
      options: {
        left: leftPt,
        top: Math.round(dim.heightMm * ptPerMm) - 62,
        width: contentWidthPt,
        height: 20,
        title: footerLines.join('   '),
        fontSize: 9.5,
        fontWeight: '600',
      },
      printElementType: { type: 'text' },
    },
    {
      options: {
        left: leftPt,
        top: Math.round(dim.heightMm * ptPerMm) - 36,
        width: contentWidthPt,
        height: 18,
        title: '制单人：#creatorName#   库管复核：________   收货签收：________   （一物一码防伪溯源单据）',
        fontSize: 8.5,
      },
      printElementType: { type: 'text' },
    },
  ];

  return {
    panels: [
      {
        index: 0,
        paperType: config.paperType,
        width: dim.widthMm,
        height: dim.heightMm,
        paperHeader: 0,
        paperFooter: Math.round(dim.heightMm * ptPerMm),
        printElements: elements,
      },
    ],
  };
}
