import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Post,
  Query,
} from '@nestjs/common';
import { ClinicBindStatus, SalesOrderStatus, TraceCodeLevel } from '@lumina/shared-types';
import { PrismaService } from '../../common/prisma.module';
import { AuthUser, CurrentUser } from '../../common/auth.decorators';

@Injectable()
export class RebateService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(user: AuthUser) {
    const isHq = user.orgType === 'HQ';
    const orderWhere = isHq
      ? { status: { not: SalesOrderStatus.CANCELLED } }
      : { sellerOrgId: user.orgId, status: { not: SalesOrderStatus.CANCELLED } };

    const [
      totalUnitsGenerated,
      totalVerifiedConsumers,
      openAlertsCount,
      pendingOutboundCount,
      salesOrders,
      clinics,
      recentAlerts,
      pendingOrders,
    ] = await Promise.all([
      this.prisma.traceCode.count({ where: { codeLevel: TraceCodeLevel.UNIT } }),
      this.prisma.consumerVerifyLog.count(),
      this.prisma.antiFleeingAlert.count({
        where: { status: 'OPEN', ...(isHq ? {} : { orgId: user.orgId }) },
      }),
      this.prisma.salesOrder.count({
        where: {
          status: { in: [SalesOrderStatus.PENDING_OUTBOUND, SalesOrderStatus.PARTIAL_OUTBOUND] },
          ...(isHq ? {} : { sellerOrgId: user.orgId }),
        },
      }),
      this.prisma.salesOrder.findMany({
        where: orderWhere,
        include: { items: { include: { product: true } } },
      }),
      this.prisma.clinic.findMany({
        where: isHq ? {} : { ownerOrgId: user.orgId },
        include: { ownerOrg: { select: { name: true } } },
      }),
      this.prisma.antiFleeingAlert.findMany({
        where: { ...(isHq ? {} : { orgId: user.orgId }) },
        include: { org: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.prisma.salesOrder.findMany({
        where: {
          status: {
            in: [
              SalesOrderStatus.PENDING_APPROVAL,
              SalesOrderStatus.PENDING_OUTBOUND,
              SalesOrderStatus.PARTIAL_OUTBOUND,
            ],
          },
          ...(isHq ? {} : { sellerOrgId: user.orgId }),
        },
        include: {
          buyerOrg: { select: { name: true } },
          clinic: { select: { name: true } },
          warehouse: { select: { name: true } },
          items: { include: { product: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    const totalSalesAmount = salesOrders.reduce((s, o) => s + Number(o.totalAmount), 0);
    const totalSalesQty = salesOrders.reduce(
      (s, o) => s + o.items.reduce((is, it) => is + it.qty, 0),
      0,
    );
    const totalCost = salesOrders.reduce(
      (s, o) => s + o.items.reduce((is, it) => is + it.qty * Number(it.product.costPrice), 0),
      0,
    );
    const grossProfit = Number((totalSalesAmount - totalCost).toFixed(2));
    const grossMarginPercent =
      totalSalesAmount > 0 ? Number(((grossProfit / totalSalesAmount) * 100).toFixed(2)) : 0;

    const nowMs = Date.now();
    const expiringClinics = clinics
      .map((c) => {
        let daysLeft: number | null = null;
        let warnType = '';
        if (c.bindStatus === ClinicBindStatus.PROTECTED_90D && c.protectExpireAt) {
          daysLeft = Math.ceil((c.protectExpireAt.getTime() - nowMs) / 86400_000);
          warnType = '90天保护期';
        } else if (c.bindStatus === ClinicBindStatus.BOUND_ACTIVE && c.lastOrderAt) {
          daysLeft = Math.ceil((c.lastOrderAt.getTime() + 270 * 86400_000 - nowMs) / 86400_000);
          warnType = '270天未复购解绑';
        }
        return { ...c, daysLeft, warnType };
      })
      .filter((c) => c.daysLeft !== null && c.daysLeft <= 30)
      .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

    return {
      kpis: {
        totalUnitsGenerated,
        totalVerifiedConsumers,
        openAlertsCount,
        pendingOutboundCount,
        totalSalesAmount: Number(totalSalesAmount.toFixed(2)),
        totalSalesQty,
        grossProfit,
        grossMarginPercent,
        activeClinicsCount: clinics.filter((c) => c.bindStatus !== ClinicBindStatus.PUBLIC_POOL).length,
      },
      expiringClinics,
      recentAlerts,
      pendingOrders,
    };
  }

  /**
   * Multi-dimensional sales report matching 生意通 sales report tabs.
   */
  async getSalesReport(user: AuthUser, groupBy: string = 'detail') {
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        status: { not: SalesOrderStatus.CANCELLED },
        ...(user.orgType === 'HQ' ? {} : { sellerOrgId: user.orgId }),
      },
      include: {
        sellerOrg: true,
        buyerOrg: true,
        clinic: true,
        warehouse: true,
        items: { include: { product: { include: { brand: true, category: true } } } },
      },
      orderBy: { bizDate: 'desc' },
    });

    const details = orders.flatMap((o) =>
      o.items.map((it) => {
        const revenue = Number(it.lineAmount);
        const cost = Number((it.qty * Number(it.product.costPrice)).toFixed(2));
        const profit = Number((revenue - cost).toFixed(2));
        return {
          docNo: o.docNo,
          bizDate: o.bizDate.toISOString().slice(0, 10),
          orderScene: o.orderScene,
          customerName: o.buyerOrg?.name || o.clinic?.name || '散客',
          warehouseName: o.warehouse.name,
          sellerOrgName: o.sellerOrg.name,
          productId: it.productId,
          skuCode: it.product.skuCode,
          productName: it.product.name,
          brandName: it.product.brand.name,
          spec: it.product.spec,
          unitName: it.product.unitName,
          qty: it.qty,
          unitPrice: Number(it.unitPrice),
          discountPercent: Number(it.discountPercent),
          lineAmount: revenue,
          grossProfit: profit,
          redlineStatus: o.redlineStatus,
        };
      }),
    );

    const totalQty = details.reduce((s, d) => s + d.qty, 0);
    const totalSales = Number(details.reduce((s, d) => s + d.lineAmount, 0).toFixed(2));
    const totalProfit = Number(details.reduce((s, d) => s + d.grossProfit, 0).toFixed(2));
    const marginRate = totalSales > 0 ? Number(((totalProfit / totalSales) * 100).toFixed(2)) : 0;

    if (groupBy === 'product') {
      const map = new Map<string, { skuCode: string; productName: string; brandName: string; qty: number; lineAmount: number; grossProfit: number }>();
      for (const d of details) {
        const prev = map.get(d.skuCode) || {
          skuCode: d.skuCode,
          productName: d.productName,
          brandName: d.brandName,
          qty: 0,
          lineAmount: 0,
          grossProfit: 0,
        };
        prev.qty += d.qty;
        prev.lineAmount = Number((prev.lineAmount + d.lineAmount).toFixed(2));
        prev.grossProfit = Number((prev.grossProfit + d.grossProfit).toFixed(2));
        map.set(d.skuCode, prev);
      }
      return { summary: { totalQty, totalSales, totalProfit, marginRate }, rows: Array.from(map.values()) };
    }

    if (groupBy === 'customer') {
      const map = new Map<string, { customerName: string; orderCount: number; qty: number; lineAmount: number; grossProfit: number }>();
      for (const d of details) {
        const prev = map.get(d.customerName) || {
          customerName: d.customerName,
          orderCount: 0,
          qty: 0,
          lineAmount: 0,
          grossProfit: 0,
        };
        prev.orderCount += 1;
        prev.qty += d.qty;
        prev.lineAmount = Number((prev.lineAmount + d.lineAmount).toFixed(2));
        prev.grossProfit = Number((prev.grossProfit + d.grossProfit).toFixed(2));
        map.set(d.customerName, prev);
      }
      return { summary: { totalQty, totalSales, totalProfit, marginRate }, rows: Array.from(map.values()) };
    }

    return { summary: { totalQty, totalSales, totalProfit, marginRate }, rows: details };
  }

  /**
   * Auditable Dealer KPI Rebate Auto-Calculation:
   * Base rebate tier by payment volume + Bonus rebate by SKU coverage & new active clinics - Compliance penalties.
   */
  async listRebates(user: AuthUser) {
    return this.prisma.rebateStatement.findMany({
      where: user.orgType === 'HQ' ? {} : { orgId: user.orgId },
      include: { org: { select: { id: true, name: true, code: true, priceTier: true } } },
      orderBy: [{ periodMonth: 'desc' }, { finalRebateAmount: 'desc' }],
    });
  }

  async calculateRebates(user: AuthUser, periodMonth: string) {
    if (user.orgType !== 'HQ') {
      throw new ForbiddenException('仅品牌总部可执行月度 KPI 返点自动核算');
    }

    const dealers = await this.prisma.organization.findMany({ where: { type: 'DEALER' } });
    const coreProducts = await this.prisma.product.findMany({
      where: { isCoreKpi: true, status: 'ACTIVE' },
    });
    const totalCoreSkuCount = coreProducts.length || 1;
    const coreSkuIds = new Set(coreProducts.map((p) => p.id));

    const results = [];
    for (const dealer of dealers) {
      // Valid orders where HQ sold to this dealer OR dealer sold out to clinics
      const hqSupplyOrders = await this.prisma.salesOrder.findMany({
        where: {
          buyerOrgId: dealer.id,
          status: { in: [SalesOrderStatus.COMPLETED, SalesOrderStatus.PARTIAL_OUTBOUND, SalesOrderStatus.PENDING_OUTBOUND] },
        },
        include: { items: true },
      });

      const dealerSalesOrders = await this.prisma.salesOrder.findMany({
        where: {
          sellerOrgId: dealer.id,
          status: { in: [SalesOrderStatus.COMPLETED, SalesOrderStatus.PARTIAL_OUTBOUND] },
        },
        include: { items: true },
      });

      const paymentAmount = Number(
        hqSupplyOrders.reduce((s, o) => s + Number(o.paidAmount || o.totalAmount), 0).toFixed(2),
      );

      const activeClinics = await this.prisma.clinic.count({
        where: { ownerOrgId: dealer.id, bindStatus: ClinicBindStatus.BOUND_ACTIVE },
      });

      const movedCoreSkus = new Set<string>();
      for (const o of [...hqSupplyOrders, ...dealerSalesOrders]) {
        for (const it of o.items) {
          if (coreSkuIds.has(it.productId)) movedCoreSkus.add(it.productId);
        }
      }

      const skuCoverageRate = Number((movedCoreSkus.size / totalCoreSkuCount).toFixed(4));

      // Tiered base rate: >= 50k -> 8%, >= 10k -> 5%, > 0 -> 3%
      const baseRebateRate = paymentAmount >= 50000 ? 0.08 : paymentAmount >= 10000 ? 0.05 : paymentAmount > 0 ? 0.03 : 0;
      // Bonus: +2% if SKU coverage >= 60% and >= 2 active clinics; +1% if >= 1 active clinic
      const bonusRebateRate =
        skuCoverageRate >= 0.6 && activeClinics >= 2 ? 0.02 : activeClinics >= 1 ? 0.01 : 0;

      // Compliance deduction: ¥500 per open/unresolved CRITICAL or HIGH alert
      const openHighAlerts = await this.prisma.antiFleeingAlert.findMany({
        where: { orgId: dealer.id, status: 'OPEN', severity: { in: ['HIGH', 'CRITICAL'] } },
      });
      const penaltyDeduction = openHighAlerts.length * 500;

      const grossRebate = paymentAmount * (baseRebateRate + bonusRebateRate);
      const finalRebateAmount = Math.max(0, Number((grossRebate - penaltyDeduction).toFixed(2)));

      const stmt = await this.prisma.rebateStatement.upsert({
        where: { periodMonth_orgId: { periodMonth, orgId: dealer.id } },
        update: {
          paymentAmount,
          newActiveClinics: activeClinics,
          activeCoreSkuCount: movedCoreSkus.size,
          totalCoreSkuCount,
          skuCoverageRate,
          baseRebateRate,
          bonusRebateRate,
          penaltyDeduction,
          finalRebateAmount,
          auditSnapshot: {
            hqSupplyOrderNos: hqSupplyOrders.map((o) => o.docNo),
            dealerOutboundOrderNos: dealerSalesOrders.map((o) => o.docNo),
            openAlertIds: openHighAlerts.map((a) => a.id),
            calculatedAt: new Date().toISOString(),
          },
        },
        create: {
          periodMonth,
          orgId: dealer.id,
          paymentAmount,
          newActiveClinics: activeClinics,
          activeCoreSkuCount: movedCoreSkus.size,
          totalCoreSkuCount,
          skuCoverageRate,
          baseRebateRate,
          bonusRebateRate,
          penaltyDeduction,
          finalRebateAmount,
          auditSnapshot: {
            hqSupplyOrderNos: hqSupplyOrders.map((o) => o.docNo),
            dealerOutboundOrderNos: dealerSalesOrders.map((o) => o.docNo),
            openAlertIds: openHighAlerts.map((a) => a.id),
            calculatedAt: new Date().toISOString(),
          },
        },
        include: { org: { select: { id: true, name: true, code: true } } },
      });
      results.push(stmt);
    }

    return results;
  }
}

@Controller()
export class RebateController {
  constructor(private readonly rebateService: RebateService) {}

  @Get('reports/dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.rebateService.getDashboard(user);
  }

  @Get('reports/sales')
  salesReport(@CurrentUser() user: AuthUser, @Query('groupBy') groupBy?: string) {
    return this.rebateService.getSalesReport(user, groupBy || 'detail');
  }

  @Get('rebates')
  listRebates(@CurrentUser() user: AuthUser) {
    return this.rebateService.listRebates(user);
  }

  @Post('rebates/calculate')
  calculate(@CurrentUser() user: AuthUser, @Body() body: { periodMonth: string }) {
    return this.rebateService.calculateRebates(user, body.periodMonth);
  }
}

@Module({
  controllers: [RebateController],
  providers: [RebateService],
  exports: [RebateService],
})
export class RebateModule {}
