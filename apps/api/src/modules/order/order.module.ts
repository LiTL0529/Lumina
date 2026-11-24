import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  AlertSeverity,
  AlertType,
  evaluateSupplyRedline,
  OrderScene,
  RedlineStatus,
  SalesOrderStatus,
  TraceCodeLevel,
  TraceCodeStatus,
  TraceEventType,
} from '@lumina/shared-types';
import { extractTokenFromScanInput } from '@lumina/trace-crypto';
import { PrismaService } from '../../common/prisma.module';
import { EventsGateway } from '../../common/events.module';
import { AuthUser, CurrentUser } from '../../common/auth.decorators';

function makeDocNo(prefix: string): string {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const rnd = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${ymd}${rnd}`;
}

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  // ======================== Purchase Orders ========================

  async listPurchaseOrders(user: AuthUser) {
    return this.prisma.purchaseOrder.findMany({
      where: user.orgType === 'HQ' ? {} : { orgId: user.orgId },
      include: {
        supplier: true,
        warehouse: true,
        items: { include: { product: { include: { brand: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPurchaseOrder(
    user: AuthUser,
    body: {
      supplierId: string;
      warehouseId: string;
      bizDate?: string;
      paidAmount?: number;
      remark?: string;
      items: Array<{ productId: string; qty: number; unitPrice: number; discountPercent?: number; remark?: string }>;
    },
  ) {
    if (!body.supplierId || !body.warehouseId || !body.items?.length) {
      throw new BadRequestException('供应商、仓库和商品明细不能为空');
    }
    let totalAmount = 0;
    const itemCreates = body.items.map((it) => {
      const disc = it.discountPercent ?? 100;
      const lineAmount = Number((it.qty * it.unitPrice * (disc / 100)).toFixed(2));
      totalAmount += lineAmount;
      return {
        productId: it.productId,
        qty: Number(it.qty),
        unitPrice: Number(it.unitPrice),
        discountPercent: disc,
        lineAmount,
        remark: it.remark || null,
      };
    });

    return this.prisma.purchaseOrder.create({
      data: {
        docNo: makeDocNo('CG'),
        orgId: user.orgId,
        supplierId: body.supplierId,
        warehouseId: body.warehouseId,
        bizDate: body.bizDate ? new Date(body.bizDate) : new Date(),
        status: 'PENDING_INBOUND',
        totalAmount: Number(totalAmount.toFixed(2)),
        paidAmount: Number(body.paidAmount || 0),
        remark: body.remark || null,
        creatorId: user.userId,
        items: { create: itemCreates },
      },
      include: {
        supplier: true,
        warehouse: true,
        items: { include: { product: true } },
      },
    });
  }

  // ======================== Sales Orders & 3.5折 Redline ========================

  async checkRedline(body: {
    items: Array<{ productId: string; qty: number; unitPrice: number; discountPercent: number; isGift?: boolean }>;
    roundingAmount?: number;
  }) {
    const productIds = Array.from(new Set((body.items || []).map((i) => i.productId)));
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } });
    const pMap = new Map(products.map((p) => [p.id, p]));
    const rules = await this.prisma.systemRuleConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });

    const lines = (body.items || []).map((i) => {
      const p = pMap.get(i.productId);
      if (!p) throw new BadRequestException(`商品 ${i.productId} 不存在`);
      return {
        skuCode: p.skuCode,
        productName: p.name,
        qty: Number(i.qty),
        retailPrice: Number(p.retailPrice),
        unitPrice: Number(i.unitPrice),
        discountPercent: Number(i.discountPercent),
        minSupplyRatio: Number(p.minSupplyDiscount),
        isGift: Boolean(i.isGift),
      };
    });

    return evaluateSupplyRedline({
      lines,
      roundingAmount: Number(body.roundingAmount || 0),
      defaultMinSupplyRatio: Number(rules.defaultMinSupplyRatio),
    });
  }

  async listSalesOrders(user: AuthUser, filter?: { status?: string; scene?: string }) {
    const where: Record<string, unknown> = {};
    if (user.orgType !== 'HQ') {
      where.OR = [{ sellerOrgId: user.orgId }, { buyerOrgId: user.orgId }];
    }
    if (filter?.status) where.status = filter.status;
    if (filter?.scene) where.orderScene = filter.scene;

    return this.prisma.salesOrder.findMany({
      where,
      include: {
        sellerOrg: { select: { id: true, name: true, code: true } },
        buyerOrg: { select: { id: true, name: true, code: true } },
        clinic: { select: { id: true, name: true, city: true, arrearsAmount: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        items: { include: { product: { include: { brand: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 出库码归属：该单出库时实际绑定到客户（服务商/机构）名下的防伪码清单。
   * 客户端的“出库码记录到该代理商名下”即由此接口取证。
   */
  async listOrderCodes(user: AuthUser, orderId: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        buyerOrg: { select: { id: true, name: true, code: true } },
        clinic: { select: { id: true, name: true, city: true } },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (user.orgType !== 'HQ' && order.sellerOrgId !== user.orgId && order.buyerOrgId !== user.orgId) {
      throw new ForbiddenException('无权查看该订单的出库码');
    }

    const events = await this.prisma.traceEvent.findMany({
      where: {
        eventType: { in: [TraceEventType.HQ_OUTBOUND, TraceEventType.DEALER_OUTBOUND] },
        // 新单据写 docId；历史单据只留了单号，按单号兜底匹配
        OR: [{ docId: orderId }, { docId: null, docNo: order.docNo }],
      },
      include: {
        traceCode: {
          select: {
            codeToken: true,
            codeLevel: true,
            status: true,
            verifyCount: true,
            firstVerifyAt: true,
            product: { select: { name: true, skuCode: true } },
          },
        },
      },
      orderBy: { occurredAt: 'asc' },
    });

    const codes = events.map((e) => ({
      token: e.traceCode.codeToken,
      codeLevel: e.traceCode.codeLevel,
      status: e.traceCode.status,
      productName: e.traceCode.product.name,
      skuCode: e.traceCode.product.skuCode,
      verifyCount: e.traceCode.verifyCount,
      firstVerifyAt: e.traceCode.firstVerifyAt,
      occurredAt: e.occurredAt,
    }));

    return {
      order: {
        id: order.id,
        docNo: order.docNo,
        status: order.status,
        orderScene: order.orderScene,
        bizDate: order.bizDate,
        ownerName: order.buyerOrg?.name || order.clinic?.name || '',
        ownerCode: order.buyerOrg?.code || '',
        ownerType: order.orderScene === 'HQ_TO_DEALER' ? 'DEALER' : 'CLINIC',
      },
      codes,
      summary: {
        totalCodes: codes.length,
        cartonCodes: codes.filter((c) => c.codeLevel === TraceCodeLevel.CARTON).length,
        unitCodes: codes.filter((c) => c.codeLevel === TraceCodeLevel.UNIT).length,
      },
    };
  }

  async createSalesOrder(
    user: AuthUser,
    body: {
      orderScene: OrderScene;
      buyerOrgId?: string;
      clinicId?: string;
      warehouseId: string;
      bizDate?: string;
      roundingAmount?: number;
      otherFee?: number;
      paidAmount?: number;
      shippingMethod?: string;
      trackingNo?: string;
      remark?: string;
      asDraft?: boolean;
      requestSpecialApproval?: boolean;
      items: Array<{
        productId: string;
        qty: number;
        unitPrice: number;
        discountPercent: number;
        isGift?: boolean;
        remark?: string;
      }>;
    },
  ) {
    if (!body.warehouseId || !body.items?.length) {
      throw new BadRequestException('出库仓库与商品明细不能为空');
    }

    const sellerOrg = await this.prisma.organization.findUnique({ where: { id: user.orgId } });
    if (sellerOrg?.supplyFrozen) {
      throw new ForbiddenException(
        `当前主体已被总部暂停供货权限（原因：${sellerOrg.freezeReason || '流向核验异常'}），请联系品牌流向管控负责人解冻。`,
      );
    }

    // If HQ shipping to dealer, check whether target dealer is frozen
    let customerName = '';
    if (body.orderScene === OrderScene.HQ_TO_DEALER) {
      if (!body.buyerOrgId) throw new BadRequestException('总仓供货单必须指定目标服务商');
      const buyer = await this.prisma.organization.findUnique({ where: { id: body.buyerOrgId } });
      if (!buyer) throw new NotFoundException('目标服务商不存在');
      if (buyer.supplyFrozen) {
        throw new ForbiddenException(
          `服务商【${buyer.name}】当前处于停供冻结状态（${buyer.freezeReason || '异常未解冻'}），禁止开具供货单。`,
        );
      }
      customerName = buyer.name;
    } else {
      if (!body.clinicId) throw new BadRequestException('服务商销售单必须指定终端机构');
      const clinic = await this.prisma.clinic.findUnique({ where: { id: body.clinicId } });
      if (!clinic) throw new NotFoundException('目标机构不存在');
      if (user.orgType !== 'HQ' && clinic.ownerOrgId && clinic.ownerOrgId !== user.orgId) {
        throw new ForbiddenException('该机构当前处于其他服务商保护/绑定期内，禁止越权开单！');
      }
      customerName = clinic.name;
    }

    const rules = await this.prisma.systemRuleConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });
    const redline = await this.checkRedline({
      items: body.items,
      roundingAmount: body.roundingAmount,
    });

    if (!redline.passed && !body.asDraft) {
      if (!rules.allowSpecialPriceApprove || !body.requestSpecialApproval) {
        throw new BadRequestException({
          code: 'REDLINE_VIOLATION',
          message: redline.violations.map((v) => v.message).join('；'),
          redline,
        });
      }
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: body.items.map((i) => i.productId) } },
    });
    const pMap = new Map(products.map((p) => [p.id, p]));

    const itemCreates = body.items.map((it) => {
      const p = pMap.get(it.productId)!;
      const lineAmount = it.isGift
        ? 0
        : Number((it.qty * it.unitPrice * (it.discountPercent / 100)).toFixed(2));
      return {
        productId: it.productId,
        qty: Number(it.qty),
        retailPrice: p.retailPrice,
        unitPrice: Number(it.unitPrice),
        discountPercent: it.isGift ? 0 : Number(it.discountPercent),
        isGift: Boolean(it.isGift),
        lineAmount,
        remark: it.remark || null,
      };
    });

    const subtotalAmount = Number(
      itemCreates.reduce((s, i) => s + i.lineAmount, 0).toFixed(2),
    );
    const roundingAmount = Math.max(0, Number(body.roundingAmount || 0));
    const otherFee = Math.max(0, Number(body.otherFee || 0));
    const totalAmount = Number(Math.max(0, subtotalAmount - roundingAmount + otherFee).toFixed(2));
    const paidAmount = Number(body.paidAmount || 0);

    let status = SalesOrderStatus.PENDING_OUTBOUND;
    let redlineStatus = RedlineStatus.PASS;
    if (body.asDraft) {
      status = SalesOrderStatus.DRAFT;
      redlineStatus = redline.passed ? RedlineStatus.PASS : RedlineStatus.BLOCKED;
    } else if (!redline.passed) {
      status = SalesOrderStatus.PENDING_APPROVAL;
      redlineStatus = RedlineStatus.BLOCKED;
    }

    const order = await this.prisma.salesOrder.create({
      data: {
        docNo: makeDocNo('XS'),
        orderScene: body.orderScene,
        sellerOrgId: user.orgId,
        buyerOrgId: body.orderScene === OrderScene.HQ_TO_DEALER ? body.buyerOrgId : null,
        clinicId: body.orderScene === OrderScene.DEALER_TO_CLINIC ? body.clinicId : null,
        warehouseId: body.warehouseId,
        salesRepId: user.userId,
        bizDate: body.bizDate ? new Date(body.bizDate) : new Date(),
        status,
        totalRetailAmount: redline.totalRetailValue,
        subtotalAmount,
        roundingAmount,
        otherFee,
        totalAmount,
        paidAmount,
        compositeDiscountRatio: redline.compositeRatio,
        redlineStatus,
        redlineViolations: redline.violations as unknown as object,
        shippingMethod: body.shippingMethod || '物流发货',
        trackingNo: body.trackingNo || null,
        remark: body.remark || null,
        creatorId: user.userId,
        items: { create: itemCreates },
      },
      include: {
        sellerOrg: true,
        buyerOrg: true,
        clinic: true,
        warehouse: true,
        items: { include: { product: true } },
      },
    });

    // Update clinic arrears if unpaid balance exists
    if (order.clinicId && status === SalesOrderStatus.PENDING_OUTBOUND && totalAmount > paidAmount) {
      await this.prisma.clinic.update({
        where: { id: order.clinicId },
        data: { arrearsAmount: { increment: Number((totalAmount - paidAmount).toFixed(2)) } },
      });
    }

    if (!redline.passed && !body.asDraft) {
      const alert = await this.prisma.antiFleeingAlert.create({
        data: {
          alertType: AlertType.PRICE_BELOW_REDLINE,
          severity: AlertSeverity.HIGH,
          orgId: user.orgId,
          docNo: order.docNo,
          title: `破 3.5 折红线特批申请（单号 ${order.docNo}，综合 ${(redline.compositeRatio * 10).toFixed(2)} 折）`,
          detail: redline.violations.map((v) => v.message).join('；'),
          evidenceSnapshot: redline as unknown as object,
        },
      });
      this.events.notifyAlert({
        id: alert.id,
        alertType: alert.alertType,
        title: alert.title,
        severity: alert.severity,
      });
    } else if (status === SalesOrderStatus.PENDING_OUTBOUND) {
      this.events.notifyNewOrder(user.orgId, {
        docNo: order.docNo,
        customerName,
        totalAmount,
        warehouseId: order.warehouseId,
      });
    }

    return { order, redline };
  }

  async specialApprove(
    user: AuthUser,
    id: string,
    body: { approve: boolean; reason?: string },
  ) {
    if (user.orgType !== 'HQ') {
      throw new ForbiddenException('仅品牌总部可审批低于 3.5 折红线的特批订单');
    }
    const order = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('订单不存在');

    return this.prisma.salesOrder.update({
      where: { id },
      data: {
        status: body.approve ? SalesOrderStatus.PENDING_OUTBOUND : SalesOrderStatus.CANCELLED,
        redlineStatus: body.approve ? RedlineStatus.SPECIAL_APPROVED : RedlineStatus.BLOCKED,
        specialApprovedBy: user.userId,
        specialApproveReason: body.reason || (body.approve ? '总部特批放行' : '破价驳回'),
      },
    });
  }

  async incrementPrintCount(id: string) {
    return this.prisma.salesOrder.update({
      where: { id },
      data: { printCount: { increment: 1 } },
    });
  }

  // ======================== Sales Return Orders (Code Re-entry) ========================

  async listReturnOrders(user: AuthUser) {
    return this.prisma.returnOrder.findMany({
      where: user.orgType === 'HQ' ? {} : { orgId: user.orgId },
      include: {
        warehouse: true,
        clinic: true,
        items: { include: { product: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createReturnOrder(
    user: AuthUser,
    body: {
      warehouseId: string;
      clinicId?: string;
      originalSalesNo?: string;
      remark?: string;
      codeInputs: string[];
      unitPriceOverride?: number;
    },
  ) {
    const cleanTokens = Array.from(
      new Set(
        (body.codeInputs || [])
          .map((c) => extractTokenFromScanInput(c))
          .filter((x): x is string => Boolean(x)),
      ),
    );
    if (!body.warehouseId || cleanTokens.length === 0) {
      throw new BadRequestException('退货回仓必须指定仓库并扫描原单品防伪码');
    }

    const wh = await this.prisma.warehouse.findUnique({
      where: { id: body.warehouseId },
      include: { org: true },
    });
    if (!wh) throw new NotFoundException('目标退回仓库不存在');

    const codes = await this.prisma.traceCode.findMany({
      where: { codeToken: { in: cleanTokens } },
      include: { product: true },
    });
    if (codes.length !== cleanTokens.length) {
      throw new BadRequestException('部分退货码不存在于系统中');
    }

    for (const c of codes) {
      if (c.codeLevel !== TraceCodeLevel.UNIT) {
        throw new BadRequestException(`退货请逐盒扫描单品码（${c.codeToken} 为外箱码）`);
      }
      if (c.status === TraceCodeStatus.IN_HQ_STOCK || c.status === TraceCodeStatus.IN_DEALER_STOCK) {
        throw new BadRequestException(`单品码 ${c.codeToken} 当前已在库中，请勿重复退货`);
      }
    }

    const targetStatus =
      wh.org.type === 'HQ' ? TraceCodeStatus.IN_HQ_STOCK : TraceCodeStatus.IN_DEALER_STOCK;
    const eventType =
      wh.org.type === 'HQ' ? TraceEventType.RETURN_TO_HQ : TraceEventType.RETURN_TO_DEALER;

    // Group by productId
    const byProduct = new Map<string, typeof codes>();
    for (const c of codes) {
      const arr = byProduct.get(c.productId) || [];
      arr.push(c);
      byProduct.set(c.productId, arr);
    }

    const docNo = makeDocNo('TH');

    return this.prisma.$transaction(async (tx) => {
      let totalRefund = 0;
      const itemCreates: Array<{
        productId: string;
        qty: number;
        unitPrice: number;
        lineAmount: number;
        returnedCodes: string[];
      }> = [];

      for (const [productId, pCodes] of byProduct.entries()) {
        const product = pCodes[0].product;
        const unitPrice = Number(body.unitPriceOverride ?? product.defaultSupplyPrice);
        const lineAmount = Number((unitPrice * pCodes.length).toFixed(2));
        totalRefund += lineAmount;
        itemCreates.push({
          productId,
          qty: pCodes.length,
          unitPrice,
          lineAmount,
          returnedCodes: pCodes.map((x) => x.codeToken),
        });

        // Update stock balance & ledger
        const bal = await tx.stockBalance.upsert({
          where: { warehouseId_productId: { warehouseId: wh.id, productId } },
          update: { qty: { increment: pCodes.length }, version: { increment: 1 } },
          create: { warehouseId: wh.id, productId, qty: pCodes.length },
        });

        await tx.stockLedger.create({
          data: {
            warehouseId: wh.id,
            productId,
            beforeQty: bal.qty - pCodes.length,
            deltaQty: pCodes.length,
            afterQty: bal.qty,
            docType: 'RETURN_IN',
            docNo,
            operatorId: user.userId,
          },
        });
      }

      // Restore codes back to warehouse stock & clear downstream clinic ownership
      for (const c of codes) {
        await tx.traceCode.update({
          where: { id: c.id },
          data: {
            status: targetStatus,
            currentOrgId: wh.orgId,
            currentWarehouseId: wh.id,
            targetClinicId: null,
            assignedDealerId: wh.org.type === 'HQ' ? null : wh.orgId,
          },
        });
        await tx.traceEvent.create({
          data: {
            traceCodeId: c.id,
            eventType,
            toOrgId: wh.orgId,
            warehouseId: wh.id,
            clinicId: body.clinicId || c.targetClinicId,
            docType: 'RETURN_ORDER',
            docNo,
            operatorId: user.userId,
            remark: `退货扫码回仓，已解除下游归属（原单：${body.originalSalesNo || '无'}）`,
          },
        });
      }

      return tx.returnOrder.create({
        data: {
          docNo,
          orgId: user.orgId,
          warehouseId: wh.id,
          clinicId: body.clinicId || null,
          originalSalesNo: body.originalSalesNo || null,
          totalRefundAmount: Number(totalRefund.toFixed(2)),
          remark: body.remark || null,
          creatorId: user.userId,
          items: { create: itemCreates },
        },
        include: {
          warehouse: true,
          clinic: true,
          items: { include: { product: true } },
        },
      });
    });
  }
}

@Controller()
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get('purchase-orders')
  listPurchase(@CurrentUser() user: AuthUser) {
    return this.orderService.listPurchaseOrders(user);
  }

  @Post('purchase-orders')
  createPurchase(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      supplierId: string;
      warehouseId: string;
      bizDate?: string;
      paidAmount?: number;
      remark?: string;
      items: Array<{ productId: string; qty: number; unitPrice: number; discountPercent?: number; remark?: string }>;
    },
  ) {
    return this.orderService.createPurchaseOrder(user, body);
  }

  @Post('sales-orders/check-redline')
  checkRedline(
    @Body()
    body: {
      items: Array<{ productId: string; qty: number; unitPrice: number; discountPercent: number; isGift?: boolean }>;
      roundingAmount?: number;
    },
  ) {
    return this.orderService.checkRedline(body);
  }

  @Get('sales-orders')
  listSales(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('scene') scene?: string,
  ) {
    return this.orderService.listSalesOrders(user, { status, scene });
  }

  @Get('sales-orders/:id/codes')
  orderCodes(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orderService.listOrderCodes(user, id);
  }

  @Post('sales-orders')
  createSales(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      orderScene: OrderScene;
      buyerOrgId?: string;
      clinicId?: string;
      warehouseId: string;
      bizDate?: string;
      roundingAmount?: number;
      otherFee?: number;
      paidAmount?: number;
      shippingMethod?: string;
      trackingNo?: string;
      remark?: string;
      asDraft?: boolean;
      requestSpecialApproval?: boolean;
      items: Array<{
        productId: string;
        qty: number;
        unitPrice: number;
        discountPercent: number;
        isGift?: boolean;
        remark?: string;
      }>;
    },
  ) {
    return this.orderService.createSalesOrder(user, body);
  }

  @Post('sales-orders/:id/special-approve')
  specialApprove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { approve: boolean; reason?: string },
  ) {
    return this.orderService.specialApprove(user, id, body);
  }

  @Post('sales-orders/:id/print-log')
  printLog(@Param('id') id: string) {
    return this.orderService.incrementPrintCount(id);
  }

  @Get('return-orders')
  listReturns(@CurrentUser() user: AuthUser) {
    return this.orderService.listReturnOrders(user);
  }

  @Post('return-orders')
  createReturn(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      warehouseId: string;
      clinicId?: string;
      originalSalesNo?: string;
      remark?: string;
      codeInputs: string[];
      unitPriceOverride?: number;
    },
  ) {
    return this.orderService.createReturnOrder(user, body);
  }
}

@Module({
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
