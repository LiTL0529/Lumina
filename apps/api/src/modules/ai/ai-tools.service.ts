import { Injectable } from '@nestjs/common';
import { ClinicBindStatus } from '@lumina/shared-types';
import { PrismaService } from '../../common/prisma.module';
import { AuthUser } from '../../common/auth.decorators';
import { CrmService } from '../crm/crm.module';
import { ClinicService } from '../clinic/clinic.module';
import { TraceService } from '../trace/trace.module';
import { buildSop, SopTopic } from './ai-sop';

export interface AiScope {
  global: boolean;
  orgId: string | null;
  orgName: string;
  label: string;
  isSalesRep: boolean;
  repName: string;
}

export interface DataCard {
  type: 'table' | 'metrics';
  title: string;
  columns?: string[];
  rows?: Array<Array<string | number>>;
  items?: Array<{ label: string; value: string | number; tone?: 'danger' | 'warn' | 'ok' | 'default' }>;
}

export interface AiAction {
  label: string;
  route: string;
  query?: Record<string, string>;
}

export interface ToolOutcome {
  result: unknown;
  card?: DataCard;
  actions?: AiAction[];
}

export const TOOL_LABELS: Record<string, string> = {
  get_pending_work_summary: '正在汇总待处理事项…',
  trace_code_timeline: '正在查询防伪码全链路记录…',
  query_stock_balances: '正在查询实时库存…',
  query_sales_orders: '正在查询销售订单…',
  query_compliance_alerts: '正在查询合规与窜货预警…',
  query_clinic_protection: '正在查询机构保护期状态…',
  query_crm_visit_stats: '正在统计客户拜访数据…',
  get_business_rules_and_sop: '正在读取实时规则与操作流程…',
};

export const TOOL_SHORT: Record<string, string> = {
  get_pending_work_summary: '待办汇总',
  trace_code_timeline: '防伪码链路',
  query_stock_balances: '实时库存',
  query_sales_orders: '销售订单',
  query_compliance_alerts: '合规预警',
  query_clinic_protection: '机构保护期',
  query_crm_visit_stats: '拜访统计',
  get_business_rules_and_sop: '规则与流程',
};

export const ALLOWED_ROUTES = new Set([
  '/',
  '/trace',
  '/sales',
  '/purchase',
  '/inventory',
  '/channels',
  '/crm',
  '/reports',
  '/settings',
  '/audit-logs',
]);

export const AI_TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'get_pending_work_summary',
      description: '汇总当前权限范围内需要人工跟进的事项：待扫码出库订单、红线待特批订单、未结案合规预警、30 天内临期（保护期到期或无复购解绑）的机构。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trace_code_timeline',
      description: '按防伪码 / 箱码查询完整流向：商品、批次、当前状态、归属代理商、终端机构、验真次数与每一个流转环节，同时返回该码相关的预警。',
      parameters: {
        type: 'object',
        properties: { codeToken: { type: 'string', description: '16 位防伪码或箱码，可带空格' } },
        required: ['codeToken'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_stock_balances',
      description: '查询仓库实时库存，可按商品名称 / 货号关键字过滤，或只看低于预警线的库存。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '商品名称或货号关键字' },
          lowStockOnly: { type: 'boolean', description: '只返回低于预警线的库存' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_sales_orders',
      description: '查询销售出库订单与拿货金额。groupByDealer=true 时按代理商（买方 / 卖方组织）汇总拿货金额并排名。日期为 YYYY-MM-DD（北京时间）。',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['PENDING_APPROVAL', 'PENDING_OUTBOUND', 'PARTIAL_OUTBOUND', 'COMPLETED', 'CANCELLED'],
          },
          scene: { type: 'string', enum: ['HQ_TO_DEALER', 'DEALER_TO_CLINIC'] },
          buyerKeyword: { type: 'string', description: '买方代理商或终端机构名称关键字' },
          dateFrom: { type: 'string' },
          dateTo: { type: 'string' },
          groupByDealer: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_compliance_alerts',
      description: '查询跨区窜货、破价、高频验真、对账差异等合规预警。',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['OPEN', 'INVESTIGATING', 'RESOLVED', 'UNRESOLVED'] },
          alertType: {
            type: 'string',
            enum: ['CROSS_REGION', 'UNAUTHORIZED_SCAN', 'HIGH_FREQ_VERIFY', 'PRICE_BELOW_REDLINE', 'RETAIL_PRICE_REPORT', 'RECONCILIATION_VARIANCE'],
          },
          severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_clinic_protection',
      description: '查询终端机构的保护期 / 绑定 / 公海状态与剩余天数，可筛选即将到期的机构。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '机构名称 / 城市关键字' },
          bindStatus: { type: 'string', enum: ['PUBLIC_POOL', 'PROTECTED_90D', 'BOUND_ACTIVE'] },
          expiringWithinDays: { type: 'number', description: '只返回 N 天内到期（保护期到期或无复购解绑）的机构' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_crm_visit_stats',
      description: '统计月度新客拜访：业务员完成家数、目标家数、20 分制业绩得分排名、门店评级分布、跟进与成交。planMonth 为 YYYY-MM，默认当月。',
      parameters: {
        type: 'object',
        properties: {
          planMonth: { type: 'string' },
          salesRepName: { type: 'string' },
          storeGrade: { type: 'string', enum: ['优秀门店', '精准门店', '有效门店', '暂不匹配'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_business_rules_and_sop',
      description: '读取系统实时规则阈值（供货红线、零售红线、保护期、解绑天数、高频验真阈值）与标准操作流程（特批、入库、出库、退货、验真、返点）。',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', enum: ['ALL', 'REDLINE', 'PROTECTION', 'INBOUND', 'OUTBOUND', 'VERIFY', 'REBATE'] },
        },
      },
    },
  },
];

const ORDER_STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  PENDING_APPROVAL: '红线待特批',
  PENDING_OUTBOUND: '待扫码出库',
  PARTIAL_OUTBOUND: '部分出库',
  COMPLETED: '已出库',
  CANCELLED: '已撤销',
};
const CODE_STATUS_LABEL: Record<string, string> = {
  GENERATED: '已赋码',
  IN_HQ_STOCK: '总仓在库',
  IN_TRANSIT_TO_DEALER: '发往代理商在途',
  IN_DEALER_STOCK: '代理商在库',
  SOLD_TO_CLINIC: '已出库至机构',
  CONSUMED: '已验真核销',
  UNPACKED: '已拆箱',
  VOIDED: '已作废',
};
const EVENT_LABEL: Record<string, string> = {
  BATCH_GENERATED: '出厂赋码',
  CARTON_BOUND: '箱盒关联',
  HQ_INBOUND: '总仓扫码入库',
  HQ_OUTBOUND: '出库绑定代理商',
  DEALER_INBOUND: '代理商收货入库',
  DEALER_OUTBOUND: '出库至终端机构',
  CARTON_UNPACKED: '拆箱',
  RETURN_TO_DEALER: '退回代理商',
  RETURN_TO_HQ: '退回总仓',
  CONSUMER_VERIFIED: '顾客扫码验真',
  VOIDED: '作废',
};
const ALERT_TYPE_LABEL: Record<string, string> = {
  CROSS_REGION: '跨区窜货',
  UNAUTHORIZED_SCAN: '非授权扫码',
  HIGH_FREQ_VERIFY: '高频验真',
  PRICE_BELOW_REDLINE: '低于供货红线',
  RETAIL_PRICE_REPORT: '零售破价举报',
  RECONCILIATION_VARIANCE: '账实差异',
};
const BIND_LABEL: Record<string, string> = {
  PUBLIC_POOL: '公海',
  PROTECTED_90D: '保护期中',
  BOUND_ACTIVE: '已绑定',
};

function fmtDate(d?: Date | string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }).slice(0, 16);
}

function beijingMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
  return parts.slice(0, 7);
}

function money(n: number) {
  return `¥${Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

@Injectable()
export class AiToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
    private readonly clinics: ClinicService,
    private readonly trace: TraceService,
  ) {}

  /** Strict multi-tenant scope: only HQ may drill down; everyone else is locked to their own org. */
  async resolveScope(user: AuthUser, requestedScopeOrgId?: string): Promise<AiScope> {
    const repName = (user.realName || '').replace(/（.*?）|\(.*?\)/g, '').trim();
    if (user.orgType === 'HQ') {
      const id = (requestedScopeOrgId || '').trim();
      if (id) {
        const org = await this.prisma.organization.findUnique({ where: { id }, select: { id: true, name: true, type: true } });
        if (org && org.type === 'DEALER') {
          return { global: false, orgId: org.id, orgName: org.name, label: `${org.name}（总部下钻视角）`, isSalesRep: false, repName };
        }
      }
      return { global: true, orgId: null, orgName: user.orgName, label: '品牌总部全局视角', isSalesRep: false, repName };
    }
    return {
      global: false,
      orgId: user.orgId,
      orgName: user.orgName,
      label: user.roleCode === 'SALES_REP' ? `${user.orgName} · 外勤 ${repName}` : user.orgName,
      isSalesRep: user.roleCode === 'SALES_REP',
      repName,
    };
  }

  private effectiveUser(user: AuthUser, scope: AiScope): AuthUser {
    if (scope.global) return user;
    return { ...user, orgId: scope.orgId as string, orgType: 'DEALER', orgName: scope.orgName };
  }

  private async rules() {
    const r = await this.prisma.systemRuleConfig.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
    return {
      minSupplyFold: Number((Number(r.defaultMinSupplyRatio) * 10).toFixed(2)),
      minRetailFold: Number((Number(r.defaultMinRetailRatio) * 10).toFixed(2)),
      protectDays: r.clinicProtectDays,
      unbindDays: r.clinicUnbindDays,
      unbindWarnDays: r.unbindWarnDaysBefore,
      highFreqVerifyThreshold: r.highFreqVerifyThreshold,
      allowSpecialPriceApprove: r.allowSpecialPriceApprove,
    };
  }

  async execute(name: string, args: any, user: AuthUser, scope: AiScope): Promise<ToolOutcome> {
    const a = args && typeof args === 'object' ? args : {};
    switch (name) {
      case 'get_pending_work_summary':
        return this.pendingSummary(user, scope);
      case 'trace_code_timeline':
        return this.traceTimeline(String(a.codeToken || ''), scope);
      case 'query_stock_balances':
        return this.stockBalances(a, scope);
      case 'query_sales_orders':
        return this.salesOrders(a, scope);
      case 'query_compliance_alerts':
        return this.alerts(a, scope);
      case 'query_clinic_protection':
        return this.clinicProtection(a, user, scope);
      case 'query_crm_visit_stats':
        return this.crmStats(a, user, scope);
      case 'get_business_rules_and_sop':
        return this.rulesAndSop(a);
      default:
        return { result: { error: `未知工具 ${name}` } };
    }
  }

  // ---------------------------------------------------------------------------
  private orderScopeWhere(scope: AiScope): any {
    if (scope.global) return {};
    if (scope.isSalesRep) return { sellerOrgId: scope.orgId, orderScene: 'DEALER_TO_CLINIC' };
    return { OR: [{ sellerOrgId: scope.orgId }, { buyerOrgId: scope.orgId }] };
  }

  private async pendingSummary(user: AuthUser, scope: AiScope): Promise<ToolOutcome> {
    const orderScope: any = scope.global
      ? {}
      : scope.isSalesRep
        ? { sellerOrgId: scope.orgId, orderScene: 'DEALER_TO_CLINIC' }
        : { sellerOrgId: scope.orgId };
    const alertScope: any = scope.global ? {} : { orgId: scope.orgId };

    const [pendingOrders, approvalOrders, alerts, clinicList] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where: { ...orderScope, status: { in: ['PENDING_OUTBOUND', 'PARTIAL_OUTBOUND'] } },
        include: { buyerOrg: { select: { name: true } }, clinic: { select: { name: true } }, items: { select: { qty: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.salesOrder.findMany({
        where: { ...orderScope, status: 'PENDING_APPROVAL' },
        include: { buyerOrg: { select: { name: true } }, clinic: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.antiFleeingAlert.findMany({
        where: { ...alertScope, status: { in: ['OPEN', 'INVESTIGATING'] } },
        include: { org: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.clinics.listClinics(this.effectiveUser(user, scope)),
    ]);

    const expiring = (clinicList as any[])
      .filter((c: any) => (scope.global || c.ownerOrgId === scope.orgId) && c.bindStatus !== ClinicBindStatus.PUBLIC_POOL)
      .map((c: any) => ({
        name: c.name,
        owner: c.ownerOrg?.name || '总部直营',
        status: BIND_LABEL[c.bindStatus] || c.bindStatus,
        daysLeft: c.protectDaysLeft ?? c.unbindDaysLeft,
        kind: c.protectDaysLeft !== null ? '保护期到期' : '无复购解绑',
      }))
      .filter((c: any) => c.daysLeft !== null && c.daysLeft <= 30)
      .sort((x: any, y: any) => x.daysLeft - y.daysLeft);

    const sev = (s: string) => alerts.filter((x) => x.severity === s).length;
    const result = {
      scope: scope.label,
      pendingOutbound: {
        count: pendingOrders.length,
        orders: pendingOrders.slice(0, 8).map((o) => ({
          docNo: o.docNo,
          buyer: o.buyerOrg?.name || o.clinic?.name || '—',
          qty: o.items.reduce((s, i) => s + i.qty, 0),
          amount: Number(o.totalAmount),
          status: ORDER_STATUS_LABEL[o.status],
        })),
      },
      pendingApproval: {
        count: approvalOrders.length,
        orders: approvalOrders.slice(0, 8).map((o) => ({ docNo: o.docNo, buyer: o.buyerOrg?.name || o.clinic?.name || '—', amount: Number(o.totalAmount) })),
      },
      openAlerts: {
        count: alerts.length,
        bySeverity: { CRITICAL: sev('CRITICAL'), HIGH: sev('HIGH'), MEDIUM: sev('MEDIUM'), LOW: sev('LOW') },
        items: alerts.slice(0, 8).map((x) => ({
          title: x.title,
          type: ALERT_TYPE_LABEL[x.alertType] || x.alertType,
          severity: x.severity,
          org: x.org?.name || '—',
          code: x.traceCodeToken,
          createdAt: fmtDate(x.createdAt),
        })),
      },
      expiringClinics: { count: expiring.length, items: expiring.slice(0, 8) },
    };

    return {
      result,
      card: {
        type: 'metrics',
        title: `待处理事项 · ${scope.label}`,
        items: [
          { label: '待扫码出库', value: `${pendingOrders.length} 单`, tone: pendingOrders.length ? 'warn' : 'default' },
          { label: '红线待特批', value: `${approvalOrders.length} 单`, tone: approvalOrders.length ? 'warn' : 'default' },
          { label: '未结案预警', value: `${alerts.length} 条`, tone: alerts.length ? 'danger' : 'default' },
          { label: '30 天内临期机构', value: `${expiring.length} 家`, tone: expiring.length ? 'warn' : 'default' },
        ],
      },
      actions: [
        ...(pendingOrders.length || approvalOrders.length ? [{ label: '前往出库与打单', route: '/sales' }] : []),
        ...(alerts.length ? [{ label: '前往预警处置', route: '/trace', query: { tab: 'alerts' } }] : []),
        ...(expiring.length ? [{ label: '查看临期机构', route: '/channels' }] : []),
      ],
    };
  }

  private async traceTimeline(raw: string, scope: AiScope): Promise<ToolOutcome> {
    if (!raw.trim()) return { result: { found: false, message: '未提供防伪码' } };
    let data: any;
    try {
      data = await this.trace.getCodeTimeline(raw);
    } catch (err: any) {
      return { result: { found: false, message: err?.message || '系统中未查询到该产品码记录' } };
    }
    const code = data.code;
    if (!scope.global && code.assignedDealerId !== scope.orgId && code.currentOrgId !== scope.orgId) {
      return { result: { found: false, message: '当前权限范围内暂无匹配记录（该码不属于本服务商）' } };
    }
    const orgIds = new Set<string>();
    const clinicIds = new Set<string>();
    for (const e of code.events) {
      if (e.fromOrgId) orgIds.add(e.fromOrgId);
      if (e.toOrgId) orgIds.add(e.toOrgId);
      if (e.clinicId) clinicIds.add(e.clinicId);
    }
    const [orgs, clinicRows, relatedAlerts] = await Promise.all([
      this.prisma.organization.findMany({ where: { id: { in: [...orgIds] } }, select: { id: true, name: true } }),
      this.prisma.clinic.findMany({ where: { id: { in: [...clinicIds] } }, select: { id: true, name: true } }),
      this.prisma.antiFleeingAlert.findMany({
        where: { traceCodeToken: code.codeToken },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);
    const orgMap = new Map(orgs.map((o) => [o.id, o.name]));
    const clinicMap = new Map(clinicRows.map((c) => [c.id, c.name]));
    const hasCross = relatedAlerts.some((x) => x.alertType === 'CROSS_REGION');

    const result = {
      found: true,
      codeToken: code.codeToken,
      codeLevel: code.codeLevel === 'CARTON' ? '外箱码' : '单品盒码',
      signatureValid: data.signatureValid,
      status: CODE_STATUS_LABEL[code.status] || code.status,
      product: `${code.product?.name || '—'}（${code.product?.skuCode || ''}）`,
      batchNo: code.batch?.batchNo,
      assignedDealer: data.assignedDealer?.name || '总部在库',
      targetClinic: data.targetClinic?.name || null,
      verifyCount: code.verifyCount,
      firstVerifyAt: fmtDate(code.firstVerifyAt),
      firstVerifyCity: code.firstVerifyCity,
      parentCarton: code.parent?.codeToken || null,
      childUnits: code.children?.length || 0,
      timeline: code.events.map((e: any) => ({
        time: fmtDate(e.occurredAt),
        step: EVENT_LABEL[e.eventType] || e.eventType,
        from: e.fromOrgId ? orgMap.get(e.fromOrgId) : undefined,
        to: e.toOrgId ? orgMap.get(e.toOrgId) : undefined,
        clinic: e.clinicId ? clinicMap.get(e.clinicId) : undefined,
        docNo: e.docNo || undefined,
        remark: e.remark || undefined,
      })),
      relatedAlerts: relatedAlerts.map((x) => ({
        type: ALERT_TYPE_LABEL[x.alertType] || x.alertType,
        severity: x.severity,
        status: x.status,
        title: x.title,
        createdAt: fmtDate(x.createdAt),
      })),
      crossRegionDetected: hasCross,
    };
    return {
      result,
      card: {
        type: 'metrics',
        title: `防伪码 ${code.codeToken.replace(/(.{4})(?=.)/g, '$1 ')}`,
        items: [
          { label: '当前状态', value: result.status, tone: 'ok' },
          { label: '批次', value: result.batchNo || '—' },
          { label: '归属代理商', value: result.assignedDealer },
          { label: '终端机构', value: result.targetClinic || '—' },
          { label: '验真次数', value: `${result.verifyCount} 次`, tone: result.verifyCount > 5 ? 'warn' : 'default' },
          { label: '跨区窜货', value: hasCross ? '已触发预警' : '未发现', tone: hasCross ? 'danger' : 'ok' },
        ],
      },
      actions: [{ label: '打开单码护照', route: '/trace', query: { code: code.codeToken } }],
    };
  }

  private async stockBalances(a: any, scope: AiScope): Promise<ToolOutcome> {
    const where: any = { qty: { gt: 0 } };
    if (!scope.global) where.warehouse = { orgId: scope.orgId };
    if (a.keyword) {
      where.product = {
        OR: [
          { name: { contains: String(a.keyword), mode: 'insensitive' } },
          { skuCode: { contains: String(a.keyword), mode: 'insensitive' } },
        ],
      };
    }
    const rows = await this.prisma.stockBalance.findMany({
      where,
      include: {
        product: { select: { name: true, skuCode: true, unitName: true } },
        warehouse: { select: { name: true, org: { select: { name: true } } } },
      },
      orderBy: { qty: 'desc' },
      take: 200,
    });
    const filtered = a.lowStockOnly ? rows.filter((r) => r.qty <= r.warnMinQty) : rows;
    const totalQty = filtered.reduce((s, r) => s + r.qty, 0);
    const list = filtered.slice(0, 30).map((r) => ({
      product: r.product.name,
      sku: r.product.skuCode,
      warehouse: r.warehouse.name,
      org: r.warehouse.org?.name,
      qty: r.qty,
      unit: r.product.unitName,
      warnMinQty: r.warnMinQty,
      low: r.qty <= r.warnMinQty,
    }));
    return {
      result: { scope: scope.label, rowCount: filtered.length, totalQty, warehouses: new Set(filtered.map((r) => r.warehouseId)).size, rows: list },
      card: {
        type: 'table',
        title: `${a.lowStockOnly ? '低库存' : '实时库存'} · 合计 ${totalQty} 件`,
        columns: ['商品', '仓库', '在库', '预警线'],
        rows: list.slice(0, 12).map((r) => [r.product, r.warehouse, `${r.qty} ${r.unit}`, r.warnMinQty]),
      },
      actions: [{ label: '前往库存与核验', route: '/inventory' }],
    };
  }

  private async salesOrders(a: any, scope: AiScope): Promise<ToolOutcome> {
    const where: any = { ...this.orderScopeWhere(scope) };
    if (a.status) where.status = a.status;
    else where.status = { not: 'CANCELLED' };
    if (a.scene) {
      if (scope.isSalesRep && a.scene !== 'DEALER_TO_CLINIC') return { result: { rowCount: 0, message: '当前权限范围内暂无匹配记录' } };
      where.orderScene = a.scene;
    }
    if (a.dateFrom || a.dateTo) {
      where.bizDate = {};
      if (a.dateFrom) where.bizDate.gte = new Date(`${String(a.dateFrom).slice(0, 10)}T00:00:00+08:00`);
      if (a.dateTo) where.bizDate.lte = new Date(`${String(a.dateTo).slice(0, 10)}T23:59:59.999+08:00`);
    }
    if (a.buyerKeyword) {
      const kw = String(a.buyerKeyword);
      const buyerOr = [
        { buyerOrg: { name: { contains: kw, mode: 'insensitive' } } },
        { clinic: { name: { contains: kw, mode: 'insensitive' } } },
      ];
      where.AND = [...(where.AND || []), { OR: buyerOr }];
    }
    const orders = await this.prisma.salesOrder.findMany({
      where,
      include: {
        sellerOrg: { select: { id: true, name: true } },
        buyerOrg: { select: { id: true, name: true } },
        clinic: { select: { name: true } },
        items: { select: { qty: true } },
      },
      orderBy: { bizDate: 'desc' },
      take: 500,
    });
    const totalAmount = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
    const totalQty = orders.reduce((s, o) => s + o.items.reduce((x, i) => x + i.qty, 0), 0);

    let groups: Array<{ dealer: string; orders: number; qty: number; amount: number }> = [];
    if (a.groupByDealer) {
      const map = new Map<string, { dealer: string; orders: number; qty: number; amount: number }>();
      for (const o of orders) {
        const dealer = o.orderScene === 'HQ_TO_DEALER' ? o.buyerOrg?.name || '—' : o.sellerOrg?.name || '—';
        const g = map.get(dealer) || { dealer, orders: 0, qty: 0, amount: 0 };
        g.orders += 1;
        g.qty += o.items.reduce((x, i) => x + i.qty, 0);
        g.amount += Number(o.totalAmount);
        map.set(dealer, g);
      }
      groups = [...map.values()].sort((x, y) => y.amount - x.amount).map((g) => ({ ...g, amount: Number(g.amount.toFixed(2)) }));
    }

    const list = orders.slice(0, 20).map((o) => ({
      docNo: o.docNo,
      date: fmtDate(o.bizDate).slice(0, 10),
      scene: o.orderScene === 'HQ_TO_DEALER' ? '总仓→代理商' : '代理商→机构',
      seller: o.sellerOrg?.name,
      buyer: o.buyerOrg?.name || o.clinic?.name || '—',
      qty: o.items.reduce((x, i) => x + i.qty, 0),
      amount: Number(o.totalAmount),
      status: ORDER_STATUS_LABEL[o.status] || o.status,
      redline: o.redlineStatus,
    }));

    const card: DataCard = groups.length
      ? {
          type: 'table',
          title: `代理商拿货金额排名 · 共 ${money(totalAmount)}`,
          columns: ['排名', '代理商', '单数', '盒数', '金额'],
          rows: groups.slice(0, 10).map((g, i) => [i + 1, g.dealer, g.orders, g.qty, money(g.amount)]),
        }
      : {
          type: 'table',
          title: `销售订单 · ${orders.length} 单 · ${money(totalAmount)}`,
          columns: ['单号', '买方', '数量', '金额', '状态'],
          rows: list.slice(0, 10).map((o) => [o.docNo, o.buyer, `${o.qty} 盒`, money(o.amount), o.status]),
        };

    return {
      result: { scope: scope.label, orderCount: orders.length, totalAmount: Number(totalAmount.toFixed(2)), totalQty, dealerRanking: groups, orders: list },
      card,
      actions: [{ label: '前往出库与打单', route: '/sales' }],
    };
  }

  private async alerts(a: any, scope: AiScope): Promise<ToolOutcome> {
    const where: any = {};
    if (!scope.global) where.orgId = scope.orgId;
    if (a.status === 'UNRESOLVED') where.status = { in: ['OPEN', 'INVESTIGATING'] };
    else if (a.status) where.status = a.status;
    if (a.alertType) where.alertType = a.alertType;
    if (a.severity) where.severity = a.severity;
    const [rows, total] = await Promise.all([
      this.prisma.antiFleeingAlert.findMany({
        where,
        include: { org: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.antiFleeingAlert.count({ where }),
    ]);
    const sevRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const list = rows
      .map((x) => ({
        title: x.title,
        type: ALERT_TYPE_LABEL[x.alertType] || x.alertType,
        severity: x.severity,
        org: x.org?.name || (scope.isSalesRep ? scope.orgName : '总部/未知'),
        code: x.traceCodeToken,
        docNo: x.docNo,
        status: x.status === 'RESOLVED' ? '已结案' : x.status === 'INVESTIGATING' ? '调查中' : '待处置',
        detail: scope.isSalesRep ? undefined : x.detail?.slice(0, 160),
        createdAt: fmtDate(x.createdAt),
      }))
      .sort((p, q) => (sevRank[p.severity] ?? 9) - (sevRank[q.severity] ?? 9));
    return {
      result: { scope: scope.label, total, alerts: list },
      card: {
        type: 'table',
        title: `合规预警 · ${total} 条`,
        columns: ['级别', '类型', '标题', '组织', '状态'],
        rows: list.slice(0, 10).map((x) => [x.severity, x.type, x.title, x.org, x.status]),
      },
      actions: [{ label: '前往预警处置', route: '/trace', query: { tab: 'alerts' } }],
    };
  }

  private async clinicProtection(a: any, user: AuthUser, scope: AiScope): Promise<ToolOutcome> {
    const list = (await this.clinics.listClinics(this.effectiveUser(user, scope), {
      status: a.bindStatus || undefined,
      keyword: a.keyword || undefined,
    })) as any[];
    let rows = list.map((c: any) => ({
      name: c.name,
      city: c.city,
      owner: c.ownerOrg?.name || (c.bindStatus === 'PUBLIC_POOL' ? '公海可报备' : '总部直营'),
      status: BIND_LABEL[c.bindStatus] || c.bindStatus,
      daysLeft: c.protectDaysLeft ?? c.unbindDaysLeft,
      kind: c.protectDaysLeft !== null ? '保护期到期' : c.unbindDaysLeft !== null ? '无复购解绑' : '—',
    }));
    const within = Number(a.expiringWithinDays);
    if (Number.isFinite(within) && within > 0) {
      rows = rows.filter((r) => r.daysLeft !== null && r.daysLeft <= within).sort((x, y) => (x.daysLeft as number) - (y.daysLeft as number));
    }
    return {
      result: { scope: scope.label, total: rows.length, clinics: rows.slice(0, 30) },
      card: {
        type: 'table',
        title: Number.isFinite(within) && within > 0 ? `${within} 天内临期机构 · ${rows.length} 家` : `机构保护状态 · ${rows.length} 家`,
        columns: ['机构', '归属', '状态', '剩余天数'],
        rows: rows.slice(0, 10).map((r) => [r.name, r.owner, r.status, r.daysLeft === null ? '—' : `${r.daysLeft} 天（${r.kind}）`]),
      },
      actions: [{ label: '前往代理商与机构', route: '/channels' }],
    };
  }

  private async crmStats(a: any, user: AuthUser, scope: AiScope): Promise<ToolOutcome> {
    const planMonth = /^\d{4}-\d{2}$/.test(String(a.planMonth || '')) ? String(a.planMonth) : beijingMonth();
    const salesRepName = scope.isSalesRep ? scope.repName : a.salesRepName ? String(a.salesRepName) : undefined;
    const dash: any = await this.crm.getDashboard(this.effectiveUser(user, scope), { planMonth, salesRepName });
    const board = (dash.repLeaderboard || []).map((r: any, i: number) => ({
      rank: i + 1,
      salesRep: r.salesRepName,
      dealer: r.orgName,
      planned: r.planned,
      completed: r.completed,
      targetQuota: r.targetQuota,
      completionRate: `${(Number(r.completionRate || 0) * 100).toFixed(1)}%`,
      excellent: r.excellent,
      deals: r.deals,
      score: Number(Number(r.performanceScore || 0).toFixed(2)),
    }));
    const gradeStats = (dash.gradeStats || []).map((g: any) => ({ grade: g.grade, count: g.count }));
    let gradeFocus: any;
    if (a.storeGrade) {
      const where: any = { planMonth, storeGrade: String(a.storeGrade), isCompleted: true };
      if (!scope.global) where.orgId = scope.orgId;
      if (salesRepName) where.salesRepName = salesRepName;
      const stores = await this.prisma.visitPlanTarget.findMany({ where, take: 20, orderBy: { totalScore: 'desc' } });
      gradeFocus = stores.map((s) => ({ clinic: s.clinicName, region: s.cityRegion, salesRep: s.salesRepName, score: s.totalScore }));
    }
    return {
      result: { scope: scope.label, planMonth, kpis: dash.kpis, leaderboard: board, gradeStats, gradeFocus },
      card: {
        type: 'table',
        title: `${planMonth} 新客拜访得分排名`,
        columns: ['业务员', '服务商', '已完成 / 目标', '优秀门店', '得分'],
        rows: board.slice(0, 10).map((r: any) => [r.salesRep, r.dealer, `${r.completed}/${r.targetQuota}`, r.excellent, `${r.score.toFixed(2)} 分`]),
      },
      actions: [{ label: '前往客户拜访', route: '/crm' }],
    };
  }

  private async rulesAndSop(a: any): Promise<ToolOutcome> {
    const r = await this.rules();
    const topic = (['ALL', 'REDLINE', 'PROTECTION', 'INBOUND', 'OUTBOUND', 'VERIFY', 'REBATE'].includes(a.topic) ? a.topic : 'ALL') as SopTopic;
    return {
      result: {
        rules: {
          supplyRedline: `${r.minSupplyFold} 折`,
          retailRedline: `${r.minRetailFold} 折`,
          clinicProtectDays: r.protectDays,
          clinicUnbindDays: r.unbindDays,
          unbindWarnDaysBefore: r.unbindWarnDays,
          highFreqVerifyThreshold: r.highFreqVerifyThreshold,
          allowSpecialPriceApprove: r.allowSpecialPriceApprove,
        },
        sop: buildSop(topic, r),
      },
      card: {
        type: 'metrics',
        title: '当前生效的渠道规则',
        items: [
          { label: '供货红线', value: `${r.minSupplyFold} 折` },
          { label: '零售红线', value: `${r.minRetailFold} 折` },
          { label: '报备保护期', value: `${r.protectDays} 天` },
          { label: '无复购解绑', value: `${r.unbindDays} 天` },
        ],
      },
      actions: topic === 'REDLINE' || topic === 'OUTBOUND' ? [{ label: '前往出库与打单', route: '/sales' }] : [{ label: '查看商品与规则', route: '/settings' }],
    };
  }
}
