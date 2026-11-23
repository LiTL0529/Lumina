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
  ClinicBindStatus,
  OrderScene,
  ReconciliationStatus,
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
  return `${prefix}${ymd}${Math.floor(1000 + Math.random() * 9000)}`;
}

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  async listBalances(user: AuthUser, warehouseId?: string, keyword?: string) {
    const allowedWhs = await this.prisma.warehouse.findMany({
      where: user.orgType === 'HQ' ? {} : { orgId: user.orgId },
      select: { id: true },
    });
    const whIds = allowedWhs.map((w) => w.id);
    const targetWhIds = warehouseId && whIds.includes(warehouseId) ? [warehouseId] : whIds;

    const balances = await this.prisma.stockBalance.findMany({
      where: {
        warehouseId: { in: targetWhIds },
        ...(keyword
          ? {
              product: {
                OR: [
                  { name: { contains: keyword, mode: 'insensitive' } },
                  { skuCode: { contains: keyword, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      include: {
        warehouse: { include: { org: { select: { id: true, name: true, type: true } } } },
        product: { include: { brand: true, category: true } },
      },
      orderBy: [{ warehouseId: 'asc' }, { qty: 'desc' }],
    });

    return balances;
  }

  async getWarehouseProductCodes(warehouseId: string, productId: string) {
    return this.prisma.traceCode.findMany({
      where: {
        currentWarehouseId: warehouseId,
        productId,
        status: { in: [TraceCodeStatus.IN_HQ_STOCK, TraceCodeStatus.IN_DEALER_STOCK] },
      },
      include: {
        batch: { select: { batchNo: true, expDate: true } },
        parent: { select: { codeToken: true } },
      },
      orderBy: [{ codeLevel: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
  }

  async listLedgers(user: AuthUser, warehouseId?: string) {
    const allowedWhs = await this.prisma.warehouse.findMany({
      where: user.orgType === 'HQ' ? {} : { orgId: user.orgId },
      select: { id: true },
    });
    const whIds = allowedWhs.map((w) => w.id);
    const targetWhIds = warehouseId && whIds.includes(warehouseId) ? [warehouseId] : whIds;

    return this.prisma.stockLedger.findMany({
      where: { warehouseId: { in: targetWhIds } },
      include: {
        warehouse: { select: { id: true, name: true } },
        product: { select: { id: true, skuCode: true, name: true, spec: true, unitName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 150,
    });
  }

  /**
   * Real-time scan validation before final submission so warehouse scanners
   * get instant audio/visual feedback on carton expansion, wrong status, or cross-dealer fleeing.
   */
  async validateScan(
    user: AuthUser,
    body: {
      rawInput: string;
      mode: 'HQ_INBOUND' | 'DEALER_INBOUND' | 'HQ_OUTBOUND' | 'DEALER_OUTBOUND';
      warehouseId: string;
    },
  ) {
    const token = extractTokenFromScanInput(body.rawInput);
    if (!token) {
      return { ok: false, errorCode: 'INVALID_FORMAT', message: '无法识别的条码/二维码格式' };
    }

    const code = await this.prisma.traceCode.findUnique({
      where: { codeToken: token },
      include: {
        product: { include: { brand: true } },
        batch: true,
        children: true,
      },
    });
    if (!code) {
      return { ok: false, errorCode: 'NOT_FOUND', message: `防伪码 ${token} 不存在于系统，谨防假码` };
    }

    if (code.codeLevel === TraceCodeLevel.CARTON && code.status === TraceCodeStatus.UNPACKED) {
      return {
        ok: false,
        errorCode: 'CARTON_UNPACKED',
        message: `外箱码 ${token} 已拆零，禁止整箱扫描，请逐盒扫单品码`,
      };
    }

    const unitCount =
      code.codeLevel === TraceCodeLevel.CARTON ? code.children.length : 1;

    if (body.mode === 'HQ_INBOUND') {
      if (code.status !== TraceCodeStatus.GENERATED) {
        return {
          ok: false,
          errorCode: 'WRONG_STATUS',
          message: `码 ${token} 当前状态为 ${code.status}，非待入总仓状态`,
        };
      }
    } else if (body.mode === 'DEALER_INBOUND') {
      if (code.status !== TraceCodeStatus.IN_TRANSIT_TO_DEALER) {
        return {
          ok: false,
          errorCode: 'WRONG_STATUS',
          message: `码 ${token} 非发往服务商在途状态（当前：${code.status}）`,
        };
      }
      if (user.orgType !== 'HQ' && code.assignedDealerId !== user.orgId) {
        return {
          ok: false,
          errorCode: 'WRONG_OWNER',
          message: `越权告警：码 ${token} 并非发往本服务商的货物！`,
        };
      }
    } else if (body.mode === 'HQ_OUTBOUND') {
      if (code.status !== TraceCodeStatus.IN_HQ_STOCK || code.currentWarehouseId !== body.warehouseId) {
        return {
          ok: false,
          errorCode: 'NOT_IN_WAREHOUSE',
          message: `码 ${token} 不在当前总仓库存中（当前状态：${code.status}）`,
        };
      }
    } else if (body.mode === 'DEALER_OUTBOUND') {
      if (user.orgType !== 'HQ' && code.assignedDealerId && code.assignedDealerId !== user.orgId) {
        // Trigger immediate anti-fleeing alert!
        const alert = await this.prisma.antiFleeingAlert.create({
          data: {
            alertType: AlertType.UNAUTHORIZED_SCAN,
            severity: AlertSeverity.CRITICAL,
            orgId: user.orgId,
            traceCodeToken: token,
            title: `越权扫码拦截：服务商【${user.orgName}】扫描了他渠归属码`,
            detail: `单品/箱码 ${token}（${code.product.name}）归属于其他服务商，但被【${user.orgName}】尝试扫码出库，系统已强拦截！`,
            evidenceSnapshot: {
              attemptedByOrgId: user.orgId,
              actualOwnerDealerId: code.assignedDealerId,
              token,
            },
          },
        });
        this.events.notifyAlert({
          id: alert.id,
          alertType: alert.alertType,
          title: alert.title,
          severity: alert.severity,
        });
        return {
          ok: false,
          errorCode: 'UNAUTHORIZED_SCAN',
          message: `严重告警：码 ${token} 归属于其他服务商，疑似窜货已拦截并上报总部！`,
        };
      }
      if (code.status !== TraceCodeStatus.IN_DEALER_STOCK || code.currentWarehouseId !== body.warehouseId) {
        return {
          ok: false,
          errorCode: 'NOT_IN_WAREHOUSE',
          message: `码 ${token} 不在当前服务商仓在库状态（当前：${code.status}）`,
        };
      }
    }

    return {
      ok: true,
      token: code.codeToken,
      codeLevel: code.codeLevel,
      unitCount,
      productId: code.productId,
      skuCode: code.product.skuCode,
      productName: code.product.name,
      spec: code.product.spec,
      batchNo: code.batch.batchNo,
    };
  }

  /**
   * Expands scanned carton/unit inputs into exact deduplicated unit records + touched cartons.
   */
  private async expandScannedCodes(rawInputs: string[]) {
    const tokens = Array.from(
      new Set(
        (rawInputs || [])
          .map((r) => extractTokenFromScanInput(r))
          .filter((x): x is string => Boolean(x)),
      ),
    );
    if (tokens.length === 0) {
      throw new BadRequestException('请至少扫描 1 个有效的防伪箱码或盒码');
    }

    const found = await this.prisma.traceCode.findMany({
      where: { codeToken: { in: tokens } },
      include: { children: true, product: true },
    });
    if (found.length !== tokens.length) {
      const foundSet = new Set(found.map((f) => f.codeToken));
      const missing = tokens.filter((t) => !foundSet.has(t));
      throw new BadRequestException(`以下防伪码不存在于系统：${missing.join(', ')}`);
    }

    const cartons: typeof found = [];
    const unitMap = new Map<string, (typeof found)[number]>();
    const partialUnpackCartonIds = new Set<string>();

    for (const c of found) {
      if (c.codeLevel === TraceCodeLevel.CARTON) {
        if (c.status === TraceCodeStatus.UNPACKED) {
          throw new BadRequestException(`外箱码 ${c.codeToken} 已拆箱，请逐盒扫描单品码`);
        }
        cartons.push(c);
        const childRecords = await this.prisma.traceCode.findMany({
          where: { parentId: c.id },
          include: { children: true, product: true },
        });
        for (const child of childRecords) {
          unitMap.set(child.id, child);
        }
      } else {
        unitMap.set(c.id, c);
        if (c.parentId) {
          partialUnpackCartonIds.add(c.parentId);
        }
      }
    }

    // Remove carton IDs that were scanned whole from partialUnpackCartonIds
    const wholeCartonIds = new Set(cartons.map((c) => c.id));
    for (const cid of wholeCartonIds) {
      partialUnpackCartonIds.delete(cid);
    }

    return {
      cartons,
      units: Array.from(unitMap.values()),
      partialUnpackCartonIds: Array.from(partialUnpackCartonIds),
    };
  }

  /**
   * Executes atomic scanned INBOUND (HQ purchase inbound OR Dealer receipt confirmation).
   */
  async executeScanInbound(
    user: AuthUser,
    body: {
      mode: 'HQ_INBOUND' | 'DEALER_INBOUND';
      warehouseId: string;
      purchaseOrderId?: string;
      refDocNo?: string;
      codeInputs: string[];
      remark?: string;
    },
  ) {
    const wh = await this.prisma.warehouse.findUnique({
      where: { id: body.warehouseId },
      include: { org: true },
    });
    if (!wh) throw new NotFoundException('目标仓库不存在');
    if (user.orgType !== 'HQ' && wh.orgId !== user.orgId) {
      throw new ForbiddenException('无权操作其他主体的仓库');
    }

    const { cartons, units } = await this.expandScannedCodes(body.codeInputs);
    const expectedStatus =
      body.mode === 'HQ_INBOUND' ? TraceCodeStatus.GENERATED : TraceCodeStatus.IN_TRANSIT_TO_DEALER;
    const nextStatus =
      body.mode === 'HQ_INBOUND' ? TraceCodeStatus.IN_HQ_STOCK : TraceCodeStatus.IN_DEALER_STOCK;
    const eventType =
      body.mode === 'HQ_INBOUND' ? TraceEventType.HQ_INBOUND : TraceEventType.DEALER_INBOUND;

    for (const u of units) {
      if (u.status !== expectedStatus) {
        throw new BadRequestException(
          `单品码 ${u.codeToken} 状态不符（期望 ${expectedStatus}，实际 ${u.status}）`,
        );
      }
      if (body.mode === 'DEALER_INBOUND' && u.assignedDealerId !== wh.orgId) {
        throw new ForbiddenException(`单品码 ${u.codeToken} 非发往本服务商的在途货品`);
      }
    }

    const docNo = makeDocNo('RK');

    return this.prisma.$transaction(async (tx) => {
      // Update cartons
      for (const c of cartons) {
        await tx.traceCode.update({
          where: { id: c.id },
          data: {
            status: nextStatus,
            currentOrgId: wh.orgId,
            currentWarehouseId: wh.id,
          },
        });
      }

      // Group units by product
      const byProd = new Map<string, typeof units>();
      for (const u of units) {
        const arr = byProd.get(u.productId) || [];
        arr.push(u);
        byProd.set(u.productId, arr);

        await tx.traceCode.update({
          where: { id: u.id },
          data: {
            status: nextStatus,
            currentOrgId: wh.orgId,
            currentWarehouseId: wh.id,
          },
        });
        await tx.traceEvent.create({
          data: {
            traceCodeId: u.id,
            eventType,
            toOrgId: wh.orgId,
            warehouseId: wh.id,
            docType: body.mode,
            docNo,
            operatorId: user.userId,
            remark:
              body.mode === 'HQ_INBOUND'
                ? `品牌总仓【${wh.name}】扫码入库`
                : `服务商仓【${wh.name}】确认扫码收货入库`,
          },
        });
      }

      const docItems: Array<{ productId: string; qty: number; codeTokens: string[] }> = [];
      for (const [productId, pUnits] of byProd.entries()) {
        docItems.push({
          productId,
          qty: pUnits.length,
          codeTokens: pUnits.map((x) => x.codeToken),
        });
        const bal = await tx.stockBalance.upsert({
          where: { warehouseId_productId: { warehouseId: wh.id, productId } },
          update: { qty: { increment: pUnits.length }, version: { increment: 1 } },
          create: { warehouseId: wh.id, productId, qty: pUnits.length },
        });
        await tx.stockLedger.create({
          data: {
            warehouseId: wh.id,
            productId,
            beforeQty: bal.qty - pUnits.length,
            deltaQty: pUnits.length,
            afterQty: bal.qty,
            docType: body.mode,
            docNo,
            operatorId: user.userId,
          },
        });
      }

      if (body.purchaseOrderId) {
        const po = await tx.purchaseOrder.findUnique({
          where: { id: body.purchaseOrderId },
          include: { items: true },
        });
        if (po) {
          let allCompleted = true;
          for (const item of po.items) {
            const added = byProd.get(item.productId)?.length || 0;
            const newIn = item.inboundQty + added;
            if (added > 0) {
              await tx.purchaseOrderItem.update({
                where: { id: item.id },
                data: { inboundQty: newIn },
              });
            }
            if (newIn < item.qty) allCompleted = false;
          }
          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: { status: allCompleted ? 'COMPLETED' : 'PARTIAL_INBOUND' },
          });
        }
      }

      const stockDoc = await tx.stockDoc.create({
        data: {
          docNo,
          docType: body.mode,
          warehouseId: wh.id,
          refDocNo: body.refDocNo || null,
          operatorId: user.userId,
          remark: body.remark || null,
          items: { create: docItems },
        },
        include: { items: true, warehouse: true },
      });

      return {
        stockDoc,
        inboundUnitsCount: units.length,
        inboundCartonsCount: cartons.length,
      };
    });
  }

  /**
   * Executes atomic scanned OUTBOUND linked to a SalesOrder:
   * - HQ_TO_DEALER -> marks units IN_TRANSIT_TO_DEALER & sets assignedDealerId
   * - DEALER_TO_CLINIC -> marks units SOLD_TO_CLINIC, auto-unpacks parent cartons if split,
   *   and automatically upgrades PROTECTED_90D clinic to BOUND_ACTIVE + refreshes lastOrderAt!
   */
  async executeScanOutbound(
    user: AuthUser,
    body: {
      salesOrderId: string;
      codeInputs: string[];
      trackingNo?: string;
      remark?: string;
    },
  ) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: body.salesOrderId },
      include: {
        items: { include: { product: true } },
        warehouse: true,
        buyerOrg: true,
        clinic: true,
      },
    });
    if (!order) throw new NotFoundException('销售/供货订单不存在');
    if (order.status === SalesOrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException('该订单低于 3.5 折红线，尚未通过总部特批，禁止扫码出库！');
    }
    if (order.status === SalesOrderStatus.COMPLETED || order.status === SalesOrderStatus.CANCELLED) {
      throw new BadRequestException('该订单已完成或已撤销，无需出库');
    }
    if (user.orgType !== 'HQ' && order.sellerOrgId !== user.orgId) {
      throw new ForbiddenException('无权操作其他主体的出库单');
    }

    const { cartons, units, partialUnpackCartonIds } = await this.expandScannedCodes(body.codeInputs);
    const isHqToDealer = order.orderScene === OrderScene.HQ_TO_DEALER;
    const expectedStatus = isHqToDealer
      ? TraceCodeStatus.IN_HQ_STOCK
      : TraceCodeStatus.IN_DEALER_STOCK;
    const nextStatus = isHqToDealer
      ? TraceCodeStatus.IN_TRANSIT_TO_DEALER
      : TraceCodeStatus.SOLD_TO_CLINIC;
    const eventType = isHqToDealer ? TraceEventType.HQ_OUTBOUND : TraceEventType.DEALER_OUTBOUND;

    // Validate all units belong to order warehouse & ordered SKUs
    const orderedRemaining = new Map<string, number>();
    for (const item of order.items) {
      orderedRemaining.set(item.productId, (orderedRemaining.get(item.productId) || 0) + (item.qty - item.outboundQty));
    }

    const scannedByProd = new Map<string, typeof units>();
    for (const u of units) {
      if (!isHqToDealer && u.assignedDealerId && u.assignedDealerId !== order.sellerOrgId) {
        const alert = await this.prisma.antiFleeingAlert.create({
          data: {
            alertType: AlertType.UNAUTHORIZED_SCAN,
            severity: AlertSeverity.CRITICAL,
            orgId: order.sellerOrgId,
            traceCodeToken: u.codeToken,
            docNo: order.docNo,
            title: `越权出库拦截（单号 ${order.docNo}）`,
            detail: `尝试扫描归属其他服务商的单品码 ${u.codeToken} 出库，已被系统强制拦截！`,
          },
        });
        this.events.notifyAlert({
          id: alert.id,
          alertType: alert.alertType,
          title: alert.title,
          severity: alert.severity,
        });
        throw new ForbiddenException(`越权拦截：单品码 ${u.codeToken} 归属其他服务商，已记录风控告警！`);
      }
      if (u.status !== expectedStatus || u.currentWarehouseId !== order.warehouseId) {
        throw new BadRequestException(
          `单品码 ${u.codeToken} 不在出库仓【${order.warehouse.name}】在库状态（实际：${u.status}）`,
        );
      }
      if (!orderedRemaining.has(u.productId)) {
        throw new BadRequestException(`单品码 ${u.codeToken} 所属商品【${u.product.name}】不在本订单明细中`);
      }
      const arr = scannedByProd.get(u.productId) || [];
      arr.push(u);
      scannedByProd.set(u.productId, arr);
    }

    for (const [productId, pUnits] of scannedByProd.entries()) {
      const rem = orderedRemaining.get(productId) || 0;
      if (pUnits.length > rem) {
        throw new BadRequestException(
          `商品【${pUnits[0].product.name}】本次扫码 ${pUnits.length} 盒，超过订单剩余待出库数 ${rem} 盒`,
        );
      }
    }

    const docNo = makeDocNo('CK');
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // 1. Update whole cartons
      for (const c of cartons) {
        await tx.traceCode.update({
          where: { id: c.id },
          data: {
            status: nextStatus,
            currentOrgId: isHqToDealer ? order.buyerOrgId : null,
            currentWarehouseId: null,
            assignedDealerId: isHqToDealer ? order.buyerOrgId : c.assignedDealerId,
            targetClinicId: isHqToDealer ? null : order.clinicId,
          },
        });
      }

      // 2. Mark partially split parent cartons as UNPACKED automatically
      for (const cid of partialUnpackCartonIds) {
        const parentCarton = await tx.traceCode.findUnique({ where: { id: cid } });
        if (parentCarton && parentCarton.status !== TraceCodeStatus.UNPACKED) {
          await tx.traceCode.update({
            where: { id: cid },
            data: { status: TraceCodeStatus.UNPACKED },
          });
          await tx.traceEvent.create({
            data: {
              traceCodeId: cid,
              eventType: TraceEventType.CARTON_UNPACKED,
              warehouseId: order.warehouseId,
              docNo,
              operatorId: user.userId,
              remark: '因单盒拆零扫码出库，系统自动将外箱置为已拆箱状态',
              occurredAt: now,
            },
          });
        }
      }

      // 3. Update every unit code & append trace event
      for (const u of units) {
        await tx.traceCode.update({
          where: { id: u.id },
          data: {
            status: nextStatus,
            currentOrgId: isHqToDealer ? order.buyerOrgId : null,
            currentWarehouseId: null,
            assignedDealerId: isHqToDealer ? order.buyerOrgId : u.assignedDealerId,
            targetClinicId: isHqToDealer ? null : order.clinicId,
          },
        });
        await tx.traceEvent.create({
          data: {
            traceCodeId: u.id,
            eventType,
            fromOrgId: order.sellerOrgId,
            toOrgId: isHqToDealer ? order.buyerOrgId : null,
            clinicId: isHqToDealer ? null : order.clinicId,
            warehouseId: order.warehouseId,
            docType: 'SALES_OUTBOUND',
            docId: order.id,
            docNo: order.docNo,
            operatorId: user.userId,
            remark: isHqToDealer
              ? `总仓扫码发往服务商【${order.buyerOrg?.name}】`
              : `服务商扫码出库给机构【${order.clinic?.name}】`,
            occurredAt: now,
          },
        });
      }

      // 4. Deduct warehouse stock balances (no negative stock!) & write ledgers
      const stockDocItems: Array<{ productId: string; qty: number; codeTokens: string[] }> = [];
      for (const [productId, pUnits] of scannedByProd.entries()) {
        stockDocItems.push({
          productId,
          qty: pUnits.length,
          codeTokens: pUnits.map((x) => x.codeToken),
        });
        const bal = await tx.stockBalance.findUnique({
          where: { warehouseId_productId: { warehouseId: order.warehouseId, productId } },
        });
        if (!bal || bal.qty < pUnits.length) {
          throw new BadRequestException(
            `仓库库存不足（强溯源商品禁止负库存出库）：${pUnits[0].product.name}`,
          );
        }
        const updatedBal = await tx.stockBalance.update({
          where: { id: bal.id },
          data: { qty: { decrement: pUnits.length }, version: { increment: 1 } },
        });
        await tx.stockLedger.create({
          data: {
            warehouseId: order.warehouseId,
            productId,
            beforeQty: bal.qty,
            deltaQty: -pUnits.length,
            afterQty: updatedBal.qty,
            docType: eventType,
            docNo,
            operatorId: user.userId,
          },
        });
      }

      // 5. Update SalesOrder outbound progress
      let allCompleted = true;
      for (const item of order.items) {
        const shipped = scannedByProd.get(item.productId)?.length || 0;
        const newOut = item.outboundQty + shipped;
        if (shipped > 0) {
          await tx.salesOrderItem.update({
            where: { id: item.id },
            data: { outboundQty: newOut },
          });
        }
        if (newOut < item.qty) allCompleted = false;
      }

      const updatedOrder = await tx.salesOrder.update({
        where: { id: order.id },
        data: {
          status: allCompleted ? SalesOrderStatus.COMPLETED : SalesOrderStatus.PARTIAL_OUTBOUND,
          trackingNo: body.trackingNo || order.trackingNo,
        },
        include: { items: true },
      });

      // 6. Auto-upgrade PROTECTED_90D clinic -> BOUND_ACTIVE & refresh 270-day lastOrderAt clock!
      if (!isHqToDealer && order.clinicId) {
        const clinic = await tx.clinic.findUnique({ where: { id: order.clinicId } });
        if (clinic) {
          const wasProtected = clinic.bindStatus === ClinicBindStatus.PROTECTED_90D;
          await tx.clinic.update({
            where: { id: clinic.id },
            data: {
              bindStatus: ClinicBindStatus.BOUND_ACTIVE,
              ownerOrgId: order.sellerOrgId,
              lastOrderAt: now,
            },
          });
          if (wasProtected) {
            await tx.clinicProtectionLog.create({
              data: {
                clinicId: clinic.id,
                orgId: order.sellerOrgId,
                action: 'UPGRADE_BOUND',
                operatorId: user.userId,
                serverTimestamp: now,
                remark: `90天保护期内完成有效扫码出库（单号 ${order.docNo}），自动转正为正式绑定机构（270天复购周期启动）`,
              },
            });
          }
        }
      }

      const stockDoc = await tx.stockDoc.create({
        data: {
          docNo,
          docType: eventType,
          warehouseId: order.warehouseId,
          refDocNo: order.docNo,
          operatorId: user.userId,
          remark: body.remark || null,
          items: { create: stockDocItems },
        },
      });

      return {
        stockDoc,
        orderStatus: updatedOrder.status,
        outboundUnitsCount: units.length,
        autoUnpackedCartonsCount: partialUnpackCartonIds.length,
      };
    });
  }

  // ======================== Monthly Flow Reconciliation ========================

  async listReconciliations(user: AuthUser) {
    return this.prisma.monthlyReconciliation.findMany({
      where: user.orgType === 'HQ' ? {} : { orgId: user.orgId },
      include: {
        org: { select: { id: true, name: true, code: true, supplyFrozen: true } },
        items: true,
      },
      orderBy: [{ periodMonth: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async generateMonthlyReconciliations(user: AuthUser, periodMonth: string) {
    if (user.orgType !== 'HQ') {
      throw new ForbiddenException('仅品牌总部可发起月度流向核验单');
    }
    const dealers = await this.prisma.organization.findMany({
      where: { type: 'DEALER', status: 'ACTIVE' },
      include: { warehouses: true },
    });

    const createdList = [];
    for (const dealer of dealers) {
      const whIds = dealer.warehouses.map((w) => w.id);
      const balances = await this.prisma.stockBalance.findMany({
        where: { warehouseId: { in: whIds } },
        include: { product: true },
      });

      const itemsData = balances.map((b) => ({
        productId: b.productId,
        productName: b.product.name,
        skuCode: b.product.skuCode,
        openingQty: 0,
        inboundQty: b.qty,
        outboundQty: 0,
        theoreticalQty: b.qty,
        varianceQty: 0,
      }));
      const totalTheoretical = itemsData.reduce((s, i) => s + i.theoreticalQty, 0);

      const rec = await this.prisma.monthlyReconciliation.upsert({
        where: { periodMonth_orgId: { periodMonth, orgId: dealer.id } },
        update: {},
        create: {
          periodMonth,
          orgId: dealer.id,
          status: ReconciliationStatus.PENDING_SUBMIT,
          totalTheoretical,
          items: { create: itemsData },
        },
        include: { items: true, org: true },
      });
      createdList.push(rec);
    }
    return createdList;
  }

  async submitReconciliation(
    user: AuthUser,
    id: string,
    body: {
      dealerNote?: string;
      items: Array<{ itemId: string; actualQty: number; explanation?: string }>;
    },
  ) {
    const rec = await this.prisma.monthlyReconciliation.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!rec) throw new NotFoundException('核验单不存在');
    if (user.orgType !== 'HQ' && rec.orgId !== user.orgId) {
      throw new ForbiddenException('无权提报其他服务商的月度核验');
    }

    const inputMap = new Map(body.items.map((i) => [i.itemId, i]));
    let totalActual = 0;
    let totalVariance = 0;
    let hasVariance = false;

    await this.prisma.$transaction(async (tx) => {
      for (const it of rec.items) {
        const sub = inputMap.get(it.id);
        const actual = sub ? Number(sub.actualQty) : it.theoreticalQty;
        const variance = actual - it.theoreticalQty;
        totalActual += actual;
        totalVariance += variance;
        if (variance !== 0) hasVariance = true;

        await tx.monthlyReconciliationItem.update({
          where: { id: it.id },
          data: {
            actualQty: actual,
            varianceQty: variance,
            explanation: sub?.explanation || null,
          },
        });
      }

      await tx.monthlyReconciliation.update({
        where: { id: rec.id },
        data: {
          status: hasVariance
            ? ReconciliationStatus.VARIANCE_FLAGGED
            : ReconciliationStatus.MATCHED,
          totalActual,
          totalVariance,
          dealerNote: body.dealerNote || null,
          submittedAt: new Date(),
        },
      });
    });

    if (hasVariance) {
      const alert = await this.prisma.antiFleeingAlert.create({
        data: {
          alertType: AlertType.RECONCILIATION_VARIANCE,
          severity: AlertSeverity.HIGH,
          orgId: rec.orgId,
          title: `${rec.periodMonth} 月度库存核验存在账实差异（差额 ${totalVariance} 盒）`,
          detail: `服务商月度盘点实盘总数 ${totalActual} 盒与系统理论库存 ${rec.totalTheoretical} 盒不符，请流向管控负责人复核并决定是否要求复盘或暂停供货。`,
        },
      });
      this.events.notifyAlert({
        id: alert.id,
        alertType: alert.alertType,
        title: alert.title,
        severity: alert.severity,
      });
    }

    return this.prisma.monthlyReconciliation.findUnique({
      where: { id },
      include: { items: true, org: true },
    });
  }

  async auditReconciliation(
    user: AuthUser,
    id: string,
    body: { action: 'PASS' | 'RECOUNT' | 'PRICE_ADJUST' | 'FREEZE_SUPPLY'; note?: string },
  ) {
    if (user.orgType !== 'HQ') {
      throw new ForbiddenException('仅品牌流向管控负责人可审核月度核验单');
    }
    const rec = await this.prisma.monthlyReconciliation.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('核验单不存在');

    return this.prisma.$transaction(async (tx) => {
      if (body.action === 'FREEZE_SUPPLY') {
        await tx.organization.update({
          where: { id: rec.orgId },
          data: {
            supplyFrozen: true,
            freezeReason: body.note || `${rec.periodMonth} 月度流向库存核验异常未获合理解释，暂停供货`,
          },
        });
      }
      return tx.monthlyReconciliation.update({
        where: { id },
        data: {
          status:
            body.action === 'RECOUNT'
              ? ReconciliationStatus.PENDING_SUBMIT
              : ReconciliationStatus.RESOLVED,
          hqAuditAction: body.action,
          hqAuditNote: body.note || null,
          auditedAt: new Date(),
        },
        include: { org: true, items: true },
      });
    });
  }
}

@Controller()
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get('stock/balances')
  balances(
    @CurrentUser() user: AuthUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.stockService.listBalances(user, warehouseId, keyword);
  }

  @Get('stock/balances/:warehouseId/:productId/codes')
  balanceCodes(@Param('warehouseId') warehouseId: string, @Param('productId') productId: string) {
    return this.stockService.getWarehouseProductCodes(warehouseId, productId);
  }

  @Get('stock/ledgers')
  ledgers(@CurrentUser() user: AuthUser, @Query('warehouseId') warehouseId?: string) {
    return this.stockService.listLedgers(user, warehouseId);
  }

  @Post('stock/scan-validate')
  scanValidate(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      rawInput: string;
      mode: 'HQ_INBOUND' | 'DEALER_INBOUND' | 'HQ_OUTBOUND' | 'DEALER_OUTBOUND';
      warehouseId: string;
    },
  ) {
    return this.stockService.validateScan(user, body);
  }

  @Post('stock/inbound')
  inbound(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      mode: 'HQ_INBOUND' | 'DEALER_INBOUND';
      warehouseId: string;
      purchaseOrderId?: string;
      refDocNo?: string;
      codeInputs: string[];
      remark?: string;
    },
  ) {
    return this.stockService.executeScanInbound(user, body);
  }

  @Post('stock/outbound')
  outbound(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      salesOrderId: string;
      codeInputs: string[];
      trackingNo?: string;
      remark?: string;
    },
  ) {
    return this.stockService.executeScanOutbound(user, body);
  }

  @Get('reconciliations')
  listReconciliations(@CurrentUser() user: AuthUser) {
    return this.stockService.listReconciliations(user);
  }

  @Post('reconciliations/generate')
  generateReconciliations(@CurrentUser() user: AuthUser, @Body() body: { periodMonth: string }) {
    return this.stockService.generateMonthlyReconciliations(user, body.periodMonth);
  }

  @Post('reconciliations/:id/submit')
  submitReconciliation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      dealerNote?: string;
      items: Array<{ itemId: string; actualQty: number; explanation?: string }>;
    },
  ) {
    return this.stockService.submitReconciliation(user, id, body);
  }

  @Post('reconciliations/:id/audit')
  auditReconciliation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { action: 'PASS' | 'RECOUNT' | 'PRICE_ADJUST' | 'FREEZE_SUPPLY'; note?: string },
  ) {
    return this.stockService.auditReconciliation(user, id, body);
  }
}

@Module({
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
