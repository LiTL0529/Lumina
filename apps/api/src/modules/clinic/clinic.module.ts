import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { buildClinicFingerprint, ClinicBindStatus } from '@lumina/shared-types';
import { PrismaService } from '../../common/prisma.module';
import { RedisService } from '../../common/redis.module';
import { AuthUser, CurrentUser } from '../../common/auth.decorators';
import { PageQuery, parsePagination } from '../../common/pagination';

@Injectable()
export class ClinicService {
  private readonly logger = new Logger(ClinicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async listClinics(
    user: AuthUser,
    filter?: { status?: string; keyword?: string; includeLeads?: string; page?: string; pageSize?: string },
  ) {
    const where: Record<string, unknown> = {};
    if (user.orgType !== 'HQ') {
      where.OR = [{ ownerOrgId: user.orgId }, { bindStatus: ClinicBindStatus.PUBLIC_POOL }];
    }
    if (filter?.status) {
      where.bindStatus = filter.status;
    } else if (filter?.includeLeads !== 'true') {
      where.bindStatus = { not: ClinicBindStatus.PROSPECT_LEAD };
    }
    if (filter?.keyword) {
      where.AND = [
        {
          OR: [
            { name: { contains: filter.keyword, mode: 'insensitive' } },
            { city: { contains: filter.keyword, mode: 'insensitive' } },
            { contactPhone: { contains: filter.keyword } },
          ],
        },
      ];
    }

    const rules = await this.prisma.systemRuleConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });

    const pg = parsePagination(filter, 20);
    const [total, list] = pg.enabled
      ? await Promise.all([
          this.prisma.clinic.count({ where }),
          this.prisma.clinic.findMany({
            where,
            include: {
              ownerOrg: { select: { id: true, name: true, code: true } },
            },
            orderBy: [{ updatedAt: 'desc' }],
            skip: pg.skip,
            take: pg.pageSize,
          }),
        ])
      : [
          0,
          await this.prisma.clinic.findMany({
            where,
            include: {
              ownerOrg: { select: { id: true, name: true, code: true } },
            },
            orderBy: [{ updatedAt: 'desc' }],
          }),
        ];

    const nowMs = Date.now();
    const mapped = list.map((c) => {
      let protectDaysLeft: number | null = null;
      let unbindDaysLeft: number | null = null;
      if (c.bindStatus === ClinicBindStatus.PROTECTED_90D && c.protectExpireAt) {
        protectDaysLeft = Math.ceil((c.protectExpireAt.getTime() - nowMs) / 86400_000);
      }
      if (c.bindStatus === ClinicBindStatus.BOUND_ACTIVE && c.lastOrderAt) {
        const unbindAt = c.lastOrderAt.getTime() + rules.clinicUnbindDays * 86400_000;
        unbindDaysLeft = Math.ceil((unbindAt - nowMs) / 86400_000);
      }
      return {
        ...c,
        protectDaysLeft,
        unbindDaysLeft,
        isExpiringSoon:
          (protectDaysLeft !== null && protectDaysLeft <= 15) ||
          (unbindDaysLeft !== null && unbindDaysLeft <= rules.unbindWarnDaysBefore),
      };
    });
    if (pg.enabled) {
      return { items: mapped, total, page: pg.page, pageSize: pg.pageSize };
    }
    return mapped;
  }

  /**
   * First-come-first-served clinic reporting protected by Redis distributed lock
   * and normalized unique fingerprint. Records tamper-evident server UTC timestamp.
   */
  async reportClinic(
    user: AuthUser,
    body: {
      name: string;
      creditCode?: string;
      province?: string;
      city: string;
      cityCode?: string;
      address?: string;
      contactName?: string;
      contactPhone?: string;
      targetOrgId?: string;
      remark?: string;
    },
  ) {
    if (!body.name?.trim() || !body.city?.trim()) {
      throw new BadRequestException('机构名称与所在城市不能为空');
    }

    const dealerOrgId =
      user.orgType === 'HQ' && body.targetOrgId ? body.targetOrgId : user.orgId;
    const cityCode = body.cityCode?.trim() || body.city.trim();
    const fingerprint = buildClinicFingerprint({
      creditCode: body.creditCode,
      name: body.name,
      cityCode,
      contactPhone: body.contactPhone,
    });

    const lockKey = `lock:clinic:report:${fingerprint}`;
    return this.redis.withLock(lockKey, 6000, async () => {
      const rules = await this.prisma.systemRuleConfig.upsert({
        where: { id: 'default' },
        update: {},
        create: { id: 'default' },
      });

      const existing = await this.prisma.clinic.findFirst({
        where: {
          OR: [
            { fingerprint },
            {
              cityCode,
              name: { equals: body.name.trim(), mode: 'insensitive' },
            },
          ],
        },
        include: { ownerOrg: true },
      });

      const now = new Date();
      const protectExpireAt = new Date(now.getTime() + rules.clinicProtectDays * 86400_000);

      if (existing) {
        if (
          existing.bindStatus !== ClinicBindStatus.PUBLIC_POOL &&
          existing.bindStatus !== ClinicBindStatus.PROSPECT_LEAD
        ) {
          throw new ConflictException(
            `报备冲突：该机构已由【${existing.ownerOrg?.name || '其他服务商'}】于 ${existing.reportedAt?.toISOString().slice(0, 19).replace('T', ' ')} 抢先报备/绑定（当前状态：${existing.bindStatus}），遵循系统时间戳先报先得规则。`,
          );
        }
        const fromPool = existing.bindStatus === ClinicBindStatus.PUBLIC_POOL;
        // Upgrade PROSPECT_LEAD or re-claim from PUBLIC_POOL while preserving CRM dossier
        const updated = await this.prisma.$transaction(async (tx) => {
          const rec = await tx.clinic.update({
            where: { id: existing.id },
            data: {
              ownerOrgId: dealerOrgId,
              ownerSalesId: user.userId,
              salesRepName: existing.salesRepName || user.realName.replace(/（.*?）/g, ''),
              bindStatus: ClinicBindStatus.PROTECTED_90D,
              reportedAt: now,
              protectExpireAt,
              address: body.address || existing.address,
              contactName: body.contactName || existing.contactName,
              contactPhone: body.contactPhone || existing.contactPhone,
              remark: body.remark || existing.remark,
            },
            include: { ownerOrg: { select: { id: true, name: true } } },
          });
          await tx.clinicProtectionLog.create({
            data: {
              clinicId: rec.id,
              orgId: dealerOrgId,
              action: 'REPORT',
              operatorId: user.userId,
              serverTimestamp: now,
              remark: fromPool
                ? `从公海抢单报备，锁定 ${rules.clinicProtectDays} 天保护期`
                : `新客线索正式报备，锁定 ${rules.clinicProtectDays} 天保护期`,
            },
          });
          return rec;
        });
        return {
          clinic: updated,
          serverTimestamp: now.toISOString(),
          protectDays: rules.clinicProtectDays,
          message: fromPool
            ? `公海机构报备成功，系统时间戳已锁定 ${rules.clinicProtectDays} 天保护期`
            : `机构报备成功，系统时间戳已生效（锁定 ${rules.clinicProtectDays} 天保护期）`,
        };
      }

      let created;
      try {
        created = await this.prisma.$transaction(async (tx) => {
          const rec = await tx.clinic.create({
            data: {
              name: body.name.trim(),
              fingerprint,
              creditCode: body.creditCode?.trim() || null,
              province: body.province?.trim() || null,
              city: body.city.trim(),
              cityCode,
              address: body.address?.trim() || null,
              contactName: body.contactName?.trim() || null,
              contactPhone: body.contactPhone?.trim() || null,
              ownerOrgId: dealerOrgId,
              ownerSalesId: user.userId,
              bindStatus: ClinicBindStatus.PROTECTED_90D,
              reportedAt: now,
              protectExpireAt,
              remark: body.remark || null,
            },
            include: { ownerOrg: { select: { id: true, name: true } } },
          });
          await tx.clinicProtectionLog.create({
            data: {
              clinicId: rec.id,
              orgId: dealerOrgId,
              action: 'REPORT',
              operatorId: user.userId,
              serverTimestamp: now,
              remark: `新机构首次报备，锁定 ${rules.clinicProtectDays} 天保护期`,
            },
          });
          return rec;
        });
      } catch (err: any) {
        if (err?.code === 'P2002') {
          throw new ConflictException(
            '报备冲突：该机构刚被同城其他服务商抢先报备，遵循系统时间戳先报先得规则。',
          );
        }
        throw err;
      }

      return {
        clinic: created,
        serverTimestamp: now.toISOString(),
        protectDays: rules.clinicProtectDays,
        message: `机构报备成功，系统时间戳已生效（锁定 ${rules.clinicProtectDays} 天保护期）`,
      };
    });
  }

  /**
   * Daily automated scheduler (02:00) + manual trigger for 90-day & 270-day auto-release rules.
   */
  @Cron('0 2 * * *')
  async runExpirySweep(referenceNow: Date = new Date()) {
    const rules = await this.prisma.systemRuleConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });

    // 1. Expired 90-day protection without conversion to BOUND_ACTIVE
    const expired90 = await this.prisma.clinic.findMany({
      where: {
        bindStatus: ClinicBindStatus.PROTECTED_90D,
        protectExpireAt: { lt: referenceNow },
      },
    });

    for (const c of expired90) {
      await this.prisma.$transaction(async (tx) => {
        await tx.clinic.update({
          where: { id: c.id },
          data: {
            bindStatus: ClinicBindStatus.PUBLIC_POOL,
            ownerOrgId: null,
            ownerSalesId: null,
            protectExpireAt: null,
          },
        });
        await tx.clinicProtectionLog.create({
          data: {
            clinicId: c.id,
            orgId: c.ownerOrgId,
            action: 'RELEASE_90D',
            serverTimestamp: referenceNow,
            remark: `超过 ${rules.clinicProtectDays} 天保护期未完成有效扫码出库，系统自动释放回公海`,
          },
        });
      });
    }

    // 2. Expired 270-day active clinics with no reorder
    const unbindCutoff = new Date(referenceNow.getTime() - rules.clinicUnbindDays * 86400_000);
    const expired270 = await this.prisma.clinic.findMany({
      where: {
        bindStatus: ClinicBindStatus.BOUND_ACTIVE,
        lastOrderAt: { lt: unbindCutoff },
      },
    });

    for (const c of expired270) {
      await this.prisma.$transaction(async (tx) => {
        await tx.clinic.update({
          where: { id: c.id },
          data: {
            bindStatus: ClinicBindStatus.PUBLIC_POOL,
            ownerOrgId: null,
            ownerSalesId: null,
          },
        });
        await tx.clinicProtectionLog.create({
          data: {
            clinicId: c.id,
            orgId: c.ownerOrgId,
            action: 'RELEASE_270D',
            serverTimestamp: referenceNow,
            remark: `连续 ${rules.clinicUnbindDays} 天无有效扫码复购记录，系统自动解绑释放回公海`,
          },
        });
      });
    }

    this.logger.log(
      `Expiry sweep finished: released ${expired90.length} (90d) and ${expired270.length} (270d) clinics`,
    );
    return {
      released90Count: expired90.length,
      released270Count: expired270.length,
      sweptAt: referenceNow.toISOString(),
    };
  }

  async getProtectionLogs(user: AuthUser, clinicId: string) {
    const clinic = await this.prisma.clinic.findUnique({ where: { id: clinicId } });
    if (!clinic) throw new NotFoundException('机构不存在');
    if (
      user.orgType !== 'HQ' &&
      clinic.ownerOrgId !== user.orgId &&
      clinic.bindStatus !== ClinicBindStatus.PUBLIC_POOL
    ) {
      throw new ForbiddenException('无权查看其他服务商的机构保护日志');
    }
    return this.prisma.clinicProtectionLog.findMany({
      where: { clinicId },
      orderBy: { serverTimestamp: 'desc' },
    });
  }
}

@Controller('clinics')
export class ClinicController {
  constructor(private readonly clinicService: ClinicService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.clinicService.listClinics(user, { status, keyword, page, pageSize });
  }

  @Get('public-pool')
  publicPool(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.clinicService.listClinics(user, { status: ClinicBindStatus.PUBLIC_POOL, page, pageSize });
  }

  @Get('expiring')
  async expiring(@CurrentUser() user: AuthUser) {
    const all = (await this.clinicService.listClinics(user)) as any[];
    return all.filter((c) => c.isExpiringSoon);
  }

  @Post('report')
  report(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      name: string;
      creditCode?: string;
      province?: string;
      city: string;
      cityCode?: string;
      address?: string;
      contactName?: string;
      contactPhone?: string;
      targetOrgId?: string;
      remark?: string;
    },
  ) {
    return this.clinicService.reportClinic(user, body);
  }

  @Post('run-expiry-check')
  runExpiry(@CurrentUser() user: AuthUser) {
    if (user.orgType !== 'HQ') {
      throw new ForbiddenException('仅品牌总部可执行到期释放巡检');
    }
    return this.clinicService.runExpirySweep();
  }

  @Get(':id/logs')
  logs(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.clinicService.getProtectionLogs(user, id);
  }
}

@Module({
  controllers: [ClinicController],
  providers: [ClinicService],
  exports: [ClinicService],
})
export class ClinicModule {}
