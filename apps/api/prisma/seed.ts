import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  buildClinicFingerprint,
  ClinicBindStatus,
  OrderScene,
  OrgType,
  PrintPaperType,
  RedlineStatus,
  RoleCode,
  SalesOrderStatus,
  TraceCodeLevel,
  TraceCodeStatus,
  TraceEventType,
} from '@lumina/shared-types';
import { generateBatchCodeSet } from '@lumina/trace-crypto';
import {
  buildHiprintTemplate,
  ORDER_SYSTEM_VARS,
  ORDER_TABLE_COLUMNS,
} from '@lumina/print-templates';

const prisma = new PrismaClient();
const TRACE_SECRET =
  process.env.TRACE_HMAC_SECRET || 'lumina_trace_hmac_secret_key_change_in_prod_2026';
const VERIFY_BASE_URL = process.env.VERIFY_BASE_URL || 'http://localhost:5174/v';

async function main() {
  console.log('🌱 Seeding Lumina Supply-Chain Traceability & ERP database...');

  // 1. System Rules
  await prisma.systemRuleConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      clinicProtectDays: 90,
      clinicUnbindDays: 270,
      unbindWarnDaysBefore: 30,
      defaultMinSupplyRatio: 0.35,
      defaultMinRetailRatio: 0.85,
      highFreqVerifyThreshold: 5,
      allowSpecialPriceApprove: true,
      verifyBaseUrl: VERIFY_BASE_URL,
    },
  });

  // 2. Organizations
  const hqOrg = await prisma.organization.upsert({
    where: { code: 'HQ-LUMINA' },
    update: {},
    create: {
      type: OrgType.HQ,
      name: 'Lumina 品牌总部（璞澜咨询）',
      code: 'HQ-LUMINA',
      province: '江西省',
      city: '南昌市',
      regionCodes: ['全国'],
      contactName: '于总',
      contactPhone: '13800000001',
    },
  });

  const dealerNc = await prisma.organization.upsert({
    where: { code: 'DL-NC01' },
    update: {},
    create: {
      type: OrgType.DEALER,
      name: '南昌赣中核心服务商',
      code: 'DL-NC01',
      province: '江西省',
      city: '南昌市',
      regionCodes: ['南昌市', '九江市', '宜春市', '抚州市', '上饶市', '新余市'],
      contactName: '张硕',
      contactPhone: '13907910001',
      priceTier: 'GOLD',
    },
  });

  const dealerCs = await prisma.organization.upsert({
    where: { code: 'DL-CS01' },
    update: {},
    create: {
      type: OrgType.DEALER,
      name: '湖南铂悦生物（长沙服务商）',
      code: 'DL-CS01',
      province: '湖南省',
      city: '长沙市',
      regionCodes: ['长沙市', '株洲市', '湘潭市'],
      contactName: '陈经理',
      contactPhone: '13907310002',
      priceTier: 'STANDARD',
    },
  });

  const dealerHz = await prisma.organization.upsert({
    where: { code: 'DL-HZ01' },
    update: {},
    create: {
      type: OrgType.DEALER,
      name: '杭州浙北合作服务商',
      code: 'DL-HZ01',
      province: '浙江省',
      city: '杭州市',
      regionCodes: ['杭州市', '嘉兴市', '绍兴市'],
      contactName: '林总',
      contactPhone: '13905710003',
      priceTier: 'STANDARD',
    },
  });

  // 3. Warehouses
  const hqWh = await prisma.warehouse.upsert({
    where: { code: 'WH-HQ-01' },
    update: {},
    create: {
      orgId: hqOrg.id,
      name: '璞澜品牌总仓',
      code: 'WH-HQ-01',
      address: '江西省南昌市红谷滩区供应链中心 A 栋',
      isDefault: true,
    },
  });

  const ncWh = await prisma.warehouse.upsert({
    where: { code: 'WH-NC-01' },
    update: {},
    create: {
      orgId: dealerNc.id,
      name: '南昌服务商独立仓',
      code: 'WH-NC-01',
      address: '江西省南昌市青山湖区物流园 3 号库',
      isDefault: true,
    },
  });

  const csWh = await prisma.warehouse.upsert({
    where: { code: 'WH-CS-01' },
    update: {},
    create: {
      orgId: dealerCs.id,
      name: '长沙铂悦独立仓',
      code: 'WH-CS-01',
      address: '湖南省长沙市岳麓区高新物流基地 8 号',
      isDefault: true,
    },
  });

  await prisma.warehouse.upsert({
    where: { code: 'WH-HZ-01' },
    update: {},
    create: {
      orgId: dealerHz.id,
      name: '杭州浙北独立仓',
      code: 'WH-HZ-01',
      address: '浙江省杭州市余杭区良渚云仓 2 期',
      isDefault: true,
    },
  });

  // 4. Demo Users (all password = 123456)
  const passwordHash = await bcrypt.hash('123456', 10);
  const demoUsers = [
    {
      username: 'admin',
      realName: '于总（品牌总控）',
      roleCode: RoleCode.HQ_ADMIN,
      orgId: hqOrg.id,
      phone: '13800000001',
    },
    {
      username: 'hq_warehouse',
      realName: '王仓管（总仓库管）',
      roleCode: RoleCode.HQ_WAREHOUSE,
      orgId: hqOrg.id,
      phone: '13800000002',
    },
    {
      username: 'dealer_nc',
      realName: '张硕（南昌服务商）',
      roleCode: RoleCode.DEALER_ADMIN,
      orgId: dealerNc.id,
      phone: '13907910001',
    },
    {
      username: 'dealer_cs',
      realName: '陈经理（长沙服务商）',
      roleCode: RoleCode.DEALER_ADMIN,
      orgId: dealerCs.id,
      phone: '13907310002',
    },
    {
      username: 'sales_nc',
      realName: '林顾问（南昌外勤销售）',
      roleCode: RoleCode.SALES_REP,
      orgId: dealerNc.id,
      phone: '13907910009',
    },
  ];

  const userMap: Record<string, string> = {};
  for (const u of demoUsers) {
    const rec = await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: { ...u, passwordHash },
    });
    userMap[u.username] = rec.id;
  }

  // 5. Brands, Categories & Suppliers
  const brandLumina = await prisma.brand.upsert({
    where: { code: 'LUMINA' },
    update: {},
    create: { name: 'Lumina', code: 'LUMINA' },
  });
  const brandSilky = await prisma.brand.upsert({
    where: { code: 'SILKY_PLAN' },
    update: {},
    create: { name: 'SILKY PLAN', code: 'SILKY_PLAN' },
  });
  const brandYuebai = await prisma.brand.upsert({
    where: { code: 'YUEBAI' },
    update: {},
    create: { name: '悦白之几', code: 'YUEBAI' },
  });

  const catEssence = await prisma.category.upsert({
    where: { name: '精华修护' },
    update: {},
    create: { name: '精华修护', sortOrder: 1 },
  });
  const catCream = await prisma.category.upsert({
    where: { name: '养护霜油' },
    update: {},
    create: { name: '养护霜油', sortOrder: 2 },
  });
  const catCollagen = await prisma.category.upsert({
    where: { name: '胶原再生' },
    update: {},
    create: { name: '胶原再生', sortOrder: 3 },
  });

  const supplierFactory = await prisma.supplier.upsert({
    where: { code: 'SUP-LUMINA-FAC' },
    update: {},
    create: {
      name: 'Lumina 合作生物制药厂（广州）',
      code: 'SUP-LUMINA-FAC',
      contactName: '周厂长',
      contactPhone: '13602801122',
      address: '广州市白云区美妆产业基地 12 号',
    },
  });

  // 6. Products
  const productSeeds = [
    {
      skuCode: 'LM-003',
      barcode: '6971234560031',
      name: 'Lumina 多维养护油',
      brandId: brandLumina.id,
      categoryId: catCream.id,
      spec: '120ml',
      unitName: '盒',
      cartonQty: 6,
      retailPrice: 880,
      defaultSupplyPrice: 352,
      costPrice: 165,
      minSupplyDiscount: 0.35,
      isTraceable: true,
      isCoreKpi: true,
    },
    {
      skuCode: 'LM-006',
      barcode: '6971234560062',
      name: 'Lumina 多维养护霜',
      brandId: brandLumina.id,
      categoryId: catCream.id,
      spec: '140g',
      unitName: '盒',
      cartonQty: 6,
      retailPrice: 698,
      defaultSupplyPrice: 279,
      costPrice: 132,
      minSupplyDiscount: 0.35,
      isTraceable: true,
      isCoreKpi: true,
    },
    {
      skuCode: 'LM-011',
      barcode: '6971234560116',
      name: 'Lumina 传明酸焕亮精华',
      brandId: brandLumina.id,
      categoryId: catEssence.id,
      spec: '60ml',
      unitName: '盒',
      cartonQty: 6,
      retailPrice: 658,
      defaultSupplyPrice: 263,
      costPrice: 118,
      minSupplyDiscount: 0.35,
      isTraceable: true,
      isCoreKpi: true,
    },
    {
      skuCode: 'LM-004',
      barcode: '6971234560048',
      name: 'Lumina 舒缓修护精华',
      brandId: brandLumina.id,
      categoryId: catEssence.id,
      spec: '30ml',
      unitName: '瓶',
      cartonQty: 6,
      retailPrice: 299,
      defaultSupplyPrice: 120,
      costPrice: 56,
      minSupplyDiscount: 0.35,
      isTraceable: true,
      isCoreKpi: true,
    },
    {
      skuCode: 'SP-0010',
      barcode: '6971234560109',
      name: 'SILKY PLAN 身体酸',
      brandId: brandSilky.id,
      categoryId: catEssence.id,
      spec: '100ml',
      unitName: '瓶',
      cartonQty: 6,
      retailPrice: 398,
      defaultSupplyPrice: 159,
      costPrice: 78,
      minSupplyDiscount: 0.35,
      isTraceable: true,
      isCoreKpi: false,
    },
    {
      skuCode: 'YB-0001',
      barcode: '6971234569001',
      name: '悦白之几-XVII型胶原蛋白',
      brandId: brandYuebai.id,
      categoryId: catCollagen.id,
      spec: '5瓶/盒',
      unitName: '盒',
      cartonQty: 6,
      retailPrice: 1280,
      defaultSupplyPrice: 512,
      costPrice: 260,
      minSupplyDiscount: 0.35,
      isTraceable: true,
      isCoreKpi: true,
    },
  ];

  const products: Record<string, { id: string; skuCode: string; name: string; retailPrice: number; defaultSupplyPrice: number }> = {};
  for (const p of productSeeds) {
    const rec = await prisma.product.upsert({
      where: { skuCode: p.skuCode },
      update: {},
      create: p,
    });
    products[p.skuCode] = {
      id: rec.id,
      skuCode: rec.skuCode,
      name: rec.name,
      retailPrice: Number(rec.retailPrice),
      defaultSupplyPrice: Number(rec.defaultSupplyPrice),
    };
  }

  // 7. Clinics (with realistic 90-day & 270-day states)
  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);
  const daysFromNow = (d: number) => new Date(now.getTime() + d * 86400_000);

  const clinicSeeds = [
    {
      name: '南昌妆典医疗美容',
      province: '江西省',
      city: '南昌市',
      cityCode: '360100',
      address: '南昌市红谷滩区世贸路 88 号',
      contactName: '刘院长',
      contactPhone: '13870910011',
      ownerOrgId: dealerNc.id,
      ownerSalesId: userMap['sales_nc'],
      bindStatus: ClinicBindStatus.BOUND_ACTIVE,
      reportedAt: daysAgo(120),
      protectExpireAt: daysAgo(30),
      lastOrderAt: daysAgo(10),
      arrearsAmount: 18600,
    },
    {
      name: '上饶万年悦己皮肤管理',
      province: '江西省',
      city: '上饶市',
      cityCode: '361100',
      address: '上饶市万年县陈营镇滨溪路 16 号',
      contactName: '吴店长',
      contactPhone: '13870330022',
      ownerOrgId: dealerNc.id,
      ownerSalesId: userMap['sales_nc'],
      bindStatus: ClinicBindStatus.BOUND_ACTIVE,
      reportedAt: daysAgo(320),
      protectExpireAt: daysAgo(230),
      lastOrderAt: daysAgo(256), // 14 days left before 270-day auto-unbind!
      arrearsAmount: 0,
    },
    {
      name: '南昌璞原科技美学',
      province: '江西省',
      city: '南昌市',
      cityCode: '360100',
      address: '南昌市东湖区阳明路 102 号',
      contactName: '苏总',
      contactPhone: '13870910033',
      ownerOrgId: dealerNc.id,
      ownerSalesId: userMap['sales_nc'],
      bindStatus: ClinicBindStatus.PROTECTED_90D,
      reportedAt: daysAgo(15),
      protectExpireAt: daysFromNow(75),
      lastOrderAt: null,
      arrearsAmount: 0,
    },
    {
      name: '宜春羽芮医疗美容',
      province: '江西省',
      city: '宜春市',
      cityCode: '360900',
      address: '宜春市袁州区明月北路 66 号',
      contactName: '周院长',
      contactPhone: '13870550044',
      ownerOrgId: dealerNc.id,
      ownerSalesId: userMap['sales_nc'],
      bindStatus: ClinicBindStatus.BOUND_ACTIVE,
      reportedAt: daysAgo(95),
      protectExpireAt: daysAgo(5),
      lastOrderAt: daysAgo(5),
      arrearsAmount: 4280,
    },
    {
      name: '长沙可可喜悦（望城店）',
      province: '湖南省',
      city: '长沙市',
      cityCode: '430100',
      address: '长沙市望城区雷锋大道 198 号',
      contactName: '何店长',
      contactPhone: '13974810055',
      ownerOrgId: dealerCs.id,
      ownerSalesId: userMap['dealer_cs'],
      bindStatus: ClinicBindStatus.BOUND_ACTIVE,
      reportedAt: daysAgo(80),
      protectExpireAt: daysFromNow(10),
      lastOrderAt: daysAgo(18),
      arrearsAmount: 0,
    },
    {
      name: '安徽颜姿美学',
      province: '安徽省',
      city: '合肥市',
      cityCode: '340100',
      address: '合肥市政务区天鹅湖路 58 号',
      contactName: '赵总',
      contactPhone: '13855110066',
      ownerOrgId: null,
      ownerSalesId: null,
      bindStatus: ClinicBindStatus.PUBLIC_POOL,
      reportedAt: null,
      protectExpireAt: null,
      lastOrderAt: null,
      arrearsAmount: 0,
    },
    {
      name: '抚州南城颜续皮肤管理',
      province: '江西省',
      city: '抚州市',
      cityCode: '361000',
      address: '抚州市南城县建昌镇胜利路 12 号',
      contactName: '郑店长',
      contactPhone: '13879410077',
      ownerOrgId: null,
      ownerSalesId: null,
      bindStatus: ClinicBindStatus.PUBLIC_POOL,
      reportedAt: null,
      protectExpireAt: null,
      lastOrderAt: null,
      arrearsAmount: 0,
    },
  ];

  const clinicMap: Record<string, string> = {};
  for (const c of clinicSeeds) {
    const fingerprint = buildClinicFingerprint({
      name: c.name,
      cityCode: c.cityCode,
      contactPhone: c.contactPhone,
    });
    const rec = await prisma.clinic.upsert({
      where: { fingerprint },
      update: {},
      create: { ...c, fingerprint },
    });
    clinicMap[c.name] = rec.id;
  }

  // 8. Seed Traceable Code Batch + Full Lifecycle Demo Data (idempotent check)
  const existingBatch = await prisma.codeBatch.findUnique({
    where: { batchNo: 'LM20261101-A' },
  });

  if (!existingBatch) {
    const oil = products['LM-003'];
    const cream = products['LM-006'];

    // Batch 1: 4 cartons x 6 units = 24 units of Lumina 多维养护油
    const batch1 = await prisma.codeBatch.create({
      data: {
        batchNo: 'LM20261101-A',
        productId: oil.id,
        mfgDate: daysAgo(25),
        expDate: new Date(now.getFullYear() + 3, now.getMonth(), now.getDate()),
        unitCount: 24,
        cartonCount: 4,
        cartonQty: 6,
        createdById: userMap['admin'],
        remark: '2026年11月首批防伪溯源赋码（含箱盒关联）',
      },
    });

    const gen1 = generateBatchCodeSet({
      unitCount: 24,
      cartonQty: 6,
      secret: TRACE_SECRET,
      verifyBaseUrl: VERIFY_BASE_URL,
      enableCarton: true,
    });

    // Carton 0: GENERATED (waiting for HQ warehouse scan inbound!)
    // Carton 1: IN_HQ_STOCK (in HQ warehouse, ready to scan outbound to dealer!)
    // Carton 2: IN_DEALER_STOCK (in Nanchang dealer warehouse, ready to scan outbound to clinic!)
    // Carton 3: UNPACKED -> 4 units SOLD_TO_CLINIC (南昌妆典医疗美容, ready for C-end QR verify!), 2 units IN_DEALER_STOCK
    let hqOilQty = 0;
    let ncOilQty = 0;
    let sampleConsumerToken = '';

    for (let idx = 0; idx < gen1.cartons.length; idx++) {
      const carton = gen1.cartons[idx];
      let cartonStatus = TraceCodeStatus.GENERATED;
      let cartonOrgId: string | null = null;
      let cartonWhId: string | null = null;
      let assignedDealerId: string | null = null;

      if (idx === 1) {
        cartonStatus = TraceCodeStatus.IN_HQ_STOCK;
        cartonOrgId = hqOrg.id;
        cartonWhId = hqWh.id;
      } else if (idx === 2) {
        cartonStatus = TraceCodeStatus.IN_DEALER_STOCK;
        cartonOrgId = dealerNc.id;
        cartonWhId = ncWh.id;
        assignedDealerId = dealerNc.id;
      } else if (idx === 3) {
        cartonStatus = TraceCodeStatus.UNPACKED;
        cartonOrgId = dealerNc.id;
        cartonWhId = ncWh.id;
        assignedDealerId = dealerNc.id;
      }

      const cartonRec = await prisma.traceCode.create({
        data: {
          codeToken: carton.cartonToken,
          codeLevel: TraceCodeLevel.CARTON,
          batchId: batch1.id,
          productId: oil.id,
          status: cartonStatus,
          currentOrgId: cartonOrgId,
          currentWarehouseId: cartonWhId,
          assignedDealerId,
        },
      });

      await prisma.traceEvent.create({
        data: {
          traceCodeId: cartonRec.id,
          eventType: TraceEventType.BATCH_GENERATED,
          operatorId: userMap['admin'],
          remark: '工厂批次赋码（箱盒预绑定 6 盒/箱）',
          occurredAt: daysAgo(20),
        },
      });

      for (let uIdx = 0; uIdx < carton.unitTokens.length; uIdx++) {
        const u = carton.unitTokens[uIdx];
        let uStatus = cartonStatus;
        let uOrgId = cartonOrgId;
        let uWhId = cartonWhId;
        let uClinicId: string | null = null;

        if (idx === 1) hqOilQty++;
        if (idx === 2) ncOilQty++;

        if (idx === 3) {
          if (uIdx < 4) {
            uStatus = TraceCodeStatus.SOLD_TO_CLINIC;
            uOrgId = null;
            uWhId = null;
            uClinicId = clinicMap['南昌妆典医疗美容'];
            if (!sampleConsumerToken) sampleConsumerToken = u.token;
          } else {
            uStatus = TraceCodeStatus.IN_DEALER_STOCK;
            uOrgId = dealerNc.id;
            uWhId = ncWh.id;
            ncOilQty++;
          }
        }

        const unitRec = await prisma.traceCode.create({
          data: {
            codeToken: u.token,
            codeLevel: TraceCodeLevel.UNIT,
            parentId: cartonRec.id,
            batchId: batch1.id,
            productId: oil.id,
            status: uStatus,
            currentOrgId: uOrgId,
            currentWarehouseId: uWhId,
            assignedDealerId,
            targetClinicId: uClinicId,
          },
        });

        const events: Array<{
          traceCodeId: string;
          eventType: string;
          fromOrgId?: string;
          toOrgId?: string;
          clinicId?: string;
          warehouseId?: string;
          docType?: string;
          docNo?: string;
          operatorId?: string;
          remark: string;
          occurredAt: Date;
        }> = [
          {
            traceCodeId: unitRec.id,
            eventType: TraceEventType.BATCH_GENERATED,
            operatorId: userMap['admin'],
            remark: `工厂赋码，所属外箱 ${carton.cartonToken}`,
            occurredAt: daysAgo(20),
          },
        ];

        if (idx >= 1) {
          events.push({
            traceCodeId: unitRec.id,
            eventType: TraceEventType.HQ_INBOUND,
            toOrgId: hqOrg.id,
            warehouseId: hqWh.id,
            docType: 'PURCHASE_INBOUND',
            docNo: 'CG202611050001',
            operatorId: userMap['hq_warehouse'],
            remark: '璞澜品牌总仓整箱扫码入库',
            occurredAt: daysAgo(15),
          });
        }
        if (idx >= 2) {
          events.push({
            traceCodeId: unitRec.id,
            eventType: TraceEventType.HQ_OUTBOUND,
            fromOrgId: hqOrg.id,
            toOrgId: dealerNc.id,
            warehouseId: hqWh.id,
            docType: 'SALES_OUTBOUND',
            docNo: 'XS202611100001',
            operatorId: userMap['hq_warehouse'],
            remark: '总仓扫码发往南昌赣中核心服务商',
            occurredAt: daysAgo(12),
          });
          events.push({
            traceCodeId: unitRec.id,
            eventType: TraceEventType.DEALER_INBOUND,
            fromOrgId: hqOrg.id,
            toOrgId: dealerNc.id,
            warehouseId: ncWh.id,
            docType: 'DEALER_INBOUND',
            docNo: 'RK202611120001',
            operatorId: userMap['dealer_nc'],
            remark: '南昌服务商独立仓确认扫码收货',
            occurredAt: daysAgo(11),
          });
        }
        if (idx === 3 && uIdx < 4) {
          events.push({
            traceCodeId: unitRec.id,
            eventType: TraceEventType.DEALER_OUTBOUND,
            fromOrgId: dealerNc.id,
            clinicId: clinicMap['南昌妆典医疗美容'],
            warehouseId: ncWh.id,
            docType: 'SALES_OUTBOUND',
            docNo: 'XS202611150002',
            operatorId: userMap['dealer_nc'],
            remark: '拆箱单盒扫码出库至南昌妆典医疗美容',
            occurredAt: daysAgo(8),
          });
        }

        await prisma.traceEvent.createMany({ data: events });
      }
    }

    // Batch 2: 2 cartons x 6 units = 12 units of Lumina 多维养护霜 in HQ stock
    const batch2 = await prisma.codeBatch.create({
      data: {
        batchNo: 'LM20261108-B',
        productId: cream.id,
        mfgDate: daysAgo(18),
        expDate: new Date(now.getFullYear() + 3, now.getMonth(), now.getDate()),
        unitCount: 12,
        cartonCount: 2,
        cartonQty: 6,
        createdById: userMap['admin'],
        remark: '养护霜常规备货批次',
      },
    });

    const gen2 = generateBatchCodeSet({
      unitCount: 12,
      cartonQty: 6,
      secret: TRACE_SECRET,
      verifyBaseUrl: VERIFY_BASE_URL,
      enableCarton: true,
    });

    for (const c of gen2.cartons) {
      const cRec = await prisma.traceCode.create({
        data: {
          codeToken: c.cartonToken,
          codeLevel: TraceCodeLevel.CARTON,
          batchId: batch2.id,
          productId: cream.id,
          status: TraceCodeStatus.IN_HQ_STOCK,
          currentOrgId: hqOrg.id,
          currentWarehouseId: hqWh.id,
        },
      });
      for (const u of c.unitTokens) {
        const uRec = await prisma.traceCode.create({
          data: {
            codeToken: u.token,
            codeLevel: TraceCodeLevel.UNIT,
            parentId: cRec.id,
            batchId: batch2.id,
            productId: cream.id,
            status: TraceCodeStatus.IN_HQ_STOCK,
            currentOrgId: hqOrg.id,
            currentWarehouseId: hqWh.id,
          },
        });
        await prisma.traceEvent.create({
          data: {
            traceCodeId: uRec.id,
            eventType: TraceEventType.HQ_INBOUND,
            toOrgId: hqOrg.id,
            warehouseId: hqWh.id,
            docType: 'PURCHASE_INBOUND',
            docNo: 'CG202611080002',
            operatorId: userMap['hq_warehouse'],
            remark: '总仓扫码入库',
            occurredAt: daysAgo(14),
          },
        });
      }
    }

    // Seed StockBalances matching real traceable codes
    await prisma.stockBalance.createMany({
      data: [
        { warehouseId: hqWh.id, productId: oil.id, qty: hqOilQty, warnMinQty: 6 },
        { warehouseId: hqWh.id, productId: cream.id, qty: 12, warnMinQty: 6 },
        { warehouseId: ncWh.id, productId: oil.id, qty: ncOilQty, warnMinQty: 4 },
        { warehouseId: csWh.id, productId: oil.id, qty: 0, warnMinQty: 4 },
      ],
      skipDuplicates: true,
    });

    // Seed Sample Purchase Order & Sales Orders
    await prisma.purchaseOrder.create({
      data: {
        docNo: 'CG202611050001',
        orgId: hqOrg.id,
        supplierId: supplierFactory.id,
        warehouseId: hqWh.id,
        bizDate: daysAgo(15),
        status: 'COMPLETED',
        totalAmount: 2970,
        paidAmount: 2970,
        remark: 'Lumina 首批赋码成品入库',
        creatorId: userMap['hq_warehouse'],
        items: {
          create: [
            {
              productId: oil.id,
              qty: 18,
              inboundQty: 18,
              unitPrice: 165,
              discountPercent: 100,
              lineAmount: 2970,
            },
          ],
        },
      },
    });

    await prisma.salesOrder.create({
      data: {
        docNo: 'XS202611100001',
        orderScene: OrderScene.HQ_TO_DEALER,
        sellerOrgId: hqOrg.id,
        buyerOrgId: dealerNc.id,
        warehouseId: hqWh.id,
        salesRepId: userMap['admin'],
        bizDate: daysAgo(12),
        status: SalesOrderStatus.COMPLETED,
        totalRetailAmount: 10560,
        subtotalAmount: 4224,
        totalAmount: 4224,
        paidAmount: 4224,
        compositeDiscountRatio: 0.4,
        redlineStatus: RedlineStatus.PASS,
        shippingMethod: '顺丰冷链',
        trackingNo: 'SF168890221345',
        remark: '南昌服务商11月首批供货（4.0折合规）',
        creatorId: userMap['hq_warehouse'],
        items: {
          create: [
            {
              productId: oil.id,
              qty: 12,
              outboundQty: 12,
              retailPrice: 880,
              unitPrice: 880,
              discountPercent: 40,
              lineAmount: 4224,
            },
          ],
        },
      },
    });

    await prisma.salesOrder.create({
      data: {
        docNo: 'XS202611150002',
        orderScene: OrderScene.DEALER_TO_CLINIC,
        sellerOrgId: dealerNc.id,
        clinicId: clinicMap['南昌妆典医疗美容'],
        warehouseId: ncWh.id,
        salesRepId: userMap['sales_nc'],
        bizDate: daysAgo(8),
        status: SalesOrderStatus.COMPLETED,
        totalRetailAmount: 3520,
        subtotalAmount: 1936,
        totalAmount: 1936,
        paidAmount: 1936,
        compositeDiscountRatio: 0.55,
        redlineStatus: RedlineStatus.PASS,
        shippingMethod: '同城闪送',
        remark: '机构补货 4 盒（5.5折）',
        creatorId: userMap['sales_nc'],
        items: {
          create: [
            {
              productId: oil.id,
              qty: 4,
              outboundQty: 4,
              retailPrice: 880,
              unitPrice: 880,
              discountPercent: 55,
              lineAmount: 1936,
            },
          ],
        },
      },
    });

    // Pending outbound order ready to demo scanning right away!
    await prisma.salesOrder.create({
      data: {
        docNo: 'XS202611230001',
        orderScene: OrderScene.DEALER_TO_CLINIC,
        sellerOrgId: dealerNc.id,
        clinicId: clinicMap['宜春羽芮医疗美容'],
        warehouseId: ncWh.id,
        salesRepId: userMap['sales_nc'],
        bizDate: now,
        status: SalesOrderStatus.PENDING_OUTBOUND,
        totalRetailAmount: 1760,
        subtotalAmount: 968,
        totalAmount: 968,
        paidAmount: 0,
        compositeDiscountRatio: 0.55,
        redlineStatus: RedlineStatus.PASS,
        shippingMethod: '物流发货',
        remark: '外勤销售小程序提交，待库管扫码出库并针式打单',
        creatorId: userMap['sales_nc'],
        items: {
          create: [
            {
              productId: oil.id,
              qty: 2,
              outboundQty: 0,
              retailPrice: 880,
              unitPrice: 880,
              discountPercent: 55,
              lineAmount: 968,
            },
          ],
        },
      },
    });

    // Sample Anti-Fleeing Alert
    await prisma.antiFleeingAlert.create({
      data: {
        alertType: 'CROSS_REGION',
        severity: 'HIGH',
        orgId: dealerNc.id,
        traceCodeToken: sampleConsumerToken,
        docNo: 'XS202611150002',
        title: '疑似跨区域窜货预警（授权江西 -> 浙江杭州验真）',
        detail: `单品码 ${sampleConsumerToken} 授权区域为【南昌市/江西】，但检测到终端消费者在【杭州市】扫码验真，请流向管控负责人核查出库流向。`,
        evidenceSnapshot: {
          authorizedRegions: ['南昌市', '宜春市', '上饶市'],
          detectedCity: '杭州市',
          clinicName: '南昌妆典医疗美容',
        },
        status: 'OPEN',
      },
    });

    // Sample Monthly Reconciliation
    const periodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    await prisma.monthlyReconciliation.upsert({
      where: { periodMonth_orgId: { periodMonth, orgId: dealerNc.id } },
      update: {},
      create: {
        periodMonth,
        orgId: dealerNc.id,
        status: 'VARIANCE_FLAGGED',
        totalTheoretical: ncOilQty,
        totalActual: Math.max(0, ncOilQty - 1),
        totalVariance: -1,
        dealerNote: '盘点少 1 盒，疑似业务员借样未补录出库单',
        submittedAt: daysAgo(1),
        items: {
          create: [
            {
              productId: oil.id,
              productName: oil.name,
              skuCode: oil.skuCode,
              openingQty: 0,
              inboundQty: 12,
              outboundQty: 4,
              theoreticalQty: ncOilQty,
              actualQty: Math.max(0, ncOilQty - 1),
              varianceQty: -1,
              explanation: '疑似样板借出未建单，申请复盘补录',
            },
          ],
        },
      },
    });

    console.log(`✅ Sample C-End Verify Token ready: ${sampleConsumerToken}`);
  }

  // 9. Seed 4 Standard Print Templates
  const templateCount = await prisma.printTemplate.count();
  if (templateCount === 0) {
    const defaultCols = ORDER_TABLE_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
    const defaultVars = ORDER_SYSTEM_VARS.filter((v) => v.defaultVisible).map((v) => v.key);
    const presets: Array<{
      docType: string;
      paperType: PrintPaperType;
      name: string;
      isDefault: boolean;
    }> = [
      {
        docType: 'SALES_OUTBOUND',
        paperType: PrintPaperType.NEEDLE_241_140,
        name: '销售出库单 - 241×140mm 针式二等分三联单',
        isDefault: true,
      },
      {
        docType: 'SALES_OUTBOUND',
        paperType: PrintPaperType.NEEDLE_241_93,
        name: '销售出库单 - 241×93mm 针式三等分短联单',
        isDefault: false,
      },
      {
        docType: 'SALES_OUTBOUND',
        paperType: PrintPaperType.A4,
        name: '销售出库单 - A4 完整溯源明细单',
        isDefault: false,
      },
      {
        docType: 'TRACE_LABEL',
        paperType: PrintPaperType.THERMAL_50_30,
        name: '溯源条码标贴 - 50×30mm 热敏箱盒标贴',
        isDefault: true,
      },
    ];

    for (const tpl of presets) {
      await prisma.printTemplate.create({
        data: {
          docType: tpl.docType,
          paperType: tpl.paperType,
          name: tpl.name,
          isDefault: tpl.isDefault,
          visibleColumns: defaultCols,
          systemVars: defaultVars,
          hiprintJson: buildHiprintTemplate({
            paperType: tpl.paperType,
            title: `Lumina ${tpl.name.split(' - ')[0]}`,
            visibleColumns: defaultCols,
            systemVars: defaultVars,
          }) as unknown as object,
        },
      });
    }
  }

  console.log('🎉 Database seed completed cleanly!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
