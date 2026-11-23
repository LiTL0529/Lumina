import { existsSync } from 'fs';
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../src/common/prisma.module';
import { RedisService } from '../src/common/redis.module';
import { EventsGateway } from '../src/common/events.module';
import { TraceService } from '../src/modules/trace/trace.module';
import { ClinicService } from '../src/modules/clinic/clinic.module';
import { OrderService } from '../src/modules/order/order.module';
import { StockService } from '../src/modules/stock/stock.module';
import { RebateService } from '../src/modules/rebate/rebate.module';
import { AuthUser } from '../src/common/auth.decorators';
import {
  ClinicBindStatus,
  OrderScene,
  TraceCodeStatus,
} from '@lumina/shared-types';

describe('Lumina Supply-Chain End-to-End Business Lifecycle (Real PostgreSQL + Redis)', () => {
  const prisma = new PrismaService();
  const redis = new RedisService();
  const events = new EventsGateway();
  const traceService = new TraceService(prisma, events);
  const clinicService = new ClinicService(prisma, redis);
  const orderService = new OrderService(prisma, events);
  const stockService = new StockService(prisma, events);
  const rebateService = new RebateService(prisma);

  let hqUser: AuthUser;
  let dealerNcUser: AuthUser;
  let dealerCsUser: AuthUser;
  let hqWarehouseId: string;
  let ncWarehouseId: string;
  let csWarehouseId: string;
  let productId: string;
  let dealerNcOrgId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const hq = await prisma.organization.findUniqueOrThrow({ where: { code: 'HQ-LUMINA' } });
    const dNc = await prisma.organization.findUniqueOrThrow({ where: { code: 'DL-NC01' } });
    const dCs = await prisma.organization.findUniqueOrThrow({ where: { code: 'DL-CS01' } });
    dealerNcOrgId = dNc.id;

    const uAdmin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    const uNc = await prisma.user.findUniqueOrThrow({ where: { username: 'dealer_nc' } });
    const uCs = await prisma.user.findUniqueOrThrow({ where: { username: 'dealer_cs' } });

    hqUser = {
      userId: uAdmin.id,
      username: uAdmin.username,
      realName: uAdmin.realName,
      orgId: hq.id,
      orgType: 'HQ',
      orgName: hq.name,
      roleCode: uAdmin.roleCode,
    };
    dealerNcUser = {
      userId: uNc.id,
      username: uNc.username,
      realName: uNc.realName,
      orgId: dNc.id,
      orgType: 'DEALER',
      orgName: dNc.name,
      roleCode: uNc.roleCode,
    };
    dealerCsUser = {
      userId: uCs.id,
      username: uCs.username,
      realName: uCs.realName,
      orgId: dCs.id,
      orgType: 'DEALER',
      orgName: dCs.name,
      roleCode: uCs.roleCode,
    };

    hqWarehouseId = (await prisma.warehouse.findUniqueOrThrow({ where: { code: 'WH-HQ-01' } })).id;
    ncWarehouseId = (await prisma.warehouse.findUniqueOrThrow({ where: { code: 'WH-NC-01' } })).id;
    csWarehouseId = (await prisma.warehouse.findUniqueOrThrow({ where: { code: 'WH-CS-01' } })).id;
    productId = (await prisma.product.findUniqueOrThrow({ where: { skuCode: 'LM-011' } })).id;
  });

  afterAll(async () => {
    await redis.onModuleDestroy();
    await prisma.$disconnect();
  });

  it('executes full Factory -> HQ -> Dealer -> Clinic -> Consumer Verify -> Cross-Region Alert -> Return cycle', async () => {
    // 1. Factory Batch Generation (1 carton = 6 units)
    const batchRes = await traceService.createBatch(hqUser, {
      productId,
      unitCount: 6,
      cartonQty: 6,
      enableCarton: true,
      remark: 'E2E automated test batch',
    });
    expect(batchRes.cartonCount).toBe(1);
    expect(batchRes.sampleCartonToken).toBeTruthy();
    const cartonToken = batchRes.sampleCartonToken!;

    const batchDetail = await traceService.getBatchCodes(batchRes.batch.id);
    const unitTokens = batchDetail.codes
      .filter((c) => c.codeLevel === 'UNIT')
      .map((c) => c.codeToken);
    expect(unitTokens).toHaveLength(6);

    // 2. HQ scans single CARTON code inbound -> expands to 6 units
    const hqIn = await stockService.executeScanInbound(hqUser, {
      mode: 'HQ_INBOUND',
      warehouseId: hqWarehouseId,
      codeInputs: [cartonToken],
    });
    expect(hqIn.inboundUnitsCount).toBe(6);

    // 3. 3.5折 Supply Redline blocks a 3.0折 order
    await expect(
      orderService.createSalesOrder(hqUser, {
        orderScene: OrderScene.HQ_TO_DEALER,
        buyerOrgId: dealerNcOrgId,
        warehouseId: hqWarehouseId,
        items: [{ productId, qty: 6, unitPrice: 658, discountPercent: 30 }],
      }),
    ).rejects.toThrow();

    // 4. Compliant 4.0折 HQ -> Dealer order + carton outbound
    const hqOrder = await orderService.createSalesOrder(hqUser, {
      orderScene: OrderScene.HQ_TO_DEALER,
      buyerOrgId: dealerNcOrgId,
      warehouseId: hqWarehouseId,
      items: [{ productId, qty: 6, unitPrice: 658, discountPercent: 40 }],
    });
    expect(hqOrder.redline.passed).toBe(true);

    const hqOut = await stockService.executeScanOutbound(hqUser, {
      salesOrderId: hqOrder.order.id,
      codeInputs: [cartonToken],
    });
    expect(hqOut.outboundUnitsCount).toBe(6);

    // 5. Dealer scans carton receipt inbound
    const dIn = await stockService.executeScanInbound(dealerNcUser, {
      mode: 'DEALER_INBOUND',
      warehouseId: ncWarehouseId,
      codeInputs: [cartonToken],
    });
    expect(dIn.inboundUnitsCount).toBe(6);

    // 6. Unauthorized scan by competing dealer CS is blocked & logged as CRITICAL alert
    const badScan = await stockService.validateScan(dealerCsUser, {
      rawInput: unitTokens[0],
      mode: 'DEALER_OUTBOUND',
      warehouseId: csWarehouseId,
    });
    expect(badScan.ok).toBe(false);
    expect(badScan.errorCode).toBe('UNAUTHORIZED_SCAN');

    // 7. Clinic first-come-first-served reporting (concurrent race -> only 1 wins)
    const uniqueClinicName = `南昌测试颜肌美学_${Date.now()}`;
    const reportResults = await Promise.allSettled([
      clinicService.reportClinic(dealerNcUser, {
        name: uniqueClinicName,
        city: '南昌市',
        cityCode: '360100',
        contactPhone: '13900008899',
      }),
      clinicService.reportClinic(dealerCsUser, {
        name: uniqueClinicName,
        city: '南昌市',
        cityCode: '360100',
        contactPhone: '13900008899',
      }),
    ]);
    const fulfilled = reportResults.filter((r) => r.status === 'fulfilled');
    const rejected = reportResults.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const wonClinic = (fulfilled[0] as PromiseFulfilledResult<{ clinic: { id: string; ownerOrgId: string | null } }>).value.clinic;
    // Ensure dealerNc owns a test clinic for outbound auto-upgrade verification
    let targetClinicId = wonClinic.id;
    if (wonClinic.ownerOrgId !== dealerNcOrgId) {
      const ownClinic = await clinicService.reportClinic(dealerNcUser, {
        name: `南昌专属测试机构_${Date.now()}`,
        city: '南昌市',
        cityCode: '360100',
      });
      targetClinicId = ownClinic.clinic.id;
    }

    // 8. Dealer splits carton and ships 2 individual units to clinic -> auto-unpacks carton + upgrades clinic to BOUND_ACTIVE
    const dealerOrder = await orderService.createSalesOrder(dealerNcUser, {
      orderScene: OrderScene.DEALER_TO_CLINIC,
      clinicId: targetClinicId,
      warehouseId: ncWarehouseId,
      items: [{ productId, qty: 2, unitPrice: 658, discountPercent: 55 }],
    });
    const dOut = await stockService.executeScanOutbound(dealerNcUser, {
      salesOrderId: dealerOrder.order.id,
      codeInputs: [unitTokens[0], unitTokens[1]],
    });
    expect(dOut.outboundUnitsCount).toBe(2);
    expect(dOut.autoUnpackedCartonsCount).toBe(1);

    // Verify parent carton is now UNPACKED and rejected for whole-carton scans
    const unpackedCheck = await stockService.validateScan(dealerNcUser, {
      rawInput: cartonToken,
      mode: 'DEALER_OUTBOUND',
      warehouseId: ncWarehouseId,
    });
    expect(unpackedCheck.ok).toBe(false);
    expect(unpackedCheck.errorCode).toBe('CARTON_UNPACKED');

    // Verify clinic upgraded from PROTECTED_90D -> BOUND_ACTIVE
    const refreshedClinic = await prisma.clinic.findUniqueOrThrow({ where: { id: targetClinicId } });
    expect(refreshedClinic.bindStatus).toBe(ClinicBindStatus.BOUND_ACTIVE);

    // 9. Public Consumer Verify in unauthorized city ("北京市") -> authentic + CROSS_REGION alert
    const verifyRes = await traceService.publicVerify(unitTokens[0], {
      ip: '114.114.114.114',
      city: '北京市',
    });
    expect(verifyRes.authentic).toBe(true);
    expect(verifyRes.verifySeq).toBe(1);

    const crossAlert = await prisma.antiFleeingAlert.findFirst({
      where: { traceCodeToken: unitTokens[0], alertType: 'CROSS_REGION' },
    });
    expect(crossAlert).toBeTruthy();

    // 10. Return unitTokens[1] back to dealer warehouse -> restores status to IN_DEALER_STOCK
    const ret = await orderService.createReturnOrder(dealerNcUser, {
      warehouseId: ncWarehouseId,
      clinicId: targetClinicId,
      originalSalesNo: dealerOrder.order.docNo,
      codeInputs: [unitTokens[1]],
    });
    expect(ret.items[0].qty).toBe(1);

    const returnedCode = await prisma.traceCode.findUniqueOrThrow({
      where: { codeToken: unitTokens[1] },
    });
    expect(returnedCode.status).toBe(TraceCodeStatus.IN_DEALER_STOCK);
    expect(returnedCode.targetClinicId).toBeNull();

    // 11. KPI Rebate calculation runs cleanly
    const periodMonth = new Date().toISOString().slice(0, 7);
    const rebates = await rebateService.calculateRebates(hqUser, periodMonth);
    expect(rebates.length).toBeGreaterThan(0);
  });
});
