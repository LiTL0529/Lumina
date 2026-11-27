import { PrismaClient } from '@prisma/client';
import { evaluateStoreVisitTarget } from '@lumina/shared-types';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.visitPlanTarget.count();
  if (existing > 0) {
    console.log(`CRM visit tables already contain ${existing} targets, skipping seed.`);
    return;
  }

  const dealers = await prisma.organization.findMany({ where: { type: 'DEALER' } });
  const ncDealer = dealers.find((d) => d.name.includes('南昌')) || dealers[0];
  const csDealer = dealers.find((d) => d.name.includes('长沙')) || dealers[1] || ncDealer;
  if (!ncDealer) {
    console.log('No dealer org found, skipping CRM seed.');
    return;
  }

  const currentMonth = '2026-11';

  const sampleTargets = [
    // Exact examples from user's Excel sheet (林晨亮 · 南昌)
    {
      orgId: ncDealer.id,
      salesRepName: '林晨亮',
      planMonth: currentMonth,
      clinicName: '尔湾',
      cityRegion: '南昌市红谷滩区',
      leadSource: '大众美团',
      plannedVisitDate: '2026-11-18',
      storeType: 'C.皮肤科双美',
      trafficPrice: 'C.100-200元内',
      storeArea: 'B.100-500平',
      beauticianCount: 'C.4-6人',
      storeScale: 'B.多店',
    },
    {
      orgId: ncDealer.id,
      salesRepName: '林晨亮',
      planMonth: currentMonth,
      clinicName: '钱多多',
      cityRegion: '南昌市红谷滩区',
      leadSource: '小红书搜索',
      plannedVisitDate: '2026-11-20',
      storeType: 'D.纯生美',
      trafficPrice: 'C.100-200元内',
      storeArea: 'C.500-1000平',
      beauticianCount: 'C.4-6人',
      storeScale: 'A.单店',
    },
    {
      orgId: ncDealer.id,
      salesRepName: '林晨亮',
      planMonth: currentMonth,
      clinicName: '东湖初颜美肤馆',
      cityRegion: '南昌市东湖区',
      leadSource: '抖音本地生活',
      plannedVisitDate: '2026-11-22',
      storeType: 'D.纯生美',
      trafficPrice: 'B.30-99元内',
      storeArea: 'B.100-500平',
      beauticianCount: 'B.2-3人',
      storeScale: 'B.多店',
    },
    {
      orgId: ncDealer.id,
      salesRepName: '林晨亮',
      planMonth: currentMonth,
      clinicName: '西湖素肌美学社',
      cityRegion: '南昌市西湖区',
      leadSource: '老客转介绍',
      plannedVisitDate: '2026-11-24',
      storeType: 'C.皮肤科双美',
      trafficPrice: 'B.30-99元内',
      storeArea: 'B.100-500平',
      beauticianCount: 'B.2-3人',
      storeScale: 'A.单店',
    },
    {
      orgId: csDealer.id,
      salesRepName: '周明远',
      planMonth: currentMonth,
      clinicName: '岳麓臻美皮肤管理中心',
      cityRegion: '长沙市岳麓区',
      leadSource: '大众美团',
      plannedVisitDate: '2026-11-19',
      storeType: 'C.皮肤科双美',
      trafficPrice: 'D.200-500元内',
      storeArea: 'C.500-1000平',
      beauticianCount: 'D.7人以上',
      storeScale: 'C.区域连锁',
    },
    {
      orgId: csDealer.id,
      salesRepName: '周明远',
      planMonth: currentMonth,
      clinicName: '芙蓉轻奢抗衰中心',
      cityRegion: '长沙市芙蓉区',
      leadSource: '小红书搜索',
      plannedVisitDate: '2026-11-23',
      storeType: 'B.双美偏注射',
      trafficPrice: 'C.100-200元内',
      storeArea: 'A.100平内',
      beauticianCount: 'B.2-3人',
      storeScale: 'A.单店',
    },
  ];

  const createdTargets = new Map<string, string>();
  for (const row of sampleTargets) {
    const ev = evaluateStoreVisitTarget(row);
    const rec = await prisma.visitPlanTarget.create({
      data: {
        ...row,
        storeTypeScore: ev.storeTypeScore,
        trafficPriceScore: ev.trafficPriceScore,
        storeAreaScore: ev.storeAreaScore,
        beauticianScore: ev.beauticianScore,
        storeScaleScore: ev.storeScaleScore,
        totalScore: ev.totalScore,
        storeGrade: ev.storeGrade,
        actionAdvice: ev.actionAdvice,
        isCompleted: ev.isCompleted,
        validationText: ev.validationText,
      },
    });
    createdTargets.set(row.clinicName, rec.id);
  }

  await prisma.visitFollowUpLog.createMany({
    data: [
      {
        orgId: ncDealer.id,
        targetId: createdTargets.get('尔湾') || null,
        salesRepName: '林晨亮',
        customerName: '尔湾',
        cityRegion: '南昌市红谷滩区',
        visitDate: '2026-11-20',
        storeType: 'C.皮肤科双美',
        storeArea: '100-500平',
        contactName: '林',
        contactRole: '科室运营',
        contactPhone: '17610054319',
        channelSource: '大众美团',
        visitSummary: '好，很好，非常好，对一物一码防窜货与术后修护线高度认可',
        customerNeed: '买一送一 / 申请城市会现场体验名额',
        cityMeetingStatus: '已报名',
        dealStatus: '意向跟进中',
      },
      {
        orgId: ncDealer.id,
        targetId: createdTargets.get('钱多多') || null,
        salesRepName: '林晨亮',
        customerName: '钱多多',
        cityRegion: '南昌市红谷滩区',
        visitDate: '2026-11-21',
        storeType: 'D.纯生美',
        storeArea: '500-1000平',
        contactName: '陈店长',
        contactRole: '店长',
        contactPhone: '13870019283',
        channelSource: '小红书搜索',
        visitSummary: '门店面积大、护理床位充足，重点关注卡项纳新与复购 SOP',
        customerNeed: '需要 2 套试用装先给核心老客做体验测试',
        cityMeetingStatus: '已邀约',
        dealStatus: '意向跟进中',
      },
      {
        orgId: ncDealer.id,
        targetId: null,
        salesRepName: '林晨亮',
        customerName: '有才',
        cityRegion: '未匹配',
        visitDate: '2026-11-22',
        visitSummary: '陌生扫街初访，已留品牌彩页与名片',
        customerNeed: '待下次核实面积与美容师团队后再评分建档',
        cityMeetingStatus: '未邀约',
        dealStatus: '未成交',
      },
      {
        orgId: csDealer.id,
        targetId: createdTargets.get('岳麓臻美皮肤管理中心') || null,
        salesRepName: '周明远',
        customerName: '岳麓臻美皮肤管理中心',
        cityRegion: '长沙市岳麓区',
        visitDate: '2026-11-23',
        storeType: 'C.皮肤科双美',
        storeArea: '500-1000平',
        contactName: '李总',
        contactRole: '老板/院长',
        contactPhone: '13974826610',
        channelSource: '大众美团',
        visitSummary: '区域 3 家连锁，当场确认首批铺货 2 箱并参加长沙城市会',
        customerNeed: '要求支持 90 天区域保护与扫码验真背书',
        cityMeetingStatus: '已到场',
        dealStatus: '已成交',
      },
    ],
  });

  console.log('Seeded CRM visit plans (6 targets) and follow-up logs (4 records).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
