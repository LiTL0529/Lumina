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
  PROSPECT_LEAD = 'PROSPECT_LEAD',
  PUBLIC_POOL = 'PUBLIC_POOL',
  PROTECTED_90D = 'PROTECTED_90D',
  BOUND_ACTIVE = 'BOUND_ACTIVE',
}

export enum CustomerLifecycleStage {
  PROSPECT = 'PROSPECT',
  EXISTING_ACTIVE = 'EXISTING_ACTIVE',
  EXISTING_DORMANT = 'EXISTING_DORMANT',
}

export enum VisitScene {
  NEW_PROSPECT = 'NEW_PROSPECT',
  EXISTING_MAINTENANCE = 'EXISTING_MAINTENANCE',
}

export enum TargetConversionStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  CONVERTED = 'CONVERTED',
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
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
      violations.push({
        scope: 'LINE',
        skuCode: line.skuCode,
        productName: line.productName,
        actualRatio: 0,
        requiredRatio: line.minSupplyRatio ?? defaultMin,
        message: `商品【${line.productName}】数量必须为大于 0 的正整数`,
      });
      continue;
    }
    if (!line.isGift) {
      const disc = Number(line.discountPercent);
      if (!Number.isFinite(disc) || disc < 0 || disc > 100) {
        violations.push({
          scope: 'LINE',
          skuCode: line.skuCode,
          productName: line.productName,
          actualRatio: 0,
          requiredRatio: line.minSupplyRatio ?? defaultMin,
          message: `商品【${line.productName}】折扣必须在 0%~100% 之间`,
        });
        continue;
      }
    }
    if (!Number.isFinite(retailPrice) || retailPrice <= 0) continue;

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
  let cleanName = params.name
    .trim()
    .toLowerCase()
    .replace(/[\s\-_()（）【】\[\]·.,，。]/g, '');
  const suffixRe =
    /(有限责任公司|有限公司|医疗美容门诊部|医疗美容诊所|医疗美容医院|皮肤管理中心|美容美体中心|皮肤管理|美肤中心|医美中心|抗衰中心|美学中心|美容会所|美容院|养生馆)$/;
  let prev = '';
  while (cleanName && cleanName !== prev) {
    prev = cleanName;
    cleanName = cleanName.replace(suffixRe, '');
  }
  const cleanCity = params.cityCode.trim().toUpperCase();
  const cleanPhone = (params.contactPhone || '').replace(/\D/g, '').slice(-11);
  return `NAME:${cleanCity}:${cleanName}${cleanPhone ? ':' + cleanPhone : ''}`;
}

// ============================================================================
// 5. Channel Acquisition & Store Scoring Engine (纳新&复购 SOP · 五维 100 分制)
// ============================================================================

export interface ScoringOptionDef {
  value: string;
  score: number;
  note: string;
}

export interface ScoringDimensionDef {
  key: 'storeType' | 'trafficPrice' | 'storeArea' | 'beauticianCount' | 'storeScale';
  label: string;
  shortLabel: string;
  options: ScoringOptionDef[];
}

export const STORE_SCORING_DIMENSIONS: ScoringDimensionDef[] = [
  {
    key: 'storeType',
    label: '①门店类型',
    shortLabel: '门店类型',
    options: [
      { value: 'A.纯医美', score: 0, note: '纯医美机构，与生美/双美业务协同弱' },
      { value: 'B.双美偏注射', score: 5, note: '有双美属性，但以注射为主，生美项目承载能力有限' },
      { value: 'C.皮肤科双美', score: 20, note: '含皮肤科/双美项目，纳新合作承接能力最佳' },
      { value: 'D.纯生美', score: 20, note: '纯生美门店，纳新需求强、决策链短' },
    ],
  },
  {
    key: 'trafficPrice',
    label: '②引流价格',
    shortLabel: '引流价格',
    options: [
      { value: 'A.30元内', score: 5, note: '引流价过低，产品项目匹配弱' },
      { value: 'B.30-99元内', score: 10, note: '引流价偏低，仅具备基础拓客能力' },
      { value: 'C.100-200元内', score: 20, note: '引流价适中，具备一定客单与升单空间' },
      { value: 'D.200-500元内', score: 20, note: '引流价较高，客群消费力较好' },
    ],
  },
  {
    key: 'storeArea',
    label: '③门店面积',
    shortLabel: '门店面积',
    options: [
      { value: 'A.100平内', score: 5, note: '小店，产品项目发展空间有限' },
      { value: 'B.100-500平', score: 20, note: '中小型门店，基础承载可满足' },
      { value: 'C.500-1000平', score: 20, note: '中大型门店，项目与体验承载充足' },
      { value: 'D.1000平以上', score: 15, note: '大店，纳新放量与活动承载能力强' },
    ],
  },
  {
    key: 'beauticianCount',
    label: '④美容师人数',
    shortLabel: '美容师人数',
    options: [
      { value: 'A.寡妇店（仅老板1人）', score: 5, note: '无美容师，交付与服务能力最弱' },
      { value: 'B.2-3人', score: 15, note: '人力偏少，同时承接项目数量有限' },
      { value: 'C.4-6人', score: 20, note: '人力充足，可支撑常态化纳新活动' },
      { value: 'D.7人以上', score: 20, note: '团队规模大，纳新与复购承接能力强' },
    ],
  },
  {
    key: 'storeScale',
    label: '⑤门店规模',
    shortLabel: '门店规模',
    options: [
      { value: 'A.单店', score: 10, note: '单店经营，决策链短但放量上限有限' },
      { value: 'B.多店', score: 20, note: '多店经营，具备复制与规模放量潜力' },
      { value: 'C.区域连锁', score: 20, note: '区域连锁，纳新合作价值最高' },
      { value: 'D.品牌连锁（美丽田园、思妍丽类）', score: 0, note: '全国品牌连锁，总部统一采购，门店层合作难切入' },
    ],
  },
];

export interface StoreGradeRuleDef {
  grade: '优秀门店' | '精准门店' | '有效门店' | '暂不匹配';
  minScore: number;
  rangeLabel: string;
  actionAdvice: string;
  description: string;
}

export const STORE_GRADE_RULES: StoreGradeRuleDef[] = [
  {
    grade: '优秀门店',
    minScore: 90,
    rangeLabel: '≥90 分',
    actionAdvice: '优先跟进：城市会邀约及到店演示',
    description: '五维度均强，最短路径转化',
  },
  {
    grade: '精准门店',
    minScore: 80,
    rangeLabel: '80-89 分',
    actionAdvice: '重点跟进：城市会重点邀约',
    description: '结构良好，补齐短板即可成单',
  },
  {
    grade: '有效门店',
    minScore: 70,
    rangeLabel: '70-79 分',
    actionAdvice: '保持跟进：纳入跟进名单持续跟进',
    description: '有基础，需择机切入',
  },
  {
    grade: '暂不匹配',
    minScore: 0,
    rangeLabel: '<70 分',
    actionAdvice: '暂缓跟进：预留彩页及名片信息',
    description: '短板明显或品牌连锁总部管控',
  },
];

export const LEAD_SOURCE_OPTIONS = [
  '大众美团',
  '小红书搜索',
  '抖音本地生活',
  '老客转介绍',
  '商圈扫街',
  '行业展会/城市会',
  '其他',
];

export const CONTACT_ROLE_OPTIONS = ['老板/院长', '店长', '科室运营', '咨询/顾问', '采购', '美容师长', '其他'];

export const CITY_MEETING_OPTIONS = ['未邀约', '已邀约', '已报名', '已到场', '暂不参与'];

export const DEAL_STATUS_OPTIONS = ['未成交', '意向跟进中', '已试单', '已成交'];

export const NANCHANG_DISTRICTS = [
  '南昌市东湖区',
  '南昌市西湖区',
  '南昌市青云谱区',
  '南昌市青山湖区',
  '南昌市新建区',
  '南昌市红谷滩区',
  '南昌市南昌县',
  '南昌市进贤县',
  '南昌市安义县',
];

export interface StoreVisitTargetInput {
  clinicName?: string | null;
  cityRegion?: string | null;
  storeType?: string | null;
  trafficPrice?: string | null;
  storeArea?: string | null;
  beauticianCount?: string | null;
  storeScale?: string | null;
}

export interface StoreVisitEvaluation {
  storeTypeScore: number;
  trafficPriceScore: number;
  storeAreaScore: number;
  beauticianScore: number;
  storeScaleScore: number;
  totalScore: number;
  storeGrade: string;
  actionAdvice: string;
  isCompleted: boolean;
  missingFields: string[];
  validationText: string;
}

function lookupDimScore(key: ScoringDimensionDef['key'], rawValue?: string | null): number {
  const val = (rawValue || '').trim();
  if (!val) return 0;
  const dim = STORE_SCORING_DIMENSIONS.find((d) => d.key === key);
  if (!dim) return 0;
  const exact = dim.options.find((o) => o.value === val);
  if (exact) return exact.score;
  // Support matching by prefix letter (e.g. "C." or "C") or label body without prefix
  const letter = val.match(/^([A-D])\b/i)?.[1]?.toUpperCase();
  if (letter) {
    const byLetter = dim.options.find((o) => o.value.startsWith(`${letter}.`));
    if (byLetter) return byLetter.score;
  }
  const byBody = dim.options.find((o) => o.value.replace(/^[A-D]\./, '') === val);
  return byBody ? byBody.score : 0;
}

export function evaluateStoreVisitTarget(input: StoreVisitTargetInput): StoreVisitEvaluation {
  const storeTypeScore = lookupDimScore('storeType', input.storeType);
  const trafficPriceScore = lookupDimScore('trafficPrice', input.trafficPrice);
  const storeAreaScore = lookupDimScore('storeArea', input.storeArea);
  const beauticianScore = lookupDimScore('beauticianCount', input.beauticianCount);
  const storeScaleScore = lookupDimScore('storeScale', input.storeScale);
  const totalScore =
    storeTypeScore + trafficPriceScore + storeAreaScore + beauticianScore + storeScaleScore;

  const requiredChecks: Array<[string, string | null | undefined]> = [
    ['机构名称', input.clinicName],
    ['城市/区域', input.cityRegion],
    ['门店类型', input.storeType],
    ['引流价格', input.trafficPrice],
    ['门店面积', input.storeArea],
    ['美容师人数', input.beauticianCount],
    ['门店规模', input.storeScale],
  ];
  const missingFields = requiredChecks.filter(([, v]) => !(v || '').trim()).map(([label]) => label);
  const isCompleted = missingFields.length === 0;

  const allFiveFilled = [
    input.storeType,
    input.trafficPrice,
    input.storeArea,
    input.beauticianCount,
    input.storeScale,
  ].every((v) => Boolean((v || '').trim()));

  let storeGrade = '';
  let actionAdvice = '';
  if (allFiveFilled) {
    const matched =
      STORE_GRADE_RULES.find((r) => totalScore >= r.minScore) ||
      STORE_GRADE_RULES[STORE_GRADE_RULES.length - 1];
    storeGrade = matched.grade;
    actionAdvice = matched.actionAdvice;
  }

  let validationText = '待填写';
  if (isCompleted) {
    validationText = '✓ 已拜访完成';
  } else if (missingFields.length < requiredChecks.length) {
    validationText = `缺：${missingFields.join('、')}`;
  }

  return {
    storeTypeScore,
    trafficPriceScore,
    storeAreaScore,
    beauticianScore,
    storeScaleScore,
    totalScore,
    storeGrade,
    actionAdvice,
    isCompleted,
    missingFields,
    validationText,
  };
}

export function evaluateRepPerformance(completedCount: number, targetQuota = 100) {
  const safeTarget = Math.max(1, Number(targetQuota) || 100);
  const completionRate = Number((completedCount / safeTarget).toFixed(4));
  const performanceScore = Number(((completedCount / safeTarget) * 20).toFixed(2));
  const pointsPerStore = Number((20 / safeTarget).toFixed(3));
  return {
    targetQuota: safeTarget,
    completedCount,
    completionRate,
    performanceScore,
    formulaNote: `实际 ÷ 目标 × 100% × 20 分（每完成 1 家 = ${pointsPerStore} 分）`,
  };
}

// ============================================================================
// 6. Existing Client Maintenance Engine (老客维护 · 极简健康度与 20 分维护指标)
// ============================================================================

export const EXISTING_VISIT_TYPE_OPTIONS = ['到店回访', '微信/电话跟进', '带教培训', '活动邀约'];

export const REPURCHASE_INTENT_OPTIONS = ['明确补货', '观望跟进', '库存充足暂不补', '存在流失风险'];

export interface ExistingClientHealthInput {
  daysSinceLastOrder: number | null;
  daysSinceLastVisit: number | null;
  latestRepurchaseIntent?: string | null;
}

export interface ExistingClientHealthResult {
  orderScore: number;
  visitScore: number;
  intentScore: number;
  healthScore: number;
  healthGrade: '健康活跃' | '常规维护' | '沉睡预警';
  advice: string;
}

export function evaluateExistingClientHealth(
  input: ExistingClientHealthInput,
): ExistingClientHealthResult {
  const dOrder = input.daysSinceLastOrder;
  let orderScore = 25; // Historical imported existing client without dated order yet
  if (dOrder !== null && Number.isFinite(dOrder)) {
    if (dOrder <= 30) orderScore = 40;
    else if (dOrder <= 90) orderScore = 30;
    else if (dOrder <= 180) orderScore = 18;
    else orderScore = 5;
  }

  const dVisit = input.daysSinceLastVisit;
  let visitScore = 0;
  if (dVisit !== null && Number.isFinite(dVisit)) {
    if (dVisit <= 30) visitScore = 30;
    else if (dVisit <= 60) visitScore = 15;
    else visitScore = 0;
  } else if (dOrder !== null && Number.isFinite(dOrder) && dOrder <= 45) {
    // 近期刚下单但暂未录老客回访，给予 15 分基础维护分（总分 70 归入常规维护，避免新成单客户误报沉睡预警）
    visitScore = 15;
  } else if (dOrder === null) {
    // 无历史订单日期的导入老客，首期默认进入常规维护（60 分），待首次回访更新真实状态
    visitScore = 20;
  }

  const intent = (input.latestRepurchaseIntent || '').trim();
  let intentScore = 15;
  if (intent === '明确补货') intentScore = 30;
  else if (intent === '库存充足暂不补') intentScore = 22;
  else if (intent === '观望跟进') intentScore = 20;
  else if (intent === '存在流失风险') intentScore = 5;

  const healthScore = Math.max(0, Math.min(100, orderScore + visitScore + intentScore));
  const isDormant = (dOrder !== null && dOrder > 180) || healthScore < 60 || intent === '存在流失风险';

  let healthGrade: ExistingClientHealthResult['healthGrade'] = '常规维护';
  let advice = '保持月度常态化回访与动销跟进';
  if (isDormant) {
    healthGrade = '沉睡预警';
    advice = dOrder !== null && dOrder > 180
      ? '超 180 天未复购，建议 7 天内安排到店回访防流失'
      : '维护频次偏低或存在流失风险，建议尽快跟进客情';
  } else if (healthScore >= 80) {
    healthGrade = '健康活跃';
    advice = intent === '明确补货' ? '补货意向明确，可直接跟进开具供货单' : '合作状态稳定，持续做好带教与新品推荐';
  }

  return { orderScore, visitScore, intentScore, healthScore, healthGrade, advice };
}

export function evaluateExistingMaintenancePerf(visitedClientsCount: number, totalClientsCount: number) {
  const safeTotal = Math.max(0, Number(totalClientsCount) || 0);
  const safeVisited = Math.max(0, Number(visitedClientsCount) || 0);
  const coverageRate = safeTotal > 0 ? Number(Math.min(1, safeVisited / safeTotal).toFixed(4)) : 0;
  const maintenanceScore = Number((coverageRate * 20).toFixed(2));
  return {
    totalClientsCount: safeTotal,
    visitedClientsCount: safeVisited,
    coverageRate,
    maintenanceScore,
    formulaNote: '本月已回访老客数 ÷ 负责老客总数 × 20 分',
  };
}
