import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnModuleInit,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  buildClinicFingerprint,
  CITY_MEETING_OPTIONS,
  ClinicBindStatus,
  CONTACT_ROLE_OPTIONS,
  CustomerLifecycleStage,
  DEAL_STATUS_OPTIONS,
  evaluateExistingClientHealth,
  evaluateExistingMaintenancePerf,
  evaluateRepPerformance,
  evaluateStoreVisitTarget,
  EXISTING_VISIT_TYPE_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  NANCHANG_DISTRICTS,
  REPURCHASE_INTENT_OPTIONS,
  STORE_GRADE_RULES,
  STORE_SCORING_DIMENSIONS,
  TargetConversionStatus,
  VisitScene,
} from '@lumina/shared-types';
import { PrismaService } from '../../common/prisma.module';
import { AuthUser, CurrentUser } from '../../common/auth.decorators';
import { PageQuery, parsePagination } from '../../common/pagination';

function stripAreaPrefix(area?: string | null): string {
  return (area || '').replace(/^[A-D]\./, '');
}

function defaultPlanMonth(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value || String(now.getFullYear());
  const m = parts.find((p) => p.type === 'month')?.value || String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function extractCityName(region?: string | null): string {
  const s = (region || '').trim();
  if (!s) return '南昌市';
  const m = s.match(/^([^省]+市)/);
  return m ? m[1] : s;
}

function daysBetween(from?: Date | string | null, to: Date = new Date()): number | null {
  if (!from) return null;
  const d = typeof from === 'string' ? new Date(from) : from;
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((to.getTime() - d.getTime()) / 86400_000));
}

function buildScoreSnapshot(target: {
  id: string;
  planMonth: string;
  salesRepName: string;
  storeType?: string | null;
  storeTypeScore: number;
  trafficPrice?: string | null;
  trafficPriceScore: number;
  storeArea?: string | null;
  storeAreaScore: number;
  beauticianCount?: string | null;
  beauticianScore: number;
  storeScale?: string | null;
  storeScaleScore: number;
  totalScore: number;
  storeGrade: string;
  actionAdvice: string;
  createdAt: Date;
}) {
  return {
    targetId: target.id,
    planMonth: target.planMonth,
    salesRepName: target.salesRepName,
    totalScore: target.totalScore,
    storeGrade: target.storeGrade || '未评级',
    actionAdvice: target.actionAdvice,
    dimensions: {
      storeType: { value: target.storeType || '', score: target.storeTypeScore },
      trafficPrice: { value: target.trafficPrice || '', score: target.trafficPriceScore },
      storeArea: { value: target.storeArea || '', score: target.storeAreaScore },
      beauticianCount: { value: target.beauticianCount || '', score: target.beauticianScore },
      storeScale: { value: target.storeScale || '', score: target.storeScaleScore },
    },
    scoredAt: target.createdAt.toISOString(),
  };
}

@Injectable()
export class CrmService implements OnModuleInit {
  private readonly logger = new Logger(CrmService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.syncLifecycleBackfill();
  }

  /**
   * Idempotent backfill ensuring every existing consuming Clinic is marked EXISTING_ACTIVE/DORMANT,
   * every VisitPlanTarget is linked to a Clinic 360° master record, and already-converted targets
   * are logically archived with frozen initialScoreSnapshot.
   */
  async syncLifecycleBackfill() {
    try {
      const now = new Date();
      const clinics = await this.prisma.clinic.findMany({
        include: {
          salesOrders: {
            where: {
              orderScene: 'DEALER_TO_CLINIC',
              OR: [
                { status: { in: ['PENDING_OUTBOUND', 'PARTIAL_OUTBOUND', 'COMPLETED'] } },
                { paidAmount: { gt: 0 } },
              ],
            },
            orderBy: { bizDate: 'asc' },
          },
        },
      });

      for (const c of clinics) {
        const qualifyingOrders = c.salesOrders || [];
        const hasConsumed = qualifyingOrders.length > 0 || c.lastOrderAt !== null;
        if (hasConsumed) {
          const earliestOrder = qualifyingOrders[0]?.bizDate || c.lastOrderAt || now;
          const latestOrder = qualifyingOrders.length
            ? qualifyingOrders[qualifyingOrders.length - 1].bizDate
            : c.lastOrderAt;
          const dSince = daysBetween(latestOrder, now);
          const nextStage =
            dSince !== null && dSince > 180
              ? CustomerLifecycleStage.EXISTING_DORMANT
              : CustomerLifecycleStage.EXISTING_ACTIVE;

          const needsUpdate =
            c.lifecycleStage === CustomerLifecycleStage.PROSPECT ||
            !c.firstOrderAt ||
            !c.convertedAt ||
            (c.lifecycleStage === CustomerLifecycleStage.EXISTING_ACTIVE &&
              nextStage === CustomerLifecycleStage.EXISTING_DORMANT);

          if (needsUpdate) {
            await this.prisma.clinic.update({
              where: { id: c.id },
              data: {
                lifecycleStage: nextStage,
                firstOrderAt: c.firstOrderAt || earliestOrder,
                convertedAt: c.convertedAt || earliestOrder,
                lastOrderAt: c.lastOrderAt || latestOrder || null,
                ...(c.bindStatus === ClinicBindStatus.PROSPECT_LEAD ||
                c.bindStatus === ClinicBindStatus.PROTECTED_90D
                  ? { bindStatus: ClinicBindStatus.BOUND_ACTIVE }
                  : {}),
              },
            });
          }
        }
      }

      // Link all VisitPlanTargets to their master Clinic record (create PROSPECT_LEAD if absent)
      const targets = await this.prisma.visitPlanTarget.findMany({ orderBy: { createdAt: 'asc' } });
      for (const t of targets) {
        let clinic = t.linkedClinicId
          ? await this.prisma.clinic.findUnique({ where: { id: t.linkedClinicId } })
          : null;

        if (!clinic) {
          clinic = await this.prisma.clinic.findFirst({
            where: {
              name: { equals: t.clinicName.trim(), mode: 'insensitive' },
              OR: [{ ownerOrgId: t.orgId }, { ownerOrgId: null }],
            },
          });
        }

        if (!clinic) {
          const city = extractCityName(t.cityRegion);
          const fp = buildClinicFingerprint({ name: t.clinicName, cityCode: city });
          clinic = await this.prisma.clinic.findUnique({ where: { fingerprint: fp } });
          if (!clinic) {
            clinic = await this.prisma.clinic.create({
              data: {
                name: t.clinicName.trim(),
                fingerprint: fp,
                city: t.cityRegion?.trim() || city,
                cityCode: city,
                ownerOrgId: t.orgId,
                ownerSalesId: t.salesRepId || null,
                salesRepName: t.salesRepName,
                bindStatus: ClinicBindStatus.PROSPECT_LEAD,
                lifecycleStage: CustomerLifecycleStage.PROSPECT,
                leadSource: t.leadSource,
                storeType: t.storeType,
                trafficPrice: t.trafficPrice,
                storeArea: t.storeArea,
                beauticianCount: t.beauticianCount,
                storeScale: t.storeScale,
              },
            });
          }
        }

        if (clinic) {
          const isExisting = clinic.lifecycleStage !== CustomerLifecycleStage.PROSPECT;
          const targetUpdates: Record<string, unknown> = {};
          if (t.linkedClinicId !== clinic.id) targetUpdates.linkedClinicId = clinic.id;
          if (isExisting && t.conversionStatus !== TargetConversionStatus.CONVERTED) {
            targetUpdates.conversionStatus = TargetConversionStatus.CONVERTED;
            targetUpdates.convertedAt = clinic.convertedAt || clinic.firstOrderAt || now;
          }
          if (Object.keys(targetUpdates).length > 0) {
            await this.prisma.visitPlanTarget.update({ where: { id: t.id }, data: targetUpdates });
          }

          // Sync missing basic attributes and freeze initialScoreSnapshot onto Clinic
          const clinicUpdates: Record<string, unknown> = {};
          if (!clinic.salesRepName && t.salesRepName) clinicUpdates.salesRepName = t.salesRepName;
          if (!clinic.leadSource && t.leadSource) clinicUpdates.leadSource = t.leadSource;
          if (!clinic.storeType && t.storeType) clinicUpdates.storeType = t.storeType;
          if (!clinic.trafficPrice && t.trafficPrice) clinicUpdates.trafficPrice = t.trafficPrice;
          if (!clinic.storeArea && t.storeArea) clinicUpdates.storeArea = t.storeArea;
          if (!clinic.beauticianCount && t.beauticianCount) clinicUpdates.beauticianCount = t.beauticianCount;
          if (!clinic.storeScale && t.storeScale) clinicUpdates.storeScale = t.storeScale;
          if (isExisting && !clinic.initialScoreSnapshot && t.totalScore > 0) {
            clinicUpdates.initialScoreSnapshot = buildScoreSnapshot(t);
          }
          if (Object.keys(clinicUpdates).length > 0) {
            await this.prisma.clinic.update({ where: { id: clinic.id }, data: clinicUpdates });
          }
        }
      }

      // Link VisitFollowUpLog.clinicId where null
      const unlinkedLogs = await this.prisma.visitFollowUpLog.findMany({
        where: { clinicId: null },
        include: { target: { select: { linkedClinicId: true } } },
      });
      for (const l of unlinkedLogs) {
        let cid = l.target?.linkedClinicId || null;
        if (!cid) {
          const c = await this.prisma.clinic.findFirst({
            where: {
              name: { equals: l.customerName.trim(), mode: 'insensitive' },
              OR: [{ ownerOrgId: l.orgId }, { ownerOrgId: null }],
            },
            select: { id: true, contactName: true, contactPhone: true, wechatId: true, contactRole: true },
          });
          if (c) {
            cid = c.id;
            const patch: Record<string, unknown> = {};
            if (!c.contactName && l.contactName) patch.contactName = l.contactName;
            if (!c.contactPhone && l.contactPhone) patch.contactPhone = l.contactPhone;
            if (!c.wechatId && l.wechatId) patch.wechatId = l.wechatId;
            if (!c.contactRole && l.contactRole) patch.contactRole = l.contactRole;
            if (Object.keys(patch).length) {
              await this.prisma.clinic.update({ where: { id: c.id }, data: patch });
            }
          }
        }
        if (cid) {
          await this.prisma.visitFollowUpLog.update({ where: { id: l.id }, data: { clinicId: cid } });
        }
      }

      this.logger.log('CRM lifecycle backfill verified successfully');
    } catch (err: any) {
      this.logger.warn(`CRM lifecycle backfill skipped: ${err?.message}`);
    }
  }

  private resolveTargetOrgId(user: AuthUser, requestedOrgId?: string): string | undefined {
    if (user.orgType !== 'HQ') {
      return user.orgId;
    }
    return requestedOrgId?.trim() || undefined;
  }

  private async ensureDefaultOrgId(user: AuthUser, requestedOrgId?: string): Promise<string> {
    if (user.orgType !== 'HQ') return user.orgId;
    if (requestedOrgId?.trim()) return requestedOrgId.trim();
    const firstDealer = await this.prisma.organization.findFirst({ where: { type: 'DEALER' } });
    return firstDealer?.id || user.orgId;
  }

  private async findOrCreateProspectClinic(params: {
    orgId: string;
    name: string;
    cityRegion?: string | null;
    salesRepId?: string | null;
    salesRepName?: string | null;
    leadSource?: string | null;
    storeType?: string | null;
    trafficPrice?: string | null;
    storeArea?: string | null;
    beauticianCount?: string | null;
    storeScale?: string | null;
  }) {
    const cleanName = params.name.trim();
    const city = extractCityName(params.cityRegion);
    const fp = buildClinicFingerprint({ name: cleanName, cityCode: city });

    let clinic = await this.prisma.clinic.findFirst({
      where: {
        OR: [
          { fingerprint: fp },
          {
            name: { equals: cleanName, mode: 'insensitive' },
            OR: [{ ownerOrgId: params.orgId }, { ownerOrgId: null }],
          },
        ],
      },
    });

    if (!clinic) {
      clinic = await this.prisma.clinic.create({
        data: {
          name: cleanName,
          fingerprint: fp,
          city: params.cityRegion?.trim() || city,
          cityCode: city,
          ownerOrgId: params.orgId,
          ownerSalesId: params.salesRepId || null,
          salesRepName: params.salesRepName || null,
          bindStatus: ClinicBindStatus.PROSPECT_LEAD,
          lifecycleStage: CustomerLifecycleStage.PROSPECT,
          leadSource: params.leadSource || null,
          storeType: params.storeType || null,
          trafficPrice: params.trafficPrice || null,
          storeArea: params.storeArea || null,
          beauticianCount: params.beauticianCount || null,
          storeScale: params.storeScale || null,
        },
      });
    } else if (clinic.lifecycleStage === CustomerLifecycleStage.PROSPECT) {
      // Sync latest scoring/basic attributes onto prospect master record
      await this.prisma.clinic.update({
        where: { id: clinic.id },
        data: {
          ...(params.cityRegion?.trim() ? { city: params.cityRegion.trim() } : {}),
          ...(params.salesRepName ? { salesRepName: params.salesRepName } : {}),
          ...(params.leadSource !== undefined ? { leadSource: params.leadSource || null } : {}),
          ...(params.storeType !== undefined ? { storeType: params.storeType || null } : {}),
          ...(params.trafficPrice !== undefined ? { trafficPrice: params.trafficPrice || null } : {}),
          ...(params.storeArea !== undefined ? { storeArea: params.storeArea || null } : {}),
          ...(params.beauticianCount !== undefined ? { beauticianCount: params.beauticianCount || null } : {}),
          ...(params.storeScale !== undefined ? { storeScale: params.storeScale || null } : {}),
        },
      });
    }

    return clinic;
  }

  /**
   * Automatic or manual promotion of a clinic/prospect into an Existing Client (老客).
   * Triggered on:
   * 1) Approved / Paid first SalesOrder (DEALER_TO_CLINIC)
   * 2) HQ special approval of a redline SalesOrder
   * 3) Manual "标为老客" or historical batch import
   */
  async promoteClinicToExisting(
    clinicId: string,
    opts: {
      orderId?: string;
      orderDocNo?: string;
      bizDate?: Date;
      operator?: AuthUser;
      reason?: string;
    } = {},
  ) {
    const clinic = await this.prisma.clinic.findUnique({ where: { id: clinicId } });
    if (!clinic) return null;

    const now = opts.bizDate || new Date();
    const wasProspect = clinic.lifecycleStage === CustomerLifecycleStage.PROSPECT;

    // Find matching prospect targets to archive and snapshot
    const matchingTargets = await this.prisma.visitPlanTarget.findMany({
      where: {
        OR: [
          { linkedClinicId: clinic.id },
          ...(clinic.ownerOrgId
            ? [{ orgId: clinic.ownerOrgId, clinicName: { equals: clinic.name, mode: 'insensitive' as const } }]
            : []),
        ],
      },
      orderBy: [{ isCompleted: 'desc' }, { updatedAt: 'desc' }],
    });

    const bestTarget = matchingTargets[0] || null;
    const snapshot =
      clinic.initialScoreSnapshot ||
      (bestTarget && bestTarget.totalScore > 0 ? buildScoreSnapshot(bestTarget) : null);

    const updatedClinic = await this.prisma.$transaction(async (tx) => {
      const nextLastOrderAt =
        opts.bizDate && (!clinic.lastOrderAt || opts.bizDate > clinic.lastOrderAt)
          ? opts.bizDate
          : clinic.lastOrderAt || opts.bizDate || null;

      const rec = await tx.clinic.update({
        where: { id: clinic.id },
        data: {
          lifecycleStage: CustomerLifecycleStage.EXISTING_ACTIVE,
          firstOrderAt: clinic.firstOrderAt || now,
          convertedAt: clinic.convertedAt || now,
          convertedBySalesId: clinic.convertedBySalesId || opts.operator?.userId || clinic.ownerSalesId || null,
          lastOrderAt: nextLastOrderAt,
          ...(clinic.bindStatus === ClinicBindStatus.PROSPECT_LEAD ||
          clinic.bindStatus === ClinicBindStatus.PROTECTED_90D
            ? { bindStatus: ClinicBindStatus.BOUND_ACTIVE }
            : {}),
          ...(snapshot && !clinic.initialScoreSnapshot
            ? { initialScoreSnapshot: snapshot as unknown as object }
            : {}),
          ...(bestTarget && !clinic.storeType && bestTarget.storeType
            ? { storeType: bestTarget.storeType }
            : {}),
          ...(bestTarget && !clinic.storeArea && bestTarget.storeArea
            ? { storeArea: bestTarget.storeArea }
            : {}),
          ...(bestTarget && !clinic.beauticianCount && bestTarget.beauticianCount
            ? { beauticianCount: bestTarget.beauticianCount }
            : {}),
          ...(bestTarget && !clinic.storeScale && bestTarget.storeScale
            ? { storeScale: bestTarget.storeScale }
            : {}),
          ...(bestTarget && !clinic.trafficPrice && bestTarget.trafficPrice
            ? { trafficPrice: bestTarget.trafficPrice }
            : {}),
        },
      });

      if (matchingTargets.length > 0) {
        await tx.visitPlanTarget.updateMany({
          where: { id: { in: matchingTargets.map((x) => x.id) } },
          data: {
            linkedClinicId: clinic.id,
            conversionStatus: TargetConversionStatus.CONVERTED,
            convertedAt: now,
            ...(opts.orderId ? { convertedOrderId: opts.orderId } : {}),
          },
        });
      }

      if (wasProspect) {
        await tx.clinicProtectionLog.create({
          data: {
            clinicId: clinic.id,
            orgId: clinic.ownerOrgId || opts.operator?.orgId || null,
            action: 'UPGRADE_BOUND',
            operatorId: opts.operator?.userId || null,
            serverTimestamp: now,
            remark: opts.reason || '新客首单转化升级为合作老客',
          },
        });

        await tx.auditLog.create({
          data: {
            orgId: clinic.ownerOrgId || opts.operator?.orgId || null,
            operatorId: opts.operator?.userId || null,
            operatorName: opts.operator?.realName || '系统自动',
            roleCode: opts.operator?.roleCode || null,
            module: 'CRM',
            action: 'CONVERT_TO_EXISTING',
            targetType: 'Clinic',
            targetId: clinic.id,
            summary: `新客转老客 · ${clinic.name}${opts.orderDocNo ? `（单号 ${opts.orderDocNo}）` : ''} · ${opts.reason || '自动转化归档'}`,
            diffSnapshot: {
              before: { lifecycleStage: clinic.lifecycleStage },
              after: { lifecycleStage: CustomerLifecycleStage.EXISTING_ACTIVE },
              archivedTargetCount: matchingTargets.length,
              orderDocNo: opts.orderDocNo || null,
            },
          },
        });
      }

      return rec;
    });

    return updatedClinic;
  }

  async getMeta(user: AuthUser) {
    const [orgs, users, targetReps, targetMonths, clinicReps] = await Promise.all([
      this.prisma.organization.findMany({
        where: user.orgType === 'HQ' ? { type: 'DEALER' } : { id: user.orgId },
        select: { id: true, name: true, code: true, city: true, province: true, regionCodes: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.findMany({
        where: user.orgType === 'HQ' ? {} : { orgId: user.orgId },
        select: { id: true, realName: true, username: true, orgId: true, roleCode: true },
        orderBy: { realName: 'asc' },
      }),
      this.prisma.visitPlanTarget.findMany({
        where: user.orgType === 'HQ' ? {} : { orgId: user.orgId },
        select: { salesRepName: true, orgId: true },
        distinct: ['salesRepName', 'orgId'],
      }),
      this.prisma.visitPlanTarget.findMany({
        where: user.orgType === 'HQ' ? {} : { orgId: user.orgId },
        select: { planMonth: true },
        distinct: ['planMonth'],
        orderBy: { planMonth: 'desc' },
      }),
      this.prisma.clinic.findMany({
        where: user.orgType === 'HQ' ? { salesRepName: { not: null } } : { ownerOrgId: user.orgId, salesRepName: { not: null } },
        select: { salesRepName: true },
        distinct: ['salesRepName'],
      }),
    ]);

    const repSet = new Set<string>();
    for (const r of targetReps) {
      if (r.salesRepName) repSet.add(r.salesRepName);
    }
    for (const c of clinicReps) {
      if (c.salesRepName) repSet.add(c.salesRepName);
    }
    for (const u of users) {
      if (u.roleCode === 'SALES_REP' || u.roleCode === 'DEALER_ADMIN') {
        repSet.add(u.realName.replace(/（.*?）/g, ''));
      }
    }

    const months = Array.from(new Set([defaultPlanMonth(), ...targetMonths.map((m) => m.planMonth)])).sort(
      (a, b) => b.localeCompare(a),
    );

    return {
      dealers: orgs,
      salesReps: Array.from(repSet).sort(),
      months,
      currentMonth: defaultPlanMonth(),
      scoringDimensions: STORE_SCORING_DIMENSIONS,
      gradeRules: STORE_GRADE_RULES,
      leadSources: LEAD_SOURCE_OPTIONS,
      contactRoles: CONTACT_ROLE_OPTIONS,
      cityMeetingOptions: CITY_MEETING_OPTIONS,
      dealStatusOptions: DEAL_STATUS_OPTIONS,
      nanchangDistricts: NANCHANG_DISTRICTS,
      existingVisitTypes: EXISTING_VISIT_TYPE_OPTIONS,
      repurchaseIntents: REPURCHASE_INTENT_OPTIONS,
    };
  }

  // ======================== 1. New Prospect Targets (新客开发) ========================

  async listTargets(
    user: AuthUser,
    query: {
      orgId?: string;
      salesRepName?: string;
      planMonth?: string;
      grade?: string;
      keyword?: string;
      onlyCompleted?: string;
      includeConverted?: string;
      page?: string;
      pageSize?: string;
    },
  ) {
    const orgId = this.resolveTargetOrgId(user, query.orgId);
    const where: any = {};
    if (orgId) where.orgId = orgId;
    if (query.salesRepName?.trim()) where.salesRepName = query.salesRepName.trim();
    if (query.planMonth?.trim()) where.planMonth = query.planMonth.trim();
    if (query.grade?.trim()) where.storeGrade = query.grade.trim();
    if (query.onlyCompleted === 'true') where.isCompleted = true;
    // Key anti-clutter rule: exclude converted existing clients from daily new-prospect table by default
    if (query.includeConverted !== 'true') {
      where.conversionStatus = TargetConversionStatus.IN_PROGRESS;
    }
    if (query.keyword?.trim()) {
      const kw = query.keyword.trim();
      where.OR = [
        { clinicName: { contains: kw, mode: 'insensitive' } },
        { cityRegion: { contains: kw, mode: 'insensitive' } },
        { leadSource: { contains: kw, mode: 'insensitive' } },
        { salesRepName: { contains: kw, mode: 'insensitive' } },
      ];
    }

    const pg = parsePagination(query, 20);
    const [total, rows, orgs] = await Promise.all([
      pg.enabled ? this.prisma.visitPlanTarget.count({ where }) : Promise.resolve(0),
      this.prisma.visitPlanTarget.findMany({
        where,
        include: {
          _count: { select: { followUps: true } },
          followUps: { orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }], take: 1 },
        },
        orderBy: [{ createdAt: 'asc' }],
        skip: pg.enabled ? pg.skip : undefined,
        take: pg.enabled ? pg.pageSize : 500,
      }),
      this.prisma.organization.findMany({ select: { id: true, name: true, code: true } }),
    ]);

    const orgMap = new Map(orgs.map((o) => [o.id, o]));
    const items = rows.map((r) => ({
      ...r,
      orgName: orgMap.get(r.orgId)?.name || '总部',
      followUpCount: r._count.followUps,
      latestFollowUp: r.followUps[0] || null,
    }));
    if (pg.enabled) {
      return { items, total, page: pg.page, pageSize: pg.pageSize };
    }
    return items;
  }

  async createTarget(
    user: AuthUser,
    body: {
      orgId?: string;
      salesRepName?: string;
      planMonth?: string;
      clinicName: string;
      cityRegion: string;
      leadSource?: string;
      plannedVisitDate?: string;
      storeType?: string;
      trafficPrice?: string;
      storeArea?: string;
      beauticianCount?: string;
      storeScale?: string;
    },
  ) {
    const clinicName = body.clinicName?.trim();
    if (!clinicName) throw new BadRequestException('请填写机构/门店名称');

    const orgId = await this.ensureDefaultOrgId(user, body.orgId);
    const salesRepName =
      body.salesRepName?.trim() || user.realName.replace(/（.*?）/g, '') || user.username;
    const planMonth = body.planMonth?.trim() || defaultPlanMonth();
    const evalRes = evaluateStoreVisitTarget({
      clinicName,
      cityRegion: body.cityRegion,
      storeType: body.storeType,
      trafficPrice: body.trafficPrice,
      storeArea: body.storeArea,
      beauticianCount: body.beauticianCount,
      storeScale: body.storeScale,
    });

    const clinic = await this.findOrCreateProspectClinic({
      orgId,
      name: clinicName,
      cityRegion: body.cityRegion,
      salesRepId: user.userId,
      salesRepName,
      leadSource: body.leadSource,
      storeType: body.storeType,
      trafficPrice: body.trafficPrice,
      storeArea: body.storeArea,
      beauticianCount: body.beauticianCount,
      storeScale: body.storeScale,
    });

    const isAlreadyExisting = clinic.lifecycleStage !== CustomerLifecycleStage.PROSPECT;

    const created = await this.prisma.visitPlanTarget.create({
      data: {
        orgId,
        salesRepId: user.userId,
        salesRepName,
        planMonth,
        clinicName,
        cityRegion: body.cityRegion?.trim() || '',
        leadSource: body.leadSource?.trim() || null,
        plannedVisitDate: body.plannedVisitDate?.trim() || null,
        storeType: body.storeType?.trim() || null,
        storeTypeScore: evalRes.storeTypeScore,
        trafficPrice: body.trafficPrice?.trim() || null,
        trafficPriceScore: evalRes.trafficPriceScore,
        storeArea: body.storeArea?.trim() || null,
        storeAreaScore: evalRes.storeAreaScore,
        beauticianCount: body.beauticianCount?.trim() || null,
        beauticianScore: evalRes.beauticianScore,
        storeScale: body.storeScale?.trim() || null,
        storeScaleScore: evalRes.storeScaleScore,
        totalScore: evalRes.totalScore,
        storeGrade: evalRes.storeGrade,
        actionAdvice: evalRes.actionAdvice,
        isCompleted: evalRes.isCompleted,
        validationText: evalRes.validationText,
        linkedClinicId: clinic.id,
        conversionStatus: isAlreadyExisting
          ? TargetConversionStatus.CONVERTED
          : TargetConversionStatus.IN_PROGRESS,
        convertedAt: isAlreadyExisting ? clinic.convertedAt || new Date() : null,
      },
    });

    await this.prisma.visitFollowUpLog.updateMany({
      where: { orgId, customerName: clinicName, targetId: null },
      data: {
        targetId: created.id,
        clinicId: clinic.id,
        cityRegion: created.cityRegion || '未匹配',
        storeType: created.storeType,
        storeArea: stripAreaPrefix(created.storeArea),
      },
    });

    return created;
  }

  async updateTarget(
    user: AuthUser,
    id: string,
    body: Partial<{
      orgId: string;
      salesRepName: string;
      planMonth: string;
      clinicName: string;
      cityRegion: string;
      leadSource: string;
      plannedVisitDate: string;
      storeType: string;
      trafficPrice: string;
      storeArea: string;
      beauticianCount: string;
      storeScale: string;
    }>,
  ) {
    const existing = await this.prisma.visitPlanTarget.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('拜访目标记录不存在');
    if (user.orgType !== 'HQ' && existing.orgId !== user.orgId) {
      throw new ForbiddenException('无权修改其他代理商的客户记录');
    }

    const merged = {
      clinicName: body.clinicName !== undefined ? body.clinicName.trim() : existing.clinicName,
      cityRegion: body.cityRegion !== undefined ? body.cityRegion.trim() : existing.cityRegion,
      storeType: body.storeType !== undefined ? body.storeType : existing.storeType,
      trafficPrice: body.trafficPrice !== undefined ? body.trafficPrice : existing.trafficPrice,
      storeArea: body.storeArea !== undefined ? body.storeArea : existing.storeArea,
      beauticianCount:
        body.beauticianCount !== undefined ? body.beauticianCount : existing.beauticianCount,
      storeScale: body.storeScale !== undefined ? body.storeScale : existing.storeScale,
    };

    const evalRes = evaluateStoreVisitTarget(merged);

    const updated = await this.prisma.visitPlanTarget.update({
      where: { id },
      data: {
        ...(user.orgType === 'HQ' && body.orgId ? { orgId: body.orgId } : {}),
        ...(body.salesRepName !== undefined ? { salesRepName: body.salesRepName.trim() } : {}),
        ...(body.planMonth !== undefined ? { planMonth: body.planMonth.trim() } : {}),
        clinicName: merged.clinicName,
        cityRegion: merged.cityRegion,
        ...(body.leadSource !== undefined ? { leadSource: body.leadSource || null } : {}),
        ...(body.plannedVisitDate !== undefined ? { plannedVisitDate: body.plannedVisitDate || null } : {}),
        storeType: merged.storeType || null,
        storeTypeScore: evalRes.storeTypeScore,
        trafficPrice: merged.trafficPrice || null,
        trafficPriceScore: evalRes.trafficPriceScore,
        storeArea: merged.storeArea || null,
        storeAreaScore: evalRes.storeAreaScore,
        beauticianCount: merged.beauticianCount || null,
        beauticianScore: evalRes.beauticianScore,
        storeScale: merged.storeScale || null,
        storeScaleScore: evalRes.storeScaleScore,
        totalScore: evalRes.totalScore,
        storeGrade: evalRes.storeGrade,
        actionAdvice: evalRes.actionAdvice,
        isCompleted: evalRes.isCompleted,
        validationText: evalRes.validationText,
      },
    });

    if (updated.linkedClinicId) {
      const linked = await this.prisma.clinic.findUnique({ where: { id: updated.linkedClinicId } });
      if (linked && linked.lifecycleStage === CustomerLifecycleStage.PROSPECT) {
        await this.prisma.clinic.update({
          where: { id: linked.id },
          data: {
            name: updated.clinicName,
            city: updated.cityRegion || linked.city,
            salesRepName: updated.salesRepName,
            leadSource: updated.leadSource,
            storeType: updated.storeType,
            trafficPrice: updated.trafficPrice,
            storeArea: updated.storeArea,
            beauticianCount: updated.beauticianCount,
            storeScale: updated.storeScale,
          },
        });
      }
    }

    return updated;
  }

  async deleteTarget(user: AuthUser, id: string) {
    const existing = await this.prisma.visitPlanTarget.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('记录不存在');
    if (user.orgType !== 'HQ' && existing.orgId !== user.orgId) {
      throw new ForbiddenException('无权删除其他代理商的记录');
    }
    await this.prisma.visitPlanTarget.delete({ where: { id } });
    return { deleted: true };
  }

  async batchImportTargets(
    user: AuthUser,
    body: {
      orgId?: string;
      salesRepName?: string;
      planMonth?: string;
      rows: Array<{
        clinicName: string;
        cityRegion?: string;
        leadSource?: string;
        plannedVisitDate?: string;
        storeType?: string;
        trafficPrice?: string;
        storeArea?: string;
        beauticianCount?: string;
        storeScale?: string;
      }>;
    },
  ) {
    let created = 0;
    for (const r of body.rows || []) {
      if (!r.clinicName?.trim()) continue;
      await this.createTarget(user, {
        orgId: body.orgId,
        salesRepName: body.salesRepName,
        planMonth: body.planMonth,
        clinicName: r.clinicName,
        cityRegion: r.cityRegion || '',
        leadSource: r.leadSource,
        plannedVisitDate: r.plannedVisitDate,
        storeType: r.storeType,
        trafficPrice: r.trafficPrice,
        storeArea: r.storeArea,
        beauticianCount: r.beauticianCount,
        storeScale: r.storeScale,
      });
      created++;
    }
    return { created };
  }

  async exportTargetsCsv(
    user: AuthUser,
    query: { orgId?: string; salesRepName?: string; planMonth?: string; includeConverted?: string },
  ) {
    const rows = (await this.listTargets(user, query)) as any[];
    const header = [
      '序号',
      '代理商',
      '业务员',
      '月份',
      '机构名称',
      '城市/区域',
      '线索来源',
      '计划拜访日期',
      '①门店类型',
      '类型得分',
      '②引流价格',
      '引流得分',
      '③门店面积',
      '面积得分',
      '④美容师人数',
      '人数得分',
      '⑤门店规模',
      '规模得分',
      '总分(100)',
      '门店等级',
      '转化状态',
      '跟进动作建议',
      '填写校验',
    ];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((r, idx) =>
      [
        idx + 1,
        r.orgName,
        r.salesRepName,
        r.planMonth,
        r.clinicName,
        r.cityRegion,
        r.leadSource || '',
        r.plannedVisitDate || '',
        r.storeType || '',
        r.storeTypeScore,
        r.trafficPrice || '',
        r.trafficPriceScore,
        r.storeArea || '',
        r.storeAreaScore,
        r.beauticianCount || '',
        r.beauticianScore,
        r.storeScale || '',
        r.storeScaleScore,
        r.totalScore,
        r.storeGrade,
        r.conversionStatus === TargetConversionStatus.CONVERTED ? '已转老客' : '开发中',
        r.actionAdvice,
        r.validationText,
      ]
        .map(esc)
        .join(','),
    );
    return {
      filename: `lumina-new-prospects-${query.planMonth || defaultPlanMonth()}.csv`,
      csv: `\ufeff${header.join(',')}\n${lines.join('\n')}`,
    };
  }

  // ======================== 2. Follow-Up Logs (新客跟进 & 老客维护双场景) ========================

  async listFollowUps(
    user: AuthUser,
    query: {
      orgId?: string;
      salesRepName?: string;
      customerName?: string;
      clinicId?: string;
      visitScene?: string;
      dealStatus?: string;
      cityMeetingStatus?: string;
      repurchaseIntent?: string;
      keyword?: string;
    },
  ) {
    const orgId = this.resolveTargetOrgId(user, query.orgId);
    const where: any = {};
    if (orgId) where.orgId = orgId;
    if (query.salesRepName?.trim()) where.salesRepName = query.salesRepName.trim();
    if (query.customerName?.trim()) where.customerName = query.customerName.trim();
    if (query.clinicId?.trim()) where.clinicId = query.clinicId.trim();
    if (query.visitScene?.trim() && query.visitScene !== 'ALL') {
      where.visitScene = query.visitScene.trim();
    }
    if (query.dealStatus?.trim()) where.dealStatus = query.dealStatus.trim();
    if (query.cityMeetingStatus?.trim()) where.cityMeetingStatus = query.cityMeetingStatus.trim();
    if (query.repurchaseIntent?.trim()) where.repurchaseIntent = query.repurchaseIntent.trim();
    if (query.keyword?.trim()) {
      const kw = query.keyword.trim();
      where.OR = [
        { customerName: { contains: kw, mode: 'insensitive' } },
        { contactName: { contains: kw, mode: 'insensitive' } },
        { contactPhone: { contains: kw, mode: 'insensitive' } },
        { visitSummary: { contains: kw, mode: 'insensitive' } },
        { customerNeed: { contains: kw, mode: 'insensitive' } },
      ];
    }

    const pg = parsePagination(query as PageQuery, 20);
    const [total, logs, orgs] = await Promise.all([
      pg.enabled ? this.prisma.visitFollowUpLog.count({ where }) : Promise.resolve(0),
      this.prisma.visitFollowUpLog.findMany({
        where,
        include: {
          target: {
            select: {
              id: true,
              clinicName: true,
              cityRegion: true,
              storeType: true,
              storeArea: true,
              totalScore: true,
              storeGrade: true,
              conversionStatus: true,
            },
          },
          clinic: {
            select: {
              id: true,
              name: true,
              city: true,
              lifecycleStage: true,
            },
          },
        },
        orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }],
        skip: pg.enabled ? pg.skip : undefined,
        take: pg.enabled ? pg.pageSize : 500,
      }),
      this.prisma.organization.findMany({ select: { id: true, name: true } }),
    ]);

    const orgMap = new Map(orgs.map((o) => [o.id, o.name]));
    const items = logs.map((l) => ({
      ...l,
      orgName: orgMap.get(l.orgId) || '总部',
      cityRegion: l.clinic?.city || l.target?.cityRegion || l.cityRegion || '未匹配',
      storeType: l.storeType || l.target?.storeType || null,
      storeArea: l.storeArea || stripAreaPrefix(l.target?.storeArea) || null,
    }));
    if (pg.enabled) {
      return { items, total, page: pg.page, pageSize: pg.pageSize };
    }
    return items;
  }

  async createFollowUp(
    user: AuthUser,
    body: {
      orgId?: string;
      clinicId?: string;
      targetId?: string;
      visitScene?: string;
      salesRepName?: string;
      customerName?: string;
      cityRegion?: string;
      visitDate?: string;
      storeType?: string;
      storeArea?: string;
      contactName?: string;
      contactRole?: string;
      contactPhone?: string;
      wechatId?: string;
      channelSource?: string;
      visitType?: string;
      stockRemainBoxes?: number | null;
      repurchaseIntent?: string;
      visitSummary?: string;
      customerNeed?: string;
      cityMeetingStatus?: string;
      dealStatus?: string;
      extraFields?: Record<string, unknown>;
    },
  ) {
    let clinic = body.clinicId
      ? await this.prisma.clinic.findUnique({ where: { id: body.clinicId } })
      : null;

    let target = body.targetId
      ? await this.prisma.visitPlanTarget.findUnique({ where: { id: body.targetId } })
      : null;

    const customerName = (body.customerName || clinic?.name || target?.clinicName || '').trim();
    if (!customerName) throw new BadRequestException('请填写或选择客户名称');

    const orgId = clinic?.ownerOrgId || target?.orgId || (await this.ensureDefaultOrgId(user, body.orgId));

    if (!clinic && target?.linkedClinicId) {
      clinic = await this.prisma.clinic.findUnique({ where: { id: target.linkedClinicId } });
    }
    if (!clinic) {
      clinic = await this.prisma.clinic.findFirst({
        where: {
          name: { equals: customerName, mode: 'insensitive' },
          OR: [{ ownerOrgId: orgId }, { ownerOrgId: null }],
        },
      });
    }
    if (!target) {
      target = await this.prisma.visitPlanTarget.findFirst({
        where: { orgId, clinicName: { equals: customerName, mode: 'insensitive' } },
        orderBy: { createdAt: 'desc' },
      });
    }

    const visitScene =
      body.visitScene === VisitScene.EXISTING_MAINTENANCE
        ? VisitScene.EXISTING_MAINTENANCE
        : body.visitScene === VisitScene.NEW_PROSPECT
          ? VisitScene.NEW_PROSPECT
          : clinic && clinic.lifecycleStage !== CustomerLifecycleStage.PROSPECT
            ? VisitScene.EXISTING_MAINTENANCE
            : VisitScene.NEW_PROSPECT;

    const today = new Date().toISOString().slice(0, 10);
    const salesRepName =
      body.salesRepName?.trim() ||
      clinic?.salesRepName ||
      target?.salesRepName ||
      user.realName.replace(/（.*?）/g, '') ||
      user.username;

    let stockRemainBoxes: number | null = null;
    if (
      body.stockRemainBoxes !== undefined &&
      body.stockRemainBoxes !== null &&
      String(body.stockRemainBoxes).trim() !== ''
    ) {
      const parsed = Number(body.stockRemainBoxes);
      if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        throw new BadRequestException('余货盒数必须为大于等于 0 的整数');
      }
      stockRemainBoxes = parsed;
    }

    const created = await this.prisma.visitFollowUpLog.create({
      data: {
        orgId,
        clinicId: clinic?.id || null,
        visitScene,
        targetId: target?.id || null,
        salesRepId: user.userId,
        salesRepName,
        customerName,
        cityRegion: clinic?.city || target?.cityRegion || body.cityRegion?.trim() || '未匹配',
        visitDate: body.visitDate?.trim() || today,
        storeType: body.storeType?.trim() || clinic?.storeType || target?.storeType || null,
        storeArea: body.storeArea?.trim() || stripAreaPrefix(clinic?.storeArea || target?.storeArea) || null,
        contactName: body.contactName?.trim() || clinic?.contactName || null,
        contactRole: body.contactRole?.trim() || clinic?.contactRole || null,
        contactPhone: body.contactPhone?.trim() || clinic?.contactPhone || null,
        wechatId: body.wechatId?.trim() || clinic?.wechatId || null,
        channelSource: body.channelSource?.trim() || clinic?.leadSource || target?.leadSource || null,
        visitType: body.visitType?.trim() || null,
        stockRemainBoxes,
        repurchaseIntent: body.repurchaseIntent?.trim() || null,
        visitSummary: body.visitSummary?.trim() || null,
        customerNeed: body.customerNeed?.trim() || null,
        cityMeetingStatus: body.cityMeetingStatus?.trim() || null,
        dealStatus: body.dealStatus?.trim() || null,
        extraFields: (body.extraFields || {}) as unknown as object,
      },
    });

    // Sync contact updates back to Clinic master record if currently empty
    if (clinic) {
      const clinicPatch: Record<string, unknown> = {};
      if (!clinic.contactName && body.contactName?.trim()) clinicPatch.contactName = body.contactName.trim();
      if (!clinic.contactRole && body.contactRole?.trim()) clinicPatch.contactRole = body.contactRole.trim();
      if (!clinic.contactPhone && body.contactPhone?.trim()) clinicPatch.contactPhone = body.contactPhone.trim();
      if (!clinic.wechatId && body.wechatId?.trim()) clinicPatch.wechatId = body.wechatId.trim();
      if (Object.keys(clinicPatch).length) {
        await this.prisma.clinic.update({ where: { id: clinic.id }, data: clinicPatch });
      }
    }

    return created;
  }

  async updateFollowUp(
    user: AuthUser,
    id: string,
    body: Partial<{
      visitDate: string;
      contactName: string;
      contactRole: string;
      contactPhone: string;
      wechatId: string;
      visitType: string;
      stockRemainBoxes: number | null;
      repurchaseIntent: string;
      visitSummary: string;
      customerNeed: string;
      cityMeetingStatus: string;
      dealStatus: string;
      extraFields: Record<string, unknown>;
    }>,
  ) {
    const existing = await this.prisma.visitFollowUpLog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('跟进记录不存在');
    if (user.orgType !== 'HQ' && existing.orgId !== user.orgId) {
      throw new ForbiddenException('无权修改其他代理商的跟进记录');
    }

    const updated = await this.prisma.visitFollowUpLog.update({
      where: { id },
      data: {
        ...(body.visitDate !== undefined ? { visitDate: body.visitDate } : {}),
        ...(body.contactName !== undefined ? { contactName: body.contactName || null } : {}),
        ...(body.contactRole !== undefined ? { contactRole: body.contactRole || null } : {}),
        ...(body.contactPhone !== undefined ? { contactPhone: body.contactPhone || null } : {}),
        ...(body.wechatId !== undefined ? { wechatId: body.wechatId || null } : {}),
        ...(body.visitType !== undefined ? { visitType: body.visitType || null } : {}),
        ...(body.stockRemainBoxes !== undefined
          ? {
              stockRemainBoxes: (() => {
                if (body.stockRemainBoxes === null || String(body.stockRemainBoxes).trim() === '') {
                  return null;
                }
                const parsed = Number(body.stockRemainBoxes);
                if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
                  throw new BadRequestException('余货盒数必须为大于等于 0 的整数');
                }
                return parsed;
              })(),
            }
          : {}),
        ...(body.repurchaseIntent !== undefined ? { repurchaseIntent: body.repurchaseIntent || null } : {}),
        ...(body.visitSummary !== undefined ? { visitSummary: body.visitSummary || null } : {}),
        ...(body.customerNeed !== undefined ? { customerNeed: body.customerNeed || null } : {}),
        ...(body.cityMeetingStatus !== undefined ? { cityMeetingStatus: body.cityMeetingStatus || null } : {}),
        ...(body.dealStatus !== undefined ? { dealStatus: body.dealStatus || null } : {}),
        ...(body.extraFields !== undefined ? { extraFields: body.extraFields as unknown as object } : {}),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        orgId: existing.orgId,
        operatorId: user.userId,
        operatorName: user.realName,
        roleCode: user.roleCode,
        module: 'CRM',
        action: 'FOLLOWUP_UPDATE',
        targetType: 'VisitFollowUpLog',
        targetId: id,
        summary: `修改跟进记录 · ${existing.customerName}（${updated.visitDate}）`,
        diffSnapshot: {
          before: { visitSummary: existing.visitSummary, customerNeed: existing.customerNeed, repurchaseIntent: existing.repurchaseIntent },
          after: { visitSummary: updated.visitSummary, customerNeed: updated.customerNeed, repurchaseIntent: updated.repurchaseIntent },
        },
      },
    });

    return updated;
  }

  async deleteFollowUp(user: AuthUser, id: string) {
    const existing = await this.prisma.visitFollowUpLog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('跟进记录不存在');
    if (user.orgType !== 'HQ' && existing.orgId !== user.orgId) {
      throw new ForbiddenException('无权删除其他代理商的跟进记录');
    }
    await this.prisma.visitFollowUpLog.delete({ where: { id } });
    return { deleted: true };
  }

  // ======================== 3. Existing Client Maintenance Dashboard (老客维护看板) ========================

  async getExistingClientsDashboard(
    user: AuthUser,
    query: { orgId?: string; salesRepName?: string; planMonth?: string; keyword?: string },
  ) {
    const orgId = this.resolveTargetOrgId(user, query.orgId);
    const planMonth = query.planMonth?.trim() || defaultPlanMonth();
    const repFilter = query.salesRepName?.trim() || '';
    const kw = query.keyword?.trim().toLowerCase() || '';

    const clinicWhere: any = {
      lifecycleStage: {
        in: [CustomerLifecycleStage.EXISTING_ACTIVE, CustomerLifecycleStage.EXISTING_DORMANT],
      },
    };
    if (orgId) clinicWhere.ownerOrgId = orgId;
    if (repFilter) clinicWhere.salesRepName = repFilter;

    const [clinics, orgs] = await Promise.all([
      this.prisma.clinic.findMany({
        where: clinicWhere,
        include: {
          ownerOrg: { select: { id: true, name: true } },
          salesOrders: {
            where: {
              orderScene: 'DEALER_TO_CLINIC',
              status: { in: ['PENDING_OUTBOUND', 'PARTIAL_OUTBOUND', 'COMPLETED'] },
            },
            orderBy: { bizDate: 'desc' },
            select: { id: true, docNo: true, bizDate: true, totalAmount: true, status: true },
          },
          followUpLogs: {
            where: { visitScene: VisitScene.EXISTING_MAINTENANCE },
            orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }],
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.organization.findMany({ select: { id: true, name: true } }),
    ]);

    const orgMap = new Map(orgs.map((o) => [o.id, o.name]));
    const now = new Date();

    const enriched = clinics
      .map((c) => {
        const orders = c.salesOrders || [];
        const totalOrderCount = orders.length;
        const totalOrderAmount = Number(
          orders.reduce((s, o) => s + Number(o.totalAmount || 0), 0).toFixed(2),
        );
        const monthOrders = orders.filter((o) => o.bizDate.toISOString().slice(0, 7) === planMonth);
        const monthOrderCount = monthOrders.length;
        const monthOrderAmount = Number(
          monthOrders.reduce((s, o) => s + Number(o.totalAmount || 0), 0).toFixed(2),
        );

        const latestOrderDate = orders[0]?.bizDate || c.lastOrderAt || c.firstOrderAt;
        const daysSinceLastOrder = daysBetween(latestOrderDate, now);

        const visits = c.followUpLogs || [];
        const latestVisit = visits[0] || null;
        const daysSinceLastVisit = latestVisit ? daysBetween(latestVisit.visitDate, now) : null;
        const visitedThisMonth = visits.some((v) => v.visitDate.startsWith(planMonth));

        const health = evaluateExistingClientHealth({
          daysSinceLastOrder,
          daysSinceLastVisit,
          latestRepurchaseIntent: latestVisit?.repurchaseIntent || null,
        });

        return {
          id: c.id,
          name: c.name,
          city: c.city,
          orgId: c.ownerOrgId || '',
          orgName: c.ownerOrg?.name || orgMap.get(c.ownerOrgId || '') || '未归属',
          salesRepName: c.salesRepName || latestVisit?.salesRepName || '未指定',
          contactName: c.contactName || '',
          contactPhone: c.contactPhone || '',
          wechatId: c.wechatId || '',
          bindStatus: c.bindStatus,
          lifecycleStage:
            health.healthGrade === '沉睡预警'
              ? CustomerLifecycleStage.EXISTING_DORMANT
              : CustomerLifecycleStage.EXISTING_ACTIVE,
          firstOrderAt: c.firstOrderAt,
          lastOrderAt: latestOrderDate,
          daysSinceLastOrder,
          totalOrderCount,
          totalOrderAmount,
          monthOrderCount,
          monthOrderAmount,
          arrearsAmount: Number(c.arrearsAmount || 0),
          visitCount: visits.length,
          visitedThisMonth,
          latestVisitDate: latestVisit?.visitDate || null,
          latestVisitType: latestVisit?.visitType || null,
          latestStockRemainBoxes: latestVisit?.stockRemainBoxes ?? null,
          latestRepurchaseIntent: latestVisit?.repurchaseIntent || null,
          latestVisitSummary: latestVisit?.visitSummary || null,
          healthScore: health.healthScore,
          healthGrade: health.healthGrade,
          healthAdvice: health.advice,
          healthBreakdown: health,
          hasInitialScoreSnapshot: Boolean(c.initialScoreSnapshot),
        };
      })
      .filter((row) => {
        if (!kw) return true;
        return (
          row.name.toLowerCase().includes(kw) ||
          row.city.toLowerCase().includes(kw) ||
          row.contactName.toLowerCase().includes(kw) ||
          row.contactPhone.toLowerCase().includes(kw) ||
          row.salesRepName.toLowerCase().includes(kw)
        );
      })
      .sort((a, b) => {
        // Surface dormant alerts first, then higher order volume
        const pa = a.healthGrade === '沉睡预警' ? 0 : a.healthGrade === '常规维护' ? 1 : 2;
        const pb = b.healthGrade === '沉睡预警' ? 0 : b.healthGrade === '常规维护' ? 1 : 2;
        return pa - pb || a.healthScore - b.healthScore || b.totalOrderAmount - a.totalOrderAmount;
      });

    const totalExistingCount = enriched.length;
    const dormantCount = enriched.filter((x) => x.healthGrade === '沉睡预警').length;
    const activeCount = totalExistingCount - dormantCount;
    const visitedThisMonthCount = enriched.filter((x) => x.visitedThisMonth).length;
    const monthRepurchaseAmount = Number(
      enriched.reduce((s, x) => s + x.monthOrderAmount, 0).toFixed(2),
    );
    const monthRepurchaseOrders = enriched.reduce((s, x) => s + x.monthOrderCount, 0);
    const summaryPerf = evaluateExistingMaintenancePerf(visitedThisMonthCount, totalExistingCount);

    // Rep leaderboard
    const repMap = new Map<
      string,
      {
        orgId: string;
        orgName: string;
        salesRepName: string;
        totalClients: number;
        visitedThisMonth: number;
        dormantCount: number;
        monthRepurchaseAmount: number;
      }
    >();
    for (const c of enriched) {
      const key = `${c.orgId}::${c.salesRepName}`;
      const cur = repMap.get(key) || {
        orgId: c.orgId,
        orgName: c.orgName,
        salesRepName: c.salesRepName,
        totalClients: 0,
        visitedThisMonth: 0,
        dormantCount: 0,
        monthRepurchaseAmount: 0,
      };
      cur.totalClients += 1;
      if (c.visitedThisMonth) cur.visitedThisMonth += 1;
      if (c.healthGrade === '沉睡预警') cur.dormantCount += 1;
      cur.monthRepurchaseAmount = Number((cur.monthRepurchaseAmount + c.monthOrderAmount).toFixed(2));
      repMap.set(key, cur);
    }

    const repLeaderboard = Array.from(repMap.values())
      .map((r) => ({
        ...r,
        ...evaluateExistingMaintenancePerf(r.visitedThisMonth, r.totalClients),
      }))
      .sort((a, b) => b.maintenanceScore - a.maintenanceScore || b.monthRepurchaseAmount - a.monthRepurchaseAmount);

    return {
      planMonth,
      kpis: {
        totalExistingCount,
        activeCount,
        dormantCount,
        visitedThisMonthCount,
        coverageRate: summaryPerf.coverageRate,
        maintenanceScore: summaryPerf.maintenanceScore,
        formulaNote: summaryPerf.formulaNote,
        monthRepurchaseAmount,
        monthRepurchaseOrders,
      },
      clients: enriched,
      repLeaderboard,
    };
  }

  // ======================== 4. Unified Customer 360° Center & Editable Profile ========================

  async listCustomers(
    user: AuthUser,
    query: { orgId?: string; stage?: string; salesRepName?: string; keyword?: string },
  ) {
    const orgId = this.resolveTargetOrgId(user, query.orgId);
    const where: any = {};
    if (orgId) {
      where.ownerOrgId = orgId;
    } else if (user.orgType !== 'HQ') {
      where.OR = [{ ownerOrgId: user.orgId }, { bindStatus: ClinicBindStatus.PUBLIC_POOL }];
    }
    if (query.salesRepName?.trim()) {
      where.salesRepName = query.salesRepName.trim();
    }
    if (query.stage === 'PROSPECT') {
      where.lifecycleStage = CustomerLifecycleStage.PROSPECT;
    } else if (query.stage === 'EXISTING') {
      where.lifecycleStage = {
        in: [CustomerLifecycleStage.EXISTING_ACTIVE, CustomerLifecycleStage.EXISTING_DORMANT],
      };
    } else if (query.stage === 'DORMANT') {
      where.lifecycleStage = CustomerLifecycleStage.EXISTING_DORMANT;
    }
    if (query.keyword?.trim()) {
      const kw = query.keyword.trim();
      where.AND = [
        {
          OR: [
            { name: { contains: kw, mode: 'insensitive' } },
            { city: { contains: kw, mode: 'insensitive' } },
            { contactName: { contains: kw, mode: 'insensitive' } },
            { contactPhone: { contains: kw, mode: 'insensitive' } },
            { wechatId: { contains: kw, mode: 'insensitive' } },
            { salesRepName: { contains: kw, mode: 'insensitive' } },
            { remark: { contains: kw, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const pg = parsePagination(query as PageQuery, 20);
    const [total, clinics] = await Promise.all([
      pg.enabled ? this.prisma.clinic.count({ where }) : Promise.resolve(0),
      this.prisma.clinic.findMany({
        where,
        include: {
          ownerOrg: { select: { id: true, name: true } },
          visitTargets: { orderBy: { updatedAt: 'desc' }, take: 1 },
          salesOrders: {
            where: {
              orderScene: 'DEALER_TO_CLINIC',
              status: { in: ['PENDING_OUTBOUND', 'PARTIAL_OUTBOUND', 'COMPLETED'] },
            },
            select: { totalAmount: true, bizDate: true },
            orderBy: { bizDate: 'desc' },
          },
          followUpLogs: {
            orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }],
            take: 5,
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
        skip: pg.enabled ? pg.skip : undefined,
        take: pg.enabled ? pg.pageSize : 300,
      }),
    ]);

    const now = new Date();
    const items = clinics.map((c) => {
      const isExisting = c.lifecycleStage !== CustomerLifecycleStage.PROSPECT;
      const orders = c.salesOrders || [];
      const totalOrderCount = orders.length;
      const totalOrderAmount = Number(
        orders.reduce((s, o) => s + Number(o.totalAmount || 0), 0).toFixed(2),
      );
      const latestOrderDate = orders[0]?.bizDate || c.lastOrderAt || c.firstOrderAt;
      const daysSinceLastOrder = isExisting ? daysBetween(latestOrderDate, now) : null;

      const latestTarget = c.visitTargets[0] || null;
      const prospectEval = evaluateStoreVisitTarget({
        clinicName: c.name,
        cityRegion: c.city,
        storeType: c.storeType || latestTarget?.storeType,
        trafficPrice: c.trafficPrice || latestTarget?.trafficPrice,
        storeArea: c.storeArea || latestTarget?.storeArea,
        beauticianCount: c.beauticianCount || latestTarget?.beauticianCount,
        storeScale: c.storeScale || latestTarget?.storeScale,
      });

      const latestExistingVisit =
        c.followUpLogs.find((f) => f.visitScene === VisitScene.EXISTING_MAINTENANCE) || null;
      const latestAnyVisit = c.followUpLogs[0] || null;
      const healthEval = isExisting
        ? evaluateExistingClientHealth({
            daysSinceLastOrder,
            daysSinceLastVisit: latestExistingVisit ? daysBetween(latestExistingVisit.visitDate, now) : null,
            latestRepurchaseIntent: latestExistingVisit?.repurchaseIntent || null,
          })
        : null;

      return {
        id: c.id,
        name: c.name,
        city: c.city,
        address: c.address || '',
        orgId: c.ownerOrgId || '',
        orgName: c.ownerOrg?.name || '公海 / 未归属',
        salesRepName: c.salesRepName || latestTarget?.salesRepName || '未指定',
        contactName: c.contactName || '',
        contactRole: c.contactRole || '',
        contactPhone: c.contactPhone || '',
        wechatId: c.wechatId || '',
        bindStatus: c.bindStatus,
        lifecycleStage: isExisting
          ? healthEval?.healthGrade === '沉睡预警'
            ? CustomerLifecycleStage.EXISTING_DORMANT
            : CustomerLifecycleStage.EXISTING_ACTIVE
          : CustomerLifecycleStage.PROSPECT,
        isExisting,
        prospectScore: latestTarget?.totalScore ?? prospectEval.totalScore,
        storeGrade: latestTarget?.storeGrade || prospectEval.storeGrade || '',
        healthScore: healthEval?.healthScore ?? null,
        healthGrade: healthEval?.healthGrade || null,
        totalOrderCount,
        totalOrderAmount,
        lastOrderAt: latestOrderDate,
        daysSinceLastOrder,
        followUpCount: c.followUpLogs.length,
        latestVisitDate: latestAnyVisit?.visitDate || null,
        remark: c.remark || '',
        updatedAt: c.updatedAt,
      };
    });
    if (pg.enabled) {
      return { items, total, page: pg.page, pageSize: pg.pageSize };
    }
    return items;
  }

  async getCustomerDetail(user: AuthUser, id: string) {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id },
      include: {
        ownerOrg: { select: { id: true, name: true, code: true } },
        visitTargets: { orderBy: { updatedAt: 'desc' } },
        salesOrders: {
          where: { orderScene: 'DEALER_TO_CLINIC' },
          orderBy: { bizDate: 'desc' },
          take: 15,
          include: { items: { include: { product: { select: { name: true, skuCode: true } } } } },
        },
        followUpLogs: { orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }] },
      },
    });
    if (!clinic) throw new NotFoundException('客户档案不存在');
    if (
      user.orgType !== 'HQ' &&
      clinic.ownerOrgId &&
      clinic.ownerOrgId !== user.orgId &&
      clinic.bindStatus !== ClinicBindStatus.PUBLIC_POOL
    ) {
      throw new ForbiddenException('无权查看其他代理商的客户档案');
    }

    const editHistory = await this.prisma.auditLog.findMany({
      where: { targetType: 'Clinic', targetId: clinic.id },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    const isExisting = clinic.lifecycleStage !== CustomerLifecycleStage.PROSPECT;
    const now = new Date();
    const validOrders = clinic.salesOrders.filter((o) =>
      ['PENDING_OUTBOUND', 'PARTIAL_OUTBOUND', 'COMPLETED'].includes(o.status),
    );
    const totalOrderCount = validOrders.length;
    const totalOrderAmount = Number(
      validOrders.reduce((s, o) => s + Number(o.totalAmount || 0), 0).toFixed(2),
    );
    const latestOrderDate = validOrders[0]?.bizDate || clinic.lastOrderAt || clinic.firstOrderAt;
    const daysSinceLastOrder = isExisting ? daysBetween(latestOrderDate, now) : null;

    const latestTarget = clinic.visitTargets[0] || null;
    const prospectEval = evaluateStoreVisitTarget({
      clinicName: clinic.name,
      cityRegion: clinic.city,
      storeType: clinic.storeType || latestTarget?.storeType,
      trafficPrice: clinic.trafficPrice || latestTarget?.trafficPrice,
      storeArea: clinic.storeArea || latestTarget?.storeArea,
      beauticianCount: clinic.beauticianCount || latestTarget?.beauticianCount,
      storeScale: clinic.storeScale || latestTarget?.storeScale,
    });

    const existingVisits = clinic.followUpLogs.filter(
      (f) => f.visitScene === VisitScene.EXISTING_MAINTENANCE,
    );
    const prospectVisits = clinic.followUpLogs.filter(
      (f) => f.visitScene !== VisitScene.EXISTING_MAINTENANCE,
    );

    const latestExistingVisit = existingVisits[0] || null;
    const healthEval = isExisting
      ? evaluateExistingClientHealth({
          daysSinceLastOrder,
          daysSinceLastVisit: latestExistingVisit ? daysBetween(latestExistingVisit.visitDate, now) : null,
          latestRepurchaseIntent: latestExistingVisit?.repurchaseIntent || null,
        })
      : null;

    const initialScoreSnapshot =
      clinic.initialScoreSnapshot ||
      (isExisting && latestTarget && latestTarget.totalScore > 0 ? buildScoreSnapshot(latestTarget) : null);

    return {
      clinic: {
        id: clinic.id,
        name: clinic.name,
        city: clinic.city,
        address: clinic.address || '',
        contactName: clinic.contactName || '',
        contactRole: clinic.contactRole || '',
        contactPhone: clinic.contactPhone || '',
        wechatId: clinic.wechatId || '',
        salesRepName: clinic.salesRepName || latestTarget?.salesRepName || '',
        leadSource: clinic.leadSource || latestTarget?.leadSource || '',
        storeType: clinic.storeType || latestTarget?.storeType || '',
        trafficPrice: clinic.trafficPrice || latestTarget?.trafficPrice || '',
        storeArea: clinic.storeArea || latestTarget?.storeArea || '',
        beauticianCount: clinic.beauticianCount || latestTarget?.beauticianCount || '',
        storeScale: clinic.storeScale || latestTarget?.storeScale || '',
        remark: clinic.remark || '',
        customProfile: (clinic.customProfile as Record<string, unknown>) || {},
        bindStatus: clinic.bindStatus,
        lifecycleStage: isExisting
          ? healthEval?.healthGrade === '沉睡预警'
            ? CustomerLifecycleStage.EXISTING_DORMANT
            : CustomerLifecycleStage.EXISTING_ACTIVE
          : CustomerLifecycleStage.PROSPECT,
        firstOrderAt: clinic.firstOrderAt,
        convertedAt: clinic.convertedAt,
        lastOrderAt: latestOrderDate,
        protectExpireAt: clinic.protectExpireAt,
        arrearsAmount: Number(clinic.arrearsAmount || 0),
        ownerOrgId: clinic.ownerOrgId,
      },
      orgName: clinic.ownerOrg?.name || '公海 / 未归属',
      isExisting,
      prospectEval,
      healthEval,
      initialScoreSnapshot,
      orderSummary: {
        totalOrderCount,
        totalOrderAmount,
        daysSinceLastOrder,
        arrearsAmount: Number(clinic.arrearsAmount || 0),
      },
      recentOrders: clinic.salesOrders.slice(0, 10),
      existingVisits,
      prospectVisits,
      followUps: clinic.followUpLogs,
      editHistory,
    };
  }

  /**
   * Editable 360° Customer Profile (allowed for HQ, Dealer Admin, AND Sales Rep within own org).
   * Recalculates 5-dim prospect score if still a prospect, and records exact before/after diff in AuditLog.
   */
  async updateCustomer(
    user: AuthUser,
    id: string,
    body: Partial<{
      name: string;
      city: string;
      address: string;
      contactName: string;
      contactRole: string;
      contactPhone: string;
      wechatId: string;
      salesRepName: string;
      leadSource: string;
      storeType: string;
      trafficPrice: string;
      storeArea: string;
      beauticianCount: string;
      storeScale: string;
      remark: string;
      customProfile: Record<string, unknown>;
    }>,
  ) {
    const existing = await this.prisma.clinic.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('客户档案不存在');
    if (
      user.orgType !== 'HQ' &&
      existing.ownerOrgId &&
      existing.ownerOrgId !== user.orgId
    ) {
      throw new ForbiddenException('无权修改其他服务商的客户档案');
    }

    const fieldLabels: Record<string, string> = {
      name: '机构名称',
      city: '城市/区域',
      address: '详细地址',
      contactName: '联系人',
      contactRole: '联系人职位',
      contactPhone: '联系电话',
      wechatId: '微信号',
      salesRepName: '负责业务员',
      leadSource: '线索来源',
      storeType: '门店类型',
      trafficPrice: '引流价格',
      storeArea: '门店面积',
      beauticianCount: '美容师人数',
      storeScale: '门店规模',
      remark: '客情备注',
    };

    const updateData: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const changedLabels: string[] = [];

    for (const key of Object.keys(fieldLabels)) {
      if ((body as any)[key] !== undefined) {
        const nextVal = String((body as any)[key] ?? '').trim();
        const prevVal = String((existing as any)[key] ?? '').trim();
        if (nextVal !== prevVal) {
          before[key] = prevVal;
          after[key] = nextVal;
          changedLabels.push(fieldLabels[key]);
          if (key === 'name') {
            if (!nextVal) throw new BadRequestException('机构名称不能为空');
            updateData.name = nextVal;
          } else if (key === 'city') {
            if (!nextVal) throw new BadRequestException('城市/区域不能为空');
            updateData.city = nextVal;
            updateData.cityCode = extractCityName(nextVal);
          } else {
            updateData[key] = nextVal || null;
          }
        }
      }
    }

    if (body.customProfile !== undefined && typeof body.customProfile === 'object' && body.customProfile !== null) {
      const prevCustom = (existing.customProfile as Record<string, unknown>) || {};
      const nextCustom = { ...prevCustom, ...body.customProfile };
      if (JSON.stringify(prevCustom) !== JSON.stringify(nextCustom)) {
        before.customProfile = prevCustom;
        after.customProfile = nextCustom;
        changedLabels.push('扩展档案字段');
        updateData.customProfile = nextCustom as unknown as object;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return this.getCustomerDetail(user, id);
    }

    const updated = await this.prisma.clinic.update({
      where: { id },
      data: updateData,
    });

    // If still a PROSPECT, sync scoring & basic info back to active VisitPlanTarget
    if (updated.lifecycleStage === CustomerLifecycleStage.PROSPECT) {
      const evalRes = evaluateStoreVisitTarget({
        clinicName: updated.name,
        cityRegion: updated.city,
        storeType: updated.storeType,
        trafficPrice: updated.trafficPrice,
        storeArea: updated.storeArea,
        beauticianCount: updated.beauticianCount,
        storeScale: updated.storeScale,
      });

      const activeTarget = await this.prisma.visitPlanTarget.findFirst({
        where: { linkedClinicId: updated.id, conversionStatus: TargetConversionStatus.IN_PROGRESS },
        orderBy: { updatedAt: 'desc' },
      });

      if (activeTarget) {
        await this.prisma.visitPlanTarget.update({
          where: { id: activeTarget.id },
          data: {
            clinicName: updated.name,
            cityRegion: updated.city,
            salesRepName: updated.salesRepName || activeTarget.salesRepName,
            leadSource: updated.leadSource,
            storeType: updated.storeType,
            storeTypeScore: evalRes.storeTypeScore,
            trafficPrice: updated.trafficPrice,
            trafficPriceScore: evalRes.trafficPriceScore,
            storeArea: updated.storeArea,
            storeAreaScore: evalRes.storeAreaScore,
            beauticianCount: updated.beauticianCount,
            beauticianScore: evalRes.beauticianScore,
            storeScale: updated.storeScale,
            storeScaleScore: evalRes.storeScaleScore,
            totalScore: evalRes.totalScore,
            storeGrade: evalRes.storeGrade,
            actionAdvice: evalRes.actionAdvice,
            isCompleted: evalRes.isCompleted,
            validationText: evalRes.validationText,
          },
        });
      }
    }

    await this.prisma.auditLog.create({
      data: {
        orgId: updated.ownerOrgId || user.orgId,
        operatorId: user.userId,
        operatorName: user.realName,
        roleCode: user.roleCode,
        module: 'CRM',
        action: 'CUSTOMER_UPDATE',
        targetType: 'Clinic',
        targetId: updated.id,
        summary: `修改客户档案 · ${updated.name}（变更：${changedLabels.join('、')}）`,
        diffSnapshot: { before, after, changedFields: changedLabels } as any,
      },
    });

    return this.getCustomerDetail(user, id);
  }

  async manualMarkExisting(
    user: AuthUser,
    id: string,
    body: { remark?: string; firstOrderDate?: string } = {},
  ) {
    const clinic = await this.prisma.clinic.findUnique({ where: { id } });
    if (!clinic) throw new NotFoundException('客户档案不存在');
    if (user.orgType !== 'HQ' && clinic.ownerOrgId && clinic.ownerOrgId !== user.orgId) {
      throw new ForbiddenException('无权操作其他代理商的客户');
    }
    const dt = body.firstOrderDate ? new Date(body.firstOrderDate) : new Date();
    const safeDate = Number.isNaN(dt.getTime()) ? new Date() : dt;

    await this.promoteClinicToExisting(id, {
      bizDate: safeDate,
      operator: user,
      reason: body.remark?.trim() || '人工标记为历史老客',
    });

    return this.getCustomerDetail(user, id);
  }

  async batchImportExistingClients(
    user: AuthUser,
    body: {
      orgId?: string;
      salesRepName?: string;
      rows: Array<{
        name: string;
        city?: string;
        contactName?: string;
        contactPhone?: string;
        wechatId?: string;
        salesRepName?: string;
        lastOrderDate?: string;
        remark?: string;
      }>;
    },
  ) {
    const orgId = await this.ensureDefaultOrgId(user, body.orgId);
    const defaultRep =
      body.salesRepName?.trim() || user.realName.replace(/（.*?）/g, '') || user.username;
    let createdCount = 0;
    let upgradedCount = 0;

    for (const r of body.rows || []) {
      const name = (r.name || '').trim();
      if (!name) continue;
      const cityRegion = (r.city || '南昌市').trim();
      const cityCode = extractCityName(cityRegion);
      const fp = buildClinicFingerprint({
        name,
        cityCode,
        contactPhone: r.contactPhone,
      });

      const lastOrderDt = r.lastOrderDate ? new Date(r.lastOrderDate) : null;
      const validOrderDt = lastOrderDt && !Number.isNaN(lastOrderDt.getTime()) ? lastOrderDt : new Date();

      let clinic = await this.prisma.clinic.findFirst({
        where: {
          OR: [
            { fingerprint: fp },
            { name: { equals: name, mode: 'insensitive' }, ownerOrgId: orgId },
          ],
        },
      });

      if (!clinic) {
        clinic = await this.prisma.clinic.create({
          data: {
            name,
            fingerprint: fp,
            city: cityRegion,
            cityCode,
            contactName: r.contactName?.trim() || null,
            contactPhone: r.contactPhone?.trim() || null,
            wechatId: r.wechatId?.trim() || null,
            ownerOrgId: orgId,
            ownerSalesId: user.userId,
            salesRepName: r.salesRepName?.trim() || defaultRep,
            bindStatus: ClinicBindStatus.BOUND_ACTIVE,
            lifecycleStage: CustomerLifecycleStage.EXISTING_ACTIVE,
            reportedAt: validOrderDt,
            firstOrderAt: validOrderDt,
            convertedAt: new Date(),
            lastOrderAt: lastOrderDt && !Number.isNaN(lastOrderDt.getTime()) ? lastOrderDt : null,
            remark: r.remark?.trim() || '历史老客批量导入',
          },
        });
        createdCount++;
      } else {
        await this.prisma.clinic.update({
          where: { id: clinic.id },
          data: {
            ownerOrgId: clinic.ownerOrgId || orgId,
            salesRepName: r.salesRepName?.trim() || clinic.salesRepName || defaultRep,
            contactName: r.contactName?.trim() || clinic.contactName,
            contactPhone: r.contactPhone?.trim() || clinic.contactPhone,
            wechatId: r.wechatId?.trim() || clinic.wechatId,
            remark: r.remark?.trim() || clinic.remark,
          },
        });
        upgradedCount++;
      }

      await this.promoteClinicToExisting(clinic.id, {
        bizDate: validOrderDt,
        operator: user,
        reason: '历史老客批量导入',
      });
    }

    await this.prisma.auditLog.create({
      data: {
        orgId,
        operatorId: user.userId,
        operatorName: user.realName,
        roleCode: user.roleCode,
        module: 'CRM',
        action: 'IMPORT_EXISTING_CLIENTS',
        targetType: 'Clinic',
        summary: `批量导入历史老客 · 新增 ${createdCount} 家，升级已有档案 ${upgradedCount} 家`,
        diffSnapshot: { createdCount, upgradedCount },
      },
    });

    return { createdCount, upgradedCount, total: createdCount + upgradedCount };
  }

  // ======================== 5. Legacy Customer 360° Lookup (Compatible Wrapper) ========================

  async getCustomerProfile(
    user: AuthUser,
    query: { targetId?: string; customerName?: string; orgId?: string },
  ) {
    const orgId = this.resolveTargetOrgId(user, query.orgId);

    let target = query.targetId
      ? await this.prisma.visitPlanTarget.findUnique({ where: { id: query.targetId } })
      : null;

    if (!target && query.customerName?.trim()) {
      target = await this.prisma.visitPlanTarget.findFirst({
        where: {
          ...(orgId ? { orgId } : {}),
          clinicName: query.customerName.trim(),
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    const name = target?.clinicName || query.customerName?.trim();
    if (!name) throw new BadRequestException('请选择或输入客户名称');
    if (target && user.orgType !== 'HQ' && target.orgId !== user.orgId) {
      throw new ForbiddenException('无权查看其他代理商客户');
    }

    const clinic = target?.linkedClinicId
      ? await this.prisma.clinic.findUnique({ where: { id: target.linkedClinicId } })
      : await this.prisma.clinic.findFirst({
          where: {
            ...(orgId ? { ownerOrgId: orgId } : {}),
            name: { equals: name, mode: 'insensitive' },
          },
        });

    const followUps = await this.prisma.visitFollowUpLog.findMany({
      where: {
        ...(clinic
          ? { OR: [{ clinicId: clinic.id }, ...(target ? [{ targetId: target.id }] : [])] }
          : target
            ? { OR: [{ targetId: target.id }, { orgId: target.orgId, customerName: name }] }
            : { ...(orgId ? { orgId } : {}), customerName: name }),
      },
      orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }],
    });

    const latestWithContact = followUps.find((f) => f.contactName || f.contactPhone || f.wechatId);
    const latestDeal = followUps.find((f) => f.dealStatus)?.dealStatus || '未填写';
    const latestMeeting = followUps.find((f) => f.cityMeetingStatus)?.cityMeetingStatus || '未填写';
    const org =
      clinic?.ownerOrgId || target?.orgId || followUps[0]?.orgId
        ? await this.prisma.organization.findUnique({
            where: { id: (clinic?.ownerOrgId || target?.orgId || followUps[0].orgId)! },
            select: { id: true, name: true },
          })
        : null;

    return {
      clinicId: clinic?.id || null,
      lifecycleStage: clinic?.lifecycleStage || CustomerLifecycleStage.PROSPECT,
      customerName: name,
      orgName: org?.name || '—',
      target,
      profile: {
        cityRegion: clinic?.city || target?.cityRegion || followUps[0]?.cityRegion || '未匹配',
        totalScore: target?.totalScore ?? null,
        storeType: clinic?.storeType || target?.storeType || followUps[0]?.storeType || '未填写',
        storeGrade: target?.storeGrade || '未评级',
        actionAdvice: target?.actionAdvice || '完成五维评分后自动生成动作建议',
        storeArea: clinic?.storeArea || target?.storeArea || followUps[0]?.storeArea || '未填写',
        beauticianCount: clinic?.beauticianCount || target?.beauticianCount || '未填写',
        storeScale: clinic?.storeScale || target?.storeScale || '未填写',
        leadSource: clinic?.leadSource || target?.leadSource || followUps[0]?.channelSource || '未填写',
        salesRepName: clinic?.salesRepName || target?.salesRepName || followUps[0]?.salesRepName || '—',
        followUpCount: followUps.length,
        latestVisitDate: followUps[0]?.visitDate || '暂无拜访',
        dealStatus: latestDeal,
        cityMeetingStatus: latestMeeting,
        contactName: clinic?.contactName || latestWithContact?.contactName || '未填写',
        contactRole: clinic?.contactRole || latestWithContact?.contactRole || '',
        contactPhone: clinic?.contactPhone || latestWithContact?.contactPhone || '未填写',
        wechatId: clinic?.wechatId || latestWithContact?.wechatId || '未填写',
      },
      followUps,
    };
  }

  // ======================== 6. New Prospect Monthly Dashboard & 20-Point KPI ========================

  async getDashboard(
    user: AuthUser,
    query: { orgId?: string; salesRepName?: string; planMonth?: string },
  ) {
    const orgId = this.resolveTargetOrgId(user, query.orgId);
    const planMonth = query.planMonth?.trim() || '';
    const repFilter = query.salesRepName?.trim() || '';

    const where: any = {};
    if (orgId) where.orgId = orgId;
    if (planMonth) where.planMonth = planMonth;
    if (repFilter) where.salesRepName = repFilter;

    // Monthly 20-point KPI counts ALL targets scored in the month (including converted ones so reps keep their credit!)
    const [targets, goals, orgs, followUps] = await Promise.all([
      this.prisma.visitPlanTarget.findMany({ where, orderBy: { createdAt: 'asc' } }),
      this.prisma.visitMonthlyGoal.findMany({
        where: {
          ...(orgId ? { orgId } : {}),
          ...(planMonth ? { planMonth } : {}),
          ...(repFilter ? { salesRepName: repFilter } : {}),
        },
      }),
      this.prisma.organization.findMany({
        where: { type: 'DEALER' },
        select: { id: true, name: true, city: true, regionCodes: true },
      }),
      this.prisma.visitFollowUpLog.findMany({
        where: {
          visitScene: VisitScene.NEW_PROSPECT,
          ...(orgId ? { orgId } : {}),
          ...(repFilter ? { salesRepName: repFilter } : {}),
        },
        select: {
          id: true,
          targetId: true,
          customerName: true,
          dealStatus: true,
          cityMeetingStatus: true,
          orgId: true,
          salesRepName: true,
        },
      }),
    ]);

    const orgMap = new Map(orgs.map((o) => [o.id, o]));
    const goalMap = new Map(goals.map((g) => [`${g.orgId}::${g.salesRepName}`, g.targetQuota]));

    const completedTargets = targets.filter((t) => t.isCompleted);
    const activeProspectCount = targets.filter(
      (t) => t.conversionStatus === TargetConversionStatus.IN_PROGRESS,
    ).length;
    const convertedCount = targets.filter(
      (t) => t.conversionStatus === TargetConversionStatus.CONVERTED,
    ).length;
    const coveredRegions = new Set(completedTargets.map((t) => t.cityRegion).filter(Boolean));

    const selectedOrg = orgId ? orgMap.get(orgId) : null;
    const isNanchangScope =
      !selectedOrg || (selectedOrg.city || '').includes('南昌') || selectedOrg.name.includes('南昌');
    const regionOrder: string[] = isNanchangScope ? [...NANCHANG_DISTRICTS] : [];
    for (const t of targets) {
      if (t.cityRegion && !regionOrder.includes(t.cityRegion)) {
        regionOrder.push(t.cityRegion);
      }
    }

    const regionStats = regionOrder.map((region) => {
      const inRegion = targets.filter((t) => t.cityRegion === region);
      const done = inRegion.filter((t) => t.isCompleted);
      return {
        cityRegion: region,
        plannedCount: inRegion.length,
        completedCount: done.length,
        excellentCount: done.filter((t) => t.storeGrade === '优秀门店').length,
        precisionCount: done.filter((t) => t.storeGrade === '精准门店').length,
        validCount: done.filter((t) => t.storeGrade === '有效门店').length,
        mismatchCount: done.filter((t) => t.storeGrade === '暂不匹配').length,
      };
    });

    const completedTotal = completedTargets.length;
    const gradeStats = STORE_GRADE_RULES.map((rule) => {
      const count = completedTargets.filter((t) => t.storeGrade === rule.grade).length;
      return {
        grade: rule.grade,
        count,
        ratio: completedTotal > 0 ? Number((count / completedTotal).toFixed(4)) : 0,
        rangeLabel: rule.rangeLabel,
        actionAdvice: rule.actionAdvice,
      };
    });

    const repBuckets = new Map<
      string,
      {
        orgId: string;
        orgName: string;
        salesRepName: string;
        planned: number;
        completed: number;
        excellent: number;
        converted: number;
        deals: number;
      }
    >();

    for (const t of targets) {
      const key = `${t.orgId}::${t.salesRepName}`;
      const cur = repBuckets.get(key) || {
        orgId: t.orgId,
        orgName: orgMap.get(t.orgId)?.name || '总部',
        salesRepName: t.salesRepName,
        planned: 0,
        completed: 0,
        excellent: 0,
        converted: 0,
        deals: 0,
      };
      cur.planned += 1;
      if (t.isCompleted) cur.completed += 1;
      if (t.isCompleted && t.storeGrade === '优秀门店') cur.excellent += 1;
      if (t.conversionStatus === TargetConversionStatus.CONVERTED) cur.converted += 1;
      repBuckets.set(key, cur);
    }

    const dealCustomersByRep = new Map<string, Set<string>>();
    for (const f of followUps) {
      if (f.dealStatus === '已成交') {
        const key = `${f.orgId}::${f.salesRepName}`;
        const set = dealCustomersByRep.get(key) || new Set<string>();
        set.add(f.customerName);
        dealCustomersByRep.set(key, set);
      }
    }

    const repLeaderboard = Array.from(repBuckets.entries())
      .map(([key, bucket]) => {
        const quota = goalMap.get(key) || 100;
        const perf = evaluateRepPerformance(bucket.completed, quota);
        return {
          ...bucket,
          deals: Math.max(bucket.converted, dealCustomersByRep.get(key)?.size || 0),
          ...perf,
        };
      })
      .sort((a, b) => b.performanceScore - a.performanceScore || b.completed - a.completed);

    const totalTargetQuota = repLeaderboard.length
      ? repLeaderboard.reduce((s, r) => s + r.targetQuota, 0)
      : 100;
    const summaryPerf = evaluateRepPerformance(completedTotal, totalTargetQuota);

    return {
      planMonth: planMonth || '全部月份',
      kpis: {
        targetQuota: totalTargetQuota,
        plannedCount: targets.length,
        activeProspectCount,
        convertedCount,
        completedCount: completedTotal,
        completionRate: summaryPerf.completionRate,
        coveredRegionsCount: coveredRegions.size,
        performanceScore: summaryPerf.performanceScore,
        followUpsCount: followUps.length,
        dealsCount: Math.max(
          convertedCount,
          new Set(followUps.filter((f) => f.dealStatus === '已成交').map((f) => f.customerName)).size,
        ),
      },
      regionStats,
      gradeStats,
      repLeaderboard,
    };
  }

  async upsertMonthlyGoal(
    user: AuthUser,
    body: { orgId?: string; salesRepName: string; planMonth: string; targetQuota: number },
  ) {
    const orgId = user.orgType === 'HQ' && body.orgId ? body.orgId : user.orgId;
    const quota = Math.max(1, Math.min(10000, Number(body.targetQuota) || 100));
    return this.prisma.visitMonthlyGoal.upsert({
      where: {
        orgId_salesRepName_planMonth: {
          orgId,
          salesRepName: body.salesRepName.trim(),
          planMonth: body.planMonth.trim(),
        },
      },
      update: { targetQuota: quota },
      create: {
        orgId,
        salesRepName: body.salesRepName.trim(),
        planMonth: body.planMonth.trim(),
        targetQuota: quota,
      },
    });
  }
}

@Controller('crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Get('meta')
  meta(@CurrentUser() user: AuthUser) {
    return this.crmService.getMeta(user);
  }

  @Get('dashboard')
  dashboard(
    @CurrentUser() user: AuthUser,
    @Query('orgId') orgId?: string,
    @Query('salesRepName') salesRepName?: string,
    @Query('planMonth') planMonth?: string,
  ) {
    return this.crmService.getDashboard(user, { orgId, salesRepName, planMonth });
  }

  @Put('monthly-goal')
  upsertGoal(
    @CurrentUser() user: AuthUser,
    @Body() body: { orgId?: string; salesRepName: string; planMonth: string; targetQuota: number },
  ) {
    return this.crmService.upsertMonthlyGoal(user, body);
  }

  @Get('targets')
  listTargets(
    @CurrentUser() user: AuthUser,
    @Query('orgId') orgId?: string,
    @Query('salesRepName') salesRepName?: string,
    @Query('planMonth') planMonth?: string,
    @Query('grade') grade?: string,
    @Query('keyword') keyword?: string,
    @Query('onlyCompleted') onlyCompleted?: string,
    @Query('includeConverted') includeConverted?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.crmService.listTargets(user, {
      orgId,
      salesRepName,
      planMonth,
      grade,
      keyword,
      onlyCompleted,
      includeConverted,
      page,
      pageSize,
    });
  }

  @Post('targets')
  createTarget(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.crmService.createTarget(user, body);
  }

  @Patch('targets/:id')
  updateTarget(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.crmService.updateTarget(user, id, body);
  }

  @Delete('targets/:id')
  deleteTarget(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.crmService.deleteTarget(user, id);
  }

  @Post('targets/import')
  importTargets(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.crmService.batchImportTargets(user, body);
  }

  @Get('targets/export')
  async exportTargets(
    @CurrentUser() user: AuthUser,
    @Query('orgId') orgId: string | undefined,
    @Query('salesRepName') salesRepName: string | undefined,
    @Query('planMonth') planMonth: string | undefined,
    @Query('includeConverted') includeConverted: string | undefined,
    @Res() res: Response,
  ) {
    const { filename, csv } = await this.crmService.exportTargetsCsv(user, {
      orgId,
      salesRepName,
      planMonth,
      includeConverted,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(csv);
  }

  @Get('followups')
  listFollowUps(
    @CurrentUser() user: AuthUser,
    @Query('orgId') orgId?: string,
    @Query('salesRepName') salesRepName?: string,
    @Query('customerName') customerName?: string,
    @Query('clinicId') clinicId?: string,
    @Query('visitScene') visitScene?: string,
    @Query('dealStatus') dealStatus?: string,
    @Query('cityMeetingStatus') cityMeetingStatus?: string,
    @Query('repurchaseIntent') repurchaseIntent?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.crmService.listFollowUps(user, {
      orgId,
      salesRepName,
      customerName,
      clinicId,
      visitScene,
      dealStatus,
      cityMeetingStatus,
      repurchaseIntent,
      keyword,
      page,
      pageSize,
    } as any);
  }

  @Post('followups')
  createFollowUp(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.crmService.createFollowUp(user, body);
  }

  @Patch('followups/:id')
  updateFollowUp(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.crmService.updateFollowUp(user, id, body);
  }

  @Delete('followups/:id')
  deleteFollowUp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.crmService.deleteFollowUp(user, id);
  }

  // ---- Existing Client Maintenance Routes ----

  @Get('existing/dashboard')
  existingDashboard(
    @CurrentUser() user: AuthUser,
    @Query('orgId') orgId?: string,
    @Query('salesRepName') salesRepName?: string,
    @Query('planMonth') planMonth?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.crmService.getExistingClientsDashboard(user, {
      orgId,
      salesRepName,
      planMonth,
      keyword,
    });
  }

  @Get('existing/visits')
  existingVisits(
    @CurrentUser() user: AuthUser,
    @Query('orgId') orgId?: string,
    @Query('salesRepName') salesRepName?: string,
    @Query('clinicId') clinicId?: string,
    @Query('repurchaseIntent') repurchaseIntent?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.crmService.listFollowUps(user, {
      orgId,
      salesRepName,
      clinicId,
      visitScene: VisitScene.EXISTING_MAINTENANCE,
      repurchaseIntent,
      keyword,
      page,
      pageSize,
    } as any);
  }

  @Post('existing/visits')
  createExistingVisit(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.crmService.createFollowUp(user, {
      ...body,
      visitScene: VisitScene.EXISTING_MAINTENANCE,
    });
  }

  // ---- Unified Customer 360° Center & Editable Profile ----

  @Get('customers')
  listCustomers(
    @CurrentUser() user: AuthUser,
    @Query('orgId') orgId?: string,
    @Query('stage') stage?: string,
    @Query('salesRepName') salesRepName?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.crmService.listCustomers(user, { orgId, stage, salesRepName, keyword, page, pageSize } as any);
  }

  @Post('customers/import-existing')
  importExisting(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.crmService.batchImportExistingClients(user, body);
  }

  @Get('customers/:id')
  customerDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.crmService.getCustomerDetail(user, id);
  }

  @Patch('customers/:id')
  updateCustomer(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.crmService.updateCustomer(user, id, body);
  }

  @Post('customers/:id/mark-existing')
  markExisting(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.crmService.manualMarkExisting(user, id, body);
  }

  @Get('customer-profile')
  customerProfile(
    @CurrentUser() user: AuthUser,
    @Query('targetId') targetId?: string,
    @Query('customerName') customerName?: string,
    @Query('orgId') orgId?: string,
  ) {
    return this.crmService.getCustomerProfile(user, { targetId, customerName, orgId });
  }
}

@Module({
  controllers: [CrmController],
  providers: [CrmService],
  exports: [CrmService],
})
export class CrmModule {}
