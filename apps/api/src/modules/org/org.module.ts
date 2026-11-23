import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.module';
import { AuthUser, CurrentUser } from '../../common/auth.decorators';

@Controller()
export class OrgController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('orgs')
  async listOrgs(@CurrentUser() user: AuthUser) {
    const where = user.orgType === 'HQ' ? {} : { id: user.orgId };
    return this.prisma.organization.findMany({
      where,
      include: {
        warehouses: true,
        _count: { select: { ownedClinics: true, users: true } },
      },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Post('orgs')
  async createDealer(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      name: string;
      code: string;
      province?: string;
      city?: string;
      regionCodes?: string[];
      contactName?: string;
      contactPhone?: string;
      priceTier?: string;
      warehouseName?: string;
    },
  ) {
    if (user.orgType !== 'HQ') {
      throw new ForbiddenException('仅品牌总部可新增服务商');
    }
    if (!body.name || !body.code) {
      throw new BadRequestException('服务商名称与编码不能为空');
    }
    const org = await this.prisma.organization.create({
      data: {
        type: 'DEALER',
        name: body.name,
        code: body.code.toUpperCase(),
        province: body.province,
        city: body.city,
        regionCodes: body.regionCodes ?? (body.city ? [body.city] : []),
        contactName: body.contactName,
        contactPhone: body.contactPhone,
        priceTier: body.priceTier || 'STANDARD',
        warehouses: {
          create: {
            name: body.warehouseName || `${body.name}独立仓`,
            code: `WH-${body.code.toUpperCase()}`,
            isDefault: true,
          },
        },
      },
      include: { warehouses: true },
    });
    return org;
  }

  @Patch('orgs/:id/freeze')
  async toggleFreeze(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { supplyFrozen: boolean; freezeReason?: string },
  ) {
    if (user.orgType !== 'HQ') {
      throw new ForbiddenException('仅品牌总部可调整停供状态');
    }
    return this.prisma.organization.update({
      where: { id },
      data: {
        supplyFrozen: Boolean(body.supplyFrozen),
        freezeReason: body.supplyFrozen ? body.freezeReason || '月度核验异常或违反价格/流向红线' : null,
      },
    });
  }

  @Get('warehouses')
  async listWarehouses(@CurrentUser() user: AuthUser) {
    const where = user.orgType === 'HQ' ? {} : { orgId: user.orgId };
    return this.prisma.warehouse.findMany({
      where,
      include: { org: { select: { id: true, name: true, type: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post('warehouses')
  async createWarehouse(
    @CurrentUser() user: AuthUser,
    @Body() body: { name: string; code: string; address?: string; orgId?: string },
  ) {
    const targetOrgId = user.orgType === 'HQ' && body.orgId ? body.orgId : user.orgId;
    return this.prisma.warehouse.create({
      data: {
        orgId: targetOrgId,
        name: body.name,
        code: body.code.toUpperCase(),
        address: body.address,
      },
    });
  }

  @Get('suppliers')
  listSuppliers() {
    return this.prisma.supplier.findMany({ orderBy: { createdAt: 'asc' } });
  }

  @Post('suppliers')
  createSupplier(
    @Body() body: { name: string; code: string; contactName?: string; contactPhone?: string; address?: string },
  ) {
    return this.prisma.supplier.create({ data: body });
  }

  @Get('rules')
  async getRules() {
    return this.prisma.systemRuleConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });
  }

  @Put('rules')
  async updateRules(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      clinicProtectDays?: number;
      clinicUnbindDays?: number;
      unbindWarnDaysBefore?: number;
      defaultMinSupplyRatio?: number;
      defaultMinRetailRatio?: number;
      highFreqVerifyThreshold?: number;
      allowSpecialPriceApprove?: boolean;
      verifyBaseUrl?: string;
    },
  ) {
    if (user.orgType !== 'HQ') {
      throw new ForbiddenException('仅品牌总部可修改合同规则参数');
    }
    return this.prisma.systemRuleConfig.upsert({
      where: { id: 'default' },
      update: body,
      create: { id: 'default', ...body },
    });
  }
}

@Module({
  controllers: [OrgController],
})
export class OrgModule {}
