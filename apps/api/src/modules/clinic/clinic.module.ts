import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { buildClinicFingerprint, ClinicBindStatus } from '@lumina/shared-types';
import { PrismaService } from '../../common/prisma.module';
import { RedisService } from '../../common/redis.module';
import { AuthUser, CurrentUser } from '../../common/auth.decorators';

@Injectable()
export class ClinicService {
  private readonly logger = new Logger(ClinicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async listClinics(user: AuthUser, filter?: { status?: string; keyword?: string }) {
    const where: Record<string, unknown> = {};
    if (user.orgType !== 'HQ') {
      where.OR = [{ ownerOrgId: user.orgId }, { bindStatus: ClinicBindStatus.PUBLIC_POOL }];
    }
    if (filter?.status) {
      where.bindStatus = filter.status;
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

    const list = await this.prisma.clinic.findMany({
      where,
      include: {
        ownerOrg: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    const nowMs = Date.now();
    return list.map((c) => {
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

    return this.redis.withLock(`lock:clinic:report:${fingerprint}`, 6000, async () => {
      const rules = await this.prisma.systemRuleConfig.upsert({
        where: { id: 'default' },
        update: {},
        create: { id: 'default' },
      });

      const existing = await this.prisma.clinic.findUnique({
        where: { fingerprint },
        include: { ownerOrg: true },
      });

      const now = new Date();
      const protectExpireAt = new Date(now.getTime() + rules.clinicProtectDays * 86400_000);

      if (existing) {
        if (existing.bindStatus !== ClinicBindStatus.PUBLIC_POOL) {
          throw new ConflictException(
            `报备冲突：该机构已由【${existing.ownerOrg?.name || '其他服务商'}】于 ${existing.reportedAt?.toISOString().slice(0, 19).replace('T', ' ')} 抢先报备/绑定（当前状态：${existing.bindStatus}），遵循系统时间戳先报先得规则。`,
          );
        }
        // Re-claim from PUBLIC_POOL
        const updated = await this.prisma.$transaction(async (tx) => {
          const rec = await tx.clinic.update({
            where: { id: existing.id },
            data: {
              ownerOrgId: dealerOrgId,
              ownerSalesId: user.userId,
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
              remark: `从公海抢单报备，锁定 ${rules.clinicProtectDays} 天保护期`,
            },
          });
          return rec;
        });
        return {
          clinic: updated,
          serverTimestamp: now.toISOString(),
          protectDays: rules.clinicProtectDays,
          message: `公海机构报备成功，系统时间戳已锁定 ${rules.clinicProtectDays} 天保护期`,
        };
      }

      const created = await this.prisma.$transaction(async (tx) => {
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

  async getProtectionLogs(clinicId: string) {
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
  ) {
    return this.clinicService.listClinics(user, { status, keyword });
  }

  @Get('public-pool')
  publicPool(@CurrentUser() user: AuthUser) {
    return this.clinicService.listClinics(user, { status: ClinicBindStatus.PUBLIC_POOL });
  }

  @Get('expiring')
  async expiring(@CurrentUser() user: AuthUser) {
    const all = await this.clinicService.listClinics(user);
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
  runExpiry() {
    return this.clinicService.runExpirySweep();
  }

  @Get(':id/logs')
  logs(@Param('id') id: string) {
    return this.clinicService.getProtectionLogs(id);
  }
}

@Module({
  controllers: [ClinicController],
  providers: [ClinicService],
  exports: [ClinicService],
})
export class ClinicModule {}
