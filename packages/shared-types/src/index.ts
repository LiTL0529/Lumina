export enum OrgType {
  HQ = 'HQ',
  DEALER = 'DEALER',
}

export enum RoleCode {
  HQ_ADMIN = 'HQ_ADMIN',
  HQ_WAREHOUSE = 'HQ_WAREHOUSE',
  HQ_COMPLIANCE = 'HQ_COMPLIANCE',
  DEALER_ADMIN = 'DEALER_ADMIN',
  DEALER_WAREHOUSE = 'DEALER_WAREHOUSE',
  SALES_REP = 'SALES_REP',
}

export enum TraceCodeLevel {
  UNIT = 'UNIT',
  CARTON = 'CARTON',
}

export enum TraceCodeStatus {
  GENERATED = 'GENERATED',
  IN_HQ_STOCK = 'IN_HQ_STOCK',
  IN_TRANSIT_TO_DEALER = 'IN_TRANSIT_TO_DEALER',
  IN_DEALER_STOCK = 'IN_DEALER_STOCK',
  SOLD_TO_CLINIC = 'SOLD_TO_CLINIC',
  CONSUMED = 'CONSUMED',
  UNPACKED = 'UNPACKED',
  VOIDED = 'VOIDED',
}

export enum TraceEventType {
  BATCH_GENERATED = 'BATCH_GENERATED',
  CARTON_BOUND = 'CARTON_BOUND',
  HQ_INBOUND = 'HQ_INBOUND',
  HQ_OUTBOUND = 'HQ_OUTBOUND',
  DEALER_INBOUND = 'DEALER_INBOUND',
  DEALER_OUTBOUND = 'DEALER_OUTBOUND',
  CARTON_UNPACKED = 'CARTON_UNPACKED',
  RETURN_TO_DEALER = 'RETURN_TO_DEALER',
  RETURN_TO_HQ = 'RETURN_TO_HQ',
  CONSUMER_VERIFIED = 'CONSUMER_VERIFIED',
  VOIDED = 'VOIDED',
}

export enum ClinicBindStatus {
  PUBLIC_POOL = 'PUBLIC_POOL',
  PROTECTED_90D = 'PROTECTED_90D',
  BOUND_ACTIVE = 'BOUND_ACTIVE',
}

export enum OrderScene {
  HQ_TO_DEALER = 'HQ_TO_DEALER',
  DEALER_TO_CLINIC = 'DEALER_TO_CLINIC',
}

export enum SalesOrderStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  PENDING_OUTBOUND = 'PENDING_OUTBOUND',
  PARTIAL_OUTBOUND = 'PARTIAL_OUTBOUND',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum PurchaseOrderStatus {
  DRAFT = 'DRAFT',
  PENDING_INBOUND = 'PENDING_INBOUND',
  PARTIAL_INBOUND = 'PARTIAL_INBOUND',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum RedlineStatus {
  PASS = 'PASS',
  BLOCKED = 'BLOCKED',
  SPECIAL_APPROVED = 'SPECIAL_APPROVED',
}

export enum AlertType {
  CROSS_REGION = 'CROSS_REGION',
  UNAUTHORIZED_SCAN = 'UNAUTHORIZED_SCAN',
  HIGH_FREQ_VERIFY = 'HIGH_FREQ_VERIFY',
  PRICE_BELOW_REDLINE = 'PRICE_BELOW_REDLINE',
  RETAIL_PRICE_REPORT = 'RETAIL_PRICE_REPORT',
  RECONCILIATION_VARIANCE = 'RECONCILIATION_VARIANCE',
}

export enum AlertSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum AlertStatus {
  OPEN = 'OPEN',
  INVESTIGATING = 'INVESTIGATING',
  RESOLVED = 'RESOLVED',
}

export enum ReconciliationStatus {
  PENDING_SUBMIT = 'PENDING_SUBMIT',
  SUBMITTED = 'SUBMITTED',
  MATCHED = 'MATCHED',
  VARIANCE_FLAGGED = 'VARIANCE_FLAGGED',
  RESOLVED = 'RESOLVED',
}

export enum PrintPaperType {
  NEEDLE_241_140 = '241x140',
  NEEDLE_241_93 = '241x93',
  A4 = 'A4',
  THERMAL_50_30 = '50x30',
  TICKET_80 = '80mm',
}

export interface RedlineCheckLineInput {
  skuCode: string;
  productName: string;
  qty: number;
  retailPrice: number;
  unitPrice: number;
  /** Discount percentage in 0..100 (e.g. 35 means 3.5折) */
  discountPercent: number;
  /** Minimum allowed supply ratio in 0..1 (default 0.35 for 3.5折) */
  minSupplyRatio?: number;
  isGift?: boolean;
}

export interface RedlineCheckInput {
  lines: RedlineCheckLineInput[];
  /** Whole-order rounding deduction (抹零金额 >= 0) */
  roundingAmount?: number;
  /** Default minimum composite supply ratio (default 0.35) */
  defaultMinSupplyRatio?: number;
}

export interface RedlineViolation {
  scope: 'LINE' | 'ORDER_COMPOSITE';
  skuCode?: string;
  productName?: string;
  actualRatio: number;
  requiredRatio: number;
  message: string;
}

export interface RedlineEvaluationResult {
  passed: boolean;
  totalRetailValue: number;
  totalNetReceivable: number;
  compositeRatio: number;
  requiredCompositeRatio: number;
  violations: RedlineViolation[];
}

/**
 * Evaluates Lumina's 3.5折 supply redline against both individual non-gift lines
 * and whole-order composite ratio (including gifts and rounding deductions)
 * so free gifts or rounding cannot be used to bypass price control.
 */
export function evaluateSupplyRedline(input: RedlineCheckInput): RedlineEvaluationResult {
  const defaultMin = input.defaultMinSupplyRatio ?? 0.35;
  const roundingAmount = Math.max(0, Number(input.roundingAmount ?? 0));
  const violations: RedlineViolation[] = [];

  let totalRetailValue = 0;
  let totalLinesNet = 0;
  let weightedMinThresholdAmount = 0;

  for (const line of input.lines) {
    const qty = Number(line.qty);
    const retailPrice = Number(line.retailPrice);
    if (qty <= 0 || retailPrice <= 0) continue;

    const minRatio = line.minSupplyRatio ?? defaultMin;
    const lineRetail = qty * retailPrice;
    totalRetailValue += lineRetail;
    weightedMinThresholdAmount += lineRetail * minRatio;

    const lineNet = line.isGift
      ? 0
      : qty * Number(line.unitPrice) * (Number(line.discountPercent) / 100);
    totalLinesNet += lineNet;

    if (!line.isGift) {
      const lineRatio = Number((lineNet / lineRetail).toFixed(4));
      if (lineRatio + 1e-6 < minRatio) {
        violations.push({
          scope: 'LINE',
          skuCode: line.skuCode,
          productName: line.productName,
          actualRatio: lineRatio,
          requiredRatio: minRatio,
          message: `商品【${line.productName}】折算供货价为官方指导价的 ${(lineRatio * 10).toFixed(2)} 折，低于 ${(minRatio * 10).toFixed(1)} 折供货红线`,
        });
      }
    }
  }

  const totalNetReceivable = Math.max(0, Number((totalLinesNet - roundingAmount).toFixed(2)));
  const compositeRatio =
    totalRetailValue > 0 ? Number((totalNetReceivable / totalRetailValue).toFixed(4)) : 1;
  const requiredCompositeRatio =
    totalRetailValue > 0
      ? Number((weightedMinThresholdAmount / totalRetailValue).toFixed(4))
      : defaultMin;

  if (totalRetailValue > 0 && compositeRatio + 1e-6 < requiredCompositeRatio) {
    violations.push({
      scope: 'ORDER_COMPOSITE',
      actualRatio: compositeRatio,
      requiredRatio: requiredCompositeRatio,
      message: `整单含赠品与抹零综合折率为 ${(compositeRatio * 10).toFixed(2)} 折，低于合同 ${(requiredCompositeRatio * 10).toFixed(1)} 折供货红线`,
    });
  }

  return {
    passed: violations.length === 0,
    totalRetailValue: Number(totalRetailValue.toFixed(2)),
    totalNetReceivable,
    compositeRatio,
    requiredCompositeRatio,
    violations,
  };
}

/**
 * Generates a normalized deduplication fingerprint for a terminal clinic
 * to prevent duplicate reporting by competing dealers in the same city.
 */
export function buildClinicFingerprint(params: {
  creditCode?: string | null;
  name: string;
  cityCode: string;
  contactPhone?: string | null;
}): string {
  const cleanCredit = (params.creditCode || '').trim().toUpperCase();
  if (cleanCredit.length >= 15) {
    return `USCC:${cleanCredit}`;
  }
  const cleanName = params.name
    .trim()
    .toLowerCase()
    .replace(/[\s\-_()（）【】\[\]·.,，。]/g, '')
    .replace(/(有限公司|有限责任公司|医疗美容诊所|医疗美容门诊部|美容院|皮肤管理中心)$/g, '');
  const cleanCity = params.cityCode.trim().toUpperCase();
  const cleanPhone = (params.contactPhone || '').replace(/\D/g, '').slice(-11);
  return `NAME:${cleanCity}:${cleanName}${cleanPhone ? ':' + cleanPhone : ''}`;
}
