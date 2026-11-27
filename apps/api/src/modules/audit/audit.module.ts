import {
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  Global,
  Injectable,
  Logger,
  Module,
  NestInterceptor,
  OnModuleInit,
  Query,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../common/prisma.module';
import { AuthUser, CurrentUser } from '../../common/auth.decorators';
import { ScopeInterceptor } from '../../common/scope.interceptor';

export interface AuditEntry {
  orgId?: string | null;
  operatorId?: string | null;
  operatorName: string;
  roleCode?: string | null;
  module: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  summary: string;
  diffSnapshot?: Record<string, unknown>;
}

interface AuditRule {
  method: string;
  path: string;
  module: string;
  action: string;
  label: string;
  targetType?: string;
}

/** Route → business semantic mapping for automatic mutation auditing. */
const AUDIT_RULES: AuditRule[] = [
  { method: 'POST', path: 'stock/inbound', module: 'STOCK', action: 'INBOUND', label: '扫码入库', targetType: 'StockDoc' },
  { method: 'POST', path: 'stock/inbound-register', module: 'STOCK', action: 'INBOUND', label: '扫码建档入库', targetType: 'StockDoc' },
  { method: 'POST', path: 'stock/outbound', module: 'STOCK', action: 'OUTBOUND', label: '按单扫码出库', targetType: 'SalesOrder' },
  { method: 'POST', path: 'stock/quick-outbound', module: 'STOCK', action: 'OUTBOUND', label: '快捷出库绑定代理商', targetType: 'SalesOrder' },
  { method: 'POST', path: 'reconciliations/generate', module: 'STOCK', action: 'RECONCILE_GENERATE', label: '生成月度对账' },
  { method: 'POST', path: 'reconciliations/:id/submit', module: 'STOCK', action: 'RECONCILE_SUBMIT', label: '提交月度盘点', targetType: 'MonthlyReconciliation' },
  { method: 'POST', path: 'reconciliations/:id/audit', module: 'STOCK', action: 'RECONCILE_AUDIT', label: '总部审核对账', targetType: 'MonthlyReconciliation' },
  { method: 'POST', path: 'purchase-orders', module: 'ORDER', action: 'PURCHASE_CREATE', label: '新建采购入库单', targetType: 'PurchaseOrder' },
  { method: 'POST', path: 'sales-orders', module: 'ORDER', action: 'SALES_CREATE', label: '新建销售出库单', targetType: 'SalesOrder' },
  { method: 'POST', path: 'sales-orders/:id/special-approve', module: 'ORDER', action: 'SPECIAL_APPROVE', label: '红线特批', targetType: 'SalesOrder' },
  { method: 'POST', path: 'sales-orders/:id/print-log', module: 'ORDER', action: 'PRINT', label: '打印出库联单', targetType: 'SalesOrder' },
  { method: 'POST', path: 'return-orders', module: 'ORDER', action: 'RETURN', label: '退货回仓', targetType: 'ReturnOrder' },
  { method: 'POST', path: 'trace/batches', module: 'TRACE', action: 'BATCH_CREATE', label: '生成防伪码批次', targetType: 'CodeBatch' },
  { method: 'POST', path: 'trace/carton/bind', module: 'TRACE', action: 'CARTON_BIND', label: '箱盒关联绑定', targetType: 'TraceCode' },
  { method: 'PATCH', path: 'trace/alerts/:id/resolve', module: 'TRACE', action: 'ALERT_RESOLVE', label: '处置流向预警', targetType: 'AntiFleeingAlert' },
  { method: 'POST', path: 'clinics/report', module: 'CLINIC', action: 'CLINIC_REPORT', label: '机构报备', targetType: 'Clinic' },
  { method: 'POST', path: 'clinics/run-expiry-check', module: 'CLINIC', action: 'CLINIC_UNBIND', label: '执行保护期 / 解绑巡检' },
  { method: 'PUT', path: 'rules', module: 'RULE', action: 'RULE_UPDATE', label: '修改渠道规则参数', targetType: 'SystemRuleConfig' },
  { method: 'PUT', path: 'auth/sms/config', module: 'RULE', action: 'SMS_CONFIG_UPDATE', label: '修改短信通道配置', targetType: 'SystemRuleConfig' },
  { method: 'POST', path: 'orgs', module: 'ORG', action: 'DEALER_CREATE', label: '新增代理商', targetType: 'Organization' },
  { method: 'PATCH', path: 'orgs/:id/freeze', module: 'ORG', action: 'SUPPLY_FREEZE', label: '冻结 / 解冻供货', targetType: 'Organization' },
  { method: 'POST', path: 'warehouses', module: 'ORG', action: 'WAREHOUSE_CREATE', label: '新增仓库', targetType: 'Warehouse' },
  { method: 'POST', path: 'suppliers', module: 'ORG', action: 'SUPPLIER_CREATE', label: '新增供应商', targetType: 'Supplier' },
  { method: 'POST', path: 'products', module: 'PRODUCT', action: 'PRODUCT_CREATE', label: '新增商品', targetType: 'Product' },
  { method: 'PUT', path: 'products/:id', module: 'PRODUCT', action: 'PRODUCT_UPDATE', label: '修改商品资料', targetType: 'Product' },
  { method: 'POST', path: 'products/import', module: 'PRODUCT', action: 'PRODUCT_IMPORT', label: '批量导入商品' },
  { method: 'POST', path: 'brands', module: 'PRODUCT', action: 'BRAND_CREATE', label: '新增品牌' },
  { method: 'POST', path: 'categories', module: 'PRODUCT', action: 'CATEGORY_CREATE', label: '新增品类' },
  { method: 'PUT', path: 'print/templates/:id', module: 'RULE', action: 'PRINT_TEMPLATE_UPDATE', label: '修改打印模板', targetType: 'PrintTemplate' },
  { method: 'POST', path: 'rebates/calculate', module: 'REBATE', action: 'REBATE_CALCULATE', label: '核算月度返点' },
  { method: 'PUT', path: 'crm/monthly-goal', module: 'CRM', action: 'GOAL_UPDATE', label: '调整月度拜访目标' },
  { method: 'POST', path: 'crm/targets', module: 'CRM', action: 'TARGET_CREATE', label: '新增目标门店', targetType: 'VisitPlanTarget' },
  { method: 'PATCH', path: 'crm/targets/:id', module: 'CRM', action: 'TARGET_UPDATE', label: '修改目标门店', targetType: 'VisitPlanTarget' },
  { method: 'DELETE', path: 'crm/targets/:id', module: 'CRM', action: 'TARGET_DELETE', label: '删除目标门店', targetType: 'VisitPlanTarget' },
  { method: 'POST', path: 'crm/targets/import', module: 'CRM', action: 'TARGET_IMPORT', label: '批量导入目标门店' },
  { method: 'POST', path: 'crm/followups', module: 'CRM', action: 'FOLLOWUP_CREATE', label: '记录拜访跟进', targetType: 'VisitFollowUpLog' },
  { method: 'DELETE', path: 'crm/followups/:id', module: 'CRM', action: 'FOLLOWUP_DELETE', label: '删除拜访跟进', targetType: 'VisitFollowUpLog' },
];

const SENSITIVE_KEY = /pass(word)?|secret|token$|^code$|smsCode|authorization/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) {
    const head = value.slice(0, 8).map((v) => sanitize(v, depth + 1));
    return value.length > 8 ? [...head, `…共 ${value.length} 项`] : head;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k) && k !== 'codeInputs' && k !== 'codeToken') {
        out[k] = '***';
        continue;
      }
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 300) return `${value.slice(0, 300)}…`;
  return value;
}

function pickDocNo(res: any): string | undefined {
  return (
    res?.docNo ||
    res?.order?.docNo ||
    res?.stockDoc?.docNo ||
    res?.salesOrder?.docNo ||
    res?.returnOrder?.docNo ||
    res?.batch?.batchNo ||
    res?.batchNo ||
    undefined
  );
}

@Injectable()
export class AuditService implements OnModuleInit {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry) {
    try {
      await this.prisma.auditLog.create({
        data: {
          orgId: entry.orgId || null,
          operatorId: entry.operatorId || null,
          operatorName: entry.operatorName || '系统',
          roleCode: entry.roleCode || null,
          module: entry.module,
          action: entry.action,
          targetType: entry.targetType || null,
          targetId: entry.targetId || null,
          summary: entry.summary.slice(0, 500),
          diffSnapshot: (entry.diffSnapshot || {}) as any,
        },
      });
    } catch (err: any) {
      this.logger.warn(`Audit write skipped: ${err?.message}`);
    }
  }

  matchRule(method: string, rawPath: string): { rule: AuditRule; params: Record<string, string> } | null {
    const path = rawPath.replace(/^\/+/, '').replace(/^api\/v1\//, '').replace(/\/+$/, '');
    const segs = path.split('/');
    for (const rule of AUDIT_RULES) {
      if (rule.method !== method) continue;
      const rs = rule.path.split('/');
      if (rs.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < rs.length; i += 1) {
        if (rs[i].startsWith(':')) params[rs[i].slice(1)] = segs[i];
        else if (rs[i] !== segs[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { rule, params };
    }
    return null;
  }

  async recordMutation(user: AuthUser | undefined, rule: AuditRule, params: Record<string, string>, body: any, res: any) {
    const docNo = pickDocNo(res);
    const units = res?.inboundUnitsCount ?? res?.outboundUnitsCount;
    const name = res?.name || res?.clinicName || res?.clinic?.name || body?.name || body?.clinicName || body?.customerName;
    const parts = [rule.label];
    if (docNo) parts.push(docNo);
    if (name && typeof name === 'string') parts.push(name);
    if (typeof units === 'number') parts.push(`${units} 件`);
    if (rule.action === 'ALERT_RESOLVE' && body?.status) parts.push(`结论：${body.status}`);
    if (rule.action === 'SPECIAL_APPROVE' && body?.reason) parts.push(`理由：${String(body.reason).slice(0, 40)}`);

    await this.log({
      orgId: user?.orgId,
      operatorId: user?.userId,
      operatorName: user?.realName || user?.username || '系统',
      roleCode: user?.roleCode,
      module: rule.module,
      action: rule.action,
      targetType: rule.targetType,
      targetId: params.id || docNo || res?.id || null,
      summary: parts.join(' · '),
      diffSnapshot: {
        request: sanitize(body || {}),
        result: sanitize(
          res && typeof res === 'object'
            ? {
                id: res.id,
                docNo,
                status: res.status ?? res.order?.status,
                inboundUnitsCount: res.inboundUnitsCount,
                outboundUnitsCount: res.outboundUnitsCount,
                message: res.message,
              }
            : {},
        ),
      },
    });
  }

  async list(
    user: AuthUser,
    q: {
      module?: string;
      action?: string;
      operator?: string;
      keyword?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: string | number;
      pageSize?: string | number;
    },
  ) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 20));
    const where: any = {};
    if (user.orgType !== 'HQ') {
      where.orgId = user.orgId;
      const canSeeOrg = user.roleCode === 'DEALER_ADMIN' || user.roleCode.startsWith('HQ_');
      if (!canSeeOrg) where.operatorId = user.userId;
    }
    if (q.module?.trim()) where.module = q.module.trim();
    if (q.action?.trim()) where.action = q.action.trim();
    if (q.operator?.trim()) where.operatorName = { contains: q.operator.trim(), mode: 'insensitive' };
    if (q.keyword?.trim()) {
      const kw = q.keyword.trim();
      where.OR = [
        { summary: { contains: kw, mode: 'insensitive' } },
        { targetId: { contains: kw, mode: 'insensitive' } },
      ];
    }
    if (q.dateFrom || q.dateTo) {
      where.createdAt = {};
      if (q.dateFrom) where.createdAt.gte = new Date(`${String(q.dateFrom).slice(0, 10)}T00:00:00+08:00`);
      if (q.dateTo) where.createdAt.lte = new Date(`${String(q.dateTo).slice(0, 10)}T23:59:59.999+08:00`);
    }

    const [items, total, orgs] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
      this.prisma.organization.findMany({ select: { id: true, name: true } }),
    ]);
    const orgMap = new Map(orgs.map((o) => [o.id, o.name]));
    return {
      items: items.map((i) => ({ ...i, orgName: i.orgId ? orgMap.get(i.orgId) || '—' : '—' })),
      total,
      page,
      pageSize,
      modules: [
        { value: 'STOCK', label: '出入库' },
        { value: 'ORDER', label: '订单' },
        { value: 'TRACE', label: '溯源与预警' },
        { value: 'CLINIC', label: '机构保护' },
        { value: 'CRM', label: '客户拜访' },
        { value: 'RULE', label: '规则配置' },
        { value: 'ORG', label: '组织与仓库' },
        { value: 'PRODUCT', label: '商品资料' },
        { value: 'REBATE', label: '返点' },
        { value: 'AI', label: 'AI 助手' },
      ],
    };
  }

  /** One-time backfill from existing business documents so the audit trail is never blank. */
  async onModuleInit() {
    try {
      const existing = await this.prisma.auditLog.count();
      if (existing > 0) return;
      const [users, stockDocs, salesOrders, alerts, clinicLogs] = await Promise.all([
        this.prisma.user.findMany({ select: { id: true, realName: true, roleCode: true, orgId: true } }),
        this.prisma.stockDoc.findMany({
          include: { warehouse: { select: { orgId: true, name: true } }, items: { select: { qty: true } } },
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
        this.prisma.salesOrder.findMany({
          include: { buyerOrg: { select: { name: true } }, clinic: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
        this.prisma.antiFleeingAlert.findMany({ where: { status: 'RESOLVED' }, take: 100 }),
        this.prisma.clinicProtectionLog.findMany({
          include: { clinic: { select: { name: true } } },
          orderBy: { serverTimestamp: 'desc' },
          take: 100,
        }),
      ]);
      const userMap = new Map(users.map((u) => [u.id, u]));
      const docLabel: Record<string, [string, string]> = {
        HQ_INBOUND: ['INBOUND', '总仓扫码入库'],
        DEALER_INBOUND: ['INBOUND', '代理商扫码收货'],
        HQ_OUTBOUND: ['OUTBOUND', '总仓扫码出库'],
        DEALER_OUTBOUND: ['OUTBOUND', '服务商扫码出库'],
        RETURN_IN: ['RETURN', '退货回仓入库'],
        STOCKTAKE: ['STOCKTAKE', '库存盘点'],
      };
      const rows: any[] = [];
      for (const d of stockDocs) {
        const op = d.operatorId ? userMap.get(d.operatorId) : undefined;
        const [action, label] = docLabel[d.docType] || ['STOCK_DOC', d.docType];
        const qty = d.items.reduce((s, i) => s + i.qty, 0);
        rows.push({
          orgId: d.warehouse.orgId,
          operatorId: op?.id || null,
          operatorName: op?.realName || '系统',
          roleCode: op?.roleCode || null,
          module: 'STOCK',
          action,
          targetType: 'StockDoc',
          targetId: d.docNo,
          summary: `${label} · ${d.docNo} · ${d.warehouse.name} · ${qty} 件`,
          diffSnapshot: { source: 'backfill', refDocNo: d.refDocNo, remark: d.remark },
          createdAt: d.createdAt,
        });
      }
      for (const o of salesOrders) {
        const op = o.creatorId ? userMap.get(o.creatorId) : undefined;
        rows.push({
          orgId: o.sellerOrgId,
          operatorId: op?.id || null,
          operatorName: op?.realName || '系统',
          roleCode: op?.roleCode || null,
          module: 'ORDER',
          action: 'SALES_CREATE',
          targetType: 'SalesOrder',
          targetId: o.docNo,
          summary: `新建销售出库单 · ${o.docNo} · ${o.buyerOrg?.name || o.clinic?.name || '—'} · ¥${Number(o.totalAmount).toFixed(2)}`,
          diffSnapshot: { source: 'backfill', status: o.status, redlineStatus: o.redlineStatus },
          createdAt: o.createdAt,
        });
        if (o.redlineStatus === 'SPECIAL_APPROVED') {
          rows.push({
            orgId: o.sellerOrgId,
            operatorName: o.specialApprovedBy || '总部',
            module: 'ORDER',
            action: 'SPECIAL_APPROVE',
            targetType: 'SalesOrder',
            targetId: o.docNo,
            summary: `红线特批 · ${o.docNo}${o.specialApproveReason ? ` · 理由：${o.specialApproveReason}` : ''}`,
            diffSnapshot: { source: 'backfill' },
            createdAt: o.updatedAt,
          });
        }
      }
      for (const a of alerts) {
        const op = a.handlerId ? userMap.get(a.handlerId) : undefined;
        rows.push({
          orgId: a.orgId,
          operatorId: op?.id || null,
          operatorName: op?.realName || '流向管控',
          roleCode: op?.roleCode || null,
          module: 'TRACE',
          action: 'ALERT_RESOLVE',
          targetType: 'AntiFleeingAlert',
          targetId: a.id,
          summary: `处置流向预警 · ${a.title}${a.resolution ? ` · ${a.resolution.slice(0, 40)}` : ''}`,
          diffSnapshot: { source: 'backfill', alertType: a.alertType },
          createdAt: a.resolvedAt || a.createdAt,
        });
      }
      const clinicLabel: Record<string, [string, string]> = {
        REPORT: ['CLINIC_REPORT', '机构报备'],
        UPGRADE_BOUND: ['CLINIC_BIND', '首单绑定机构'],
        RELEASE_90D: ['CLINIC_UNBIND', '90 天保护期到期释放'],
        RELEASE_270D: ['CLINIC_UNBIND', '270 天无复购解绑'],
        MANUAL_TRANSFER: ['CLINIC_TRANSFER', '机构人工调拨'],
      };
      for (const l of clinicLogs) {
        const op = l.operatorId ? userMap.get(l.operatorId) : undefined;
        const [action, label] = clinicLabel[l.action] || ['CLINIC_LOG', l.action];
        rows.push({
          orgId: l.orgId,
          operatorId: op?.id || null,
          operatorName: op?.realName || '系统',
          roleCode: op?.roleCode || null,
          module: 'CLINIC',
          action,
          targetType: 'Clinic',
          targetId: l.clinicId,
          summary: `${label} · ${l.clinic.name}`,
          diffSnapshot: { source: 'backfill', remark: l.remark },
          createdAt: l.serverTimestamp,
        });
      }
      if (rows.length) {
        await this.prisma.auditLog.createMany({ data: rows });
        this.logger.log(`Audit trail backfilled with ${rows.length} historical records`);
      }
    } catch (err: any) {
      this.logger.warn(`Audit backfill skipped: ${err?.message}`);
    }
  }
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const method = String(req.method || '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next.handle();
    const routePath: string = req.route?.path || req.path || '';
    const matched = this.audit.matchRule(method, routePath.replace(/\?.*$/, ''));
    if (!matched) return next.handle();
    const user = req.user as AuthUser | undefined;
    const body = req.body;
    return next.handle().pipe(
      tap({
        next: (res) => {
          void this.audit.recordMutation(user, matched.rule, { ...matched.params, ...(req.params || {}) }, body, res);
        },
      }),
    );
  }
}

@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('audit-logs')
  list(
    @CurrentUser() user: AuthUser,
    @Query('module') module?: string,
    @Query('action') action?: string,
    @Query('operator') operator?: string,
    @Query('keyword') keyword?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.audit.list(user, { module, action, operator, keyword, dateFrom, dateTo, page, pageSize });
  }
}

@Global()
@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: ScopeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
