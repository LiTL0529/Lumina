import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Module,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.module';
import { AuthUser, CurrentUser } from '../../common/auth.decorators';
import { parsePagination } from '../../common/pagination';

@Controller()
export class ProductController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('brands')
  listBrands() {
    return this.prisma.brand.findMany({ orderBy: { createdAt: 'asc' } });
  }

  @Post('brands')
  createBrand(@CurrentUser() user: AuthUser, @Body() body: { name: string; code: string }) {
    if (user.orgType !== 'HQ') throw new ForbiddenException('仅品牌总部可维护品牌');
    return this.prisma.brand.create({ data: { name: body.name, code: body.code.toUpperCase() } });
  }

  @Get('categories')
  listCategories() {
    return this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Post('categories')
  createCategory(@CurrentUser() user: AuthUser, @Body() body: { name: string; sortOrder?: number }) {
    if (user.orgType !== 'HQ') throw new ForbiddenException('仅品牌总部可维护分类');
    return this.prisma.category.create({ data: body });
  }

  @Get('products')
  async listProducts(
    @Query('keyword') keyword?: string,
    @Query('brandId') brandId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const where = {
      ...(brandId ? { brandId } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' as const } },
              { skuCode: { contains: keyword, mode: 'insensitive' as const } },
              { barcode: { contains: keyword, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const pg = parsePagination({ page, pageSize }, 20);
    if (pg.enabled) {
      const [total, items] = await Promise.all([
        this.prisma.product.count({ where }),
        this.prisma.product.findMany({
          where,
          include: { brand: true, category: true },
          orderBy: { createdAt: 'asc' },
          skip: pg.skip,
          take: pg.pageSize,
        }),
      ]);
      return { items, total, page: pg.page, pageSize: pg.pageSize };
    }
    return this.prisma.product.findMany({
      where,
      include: {
        brand: true,
        category: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post('products')
  async createProduct(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      skuCode: string;
      barcode?: string;
      name: string;
      brandId: string;
      categoryId?: string;
      spec?: string;
      unitName?: string;
      cartonQty?: number;
      retailPrice: number;
      defaultSupplyPrice: number;
      costPrice?: number;
      minSupplyDiscount?: number;
      isTraceable?: boolean;
      isCoreKpi?: boolean;
    },
  ) {
    if (user.orgType !== 'HQ') throw new ForbiddenException('仅品牌总部可新增商品主数据');
    if (!body.skuCode || !body.name || !body.brandId) {
      throw new BadRequestException('货号、商品名称与品牌必填');
    }
    return this.prisma.product.create({
      data: {
        ...body,
        skuCode: body.skuCode.trim().toUpperCase(),
      },
      include: { brand: true, category: true },
    });
  }

  @Put('products/:id')
  async updateProduct(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (user.orgType !== 'HQ') throw new ForbiddenException('仅品牌总部可编辑商品');
    const { id: _ignore, brand: _b, category: _c, createdAt: _ca, updatedAt: _ua, ...updateData } = body;
    return this.prisma.product.update({
      where: { id },
      data: updateData,
      include: { brand: true, category: true },
    });
  }

  /**
   * Batch import products from 生意通 Excel/CSV exports so migration takes < 10 minutes.
   */
  @Post('products/import')
  async importProducts(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      rows: Array<{
        skuCode: string;
        name: string;
        brandName?: string;
        categoryName?: string;
        spec?: string;
        unitName?: string;
        barcode?: string;
        retailPrice?: number;
        defaultSupplyPrice?: number;
        cartonQty?: number;
      }>;
    },
  ) {
    if (user.orgType !== 'HQ') throw new ForbiddenException('仅品牌总部可批量导入商品');
    const rows = body.rows || [];
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    const defaultBrand = await this.prisma.brand.upsert({
      where: { code: 'LUMINA' },
      update: {},
      create: { name: 'Lumina', code: 'LUMINA' },
    });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.skuCode || !row.name) {
        errors.push(`第 ${i + 1} 行缺少货号或名称`);
        continue;
      }
      const brandName = (row.brandName || '').trim();
      let brandId = defaultBrand.id;
      if (brandName) {
        const b = await this.prisma.brand.upsert({
          where: { name: brandName },
          update: {},
          create: {
            name: brandName,
            code: brandName.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || `BR-${Date.now()}-${i}`,
          },
        });
        brandId = b.id;
      }

      let categoryId: string | undefined;
      if (row.categoryName?.trim()) {
        const cat = await this.prisma.category.upsert({
          where: { name: row.categoryName.trim() },
          update: {},
          create: { name: row.categoryName.trim() },
        });
        categoryId = cat.id;
      }

      const sku = row.skuCode.trim().toUpperCase();
      const retail = Number(row.retailPrice || 398);
      const supply = Number(row.defaultSupplyPrice || Number((retail * 0.4).toFixed(2)));
      const exists = await this.prisma.product.findUnique({ where: { skuCode: sku } });
      if (exists) {
        await this.prisma.product.update({
          where: { skuCode: sku },
          data: {
            name: row.name.trim(),
            brandId,
            ...(categoryId ? { categoryId } : {}),
            spec: row.spec || exists.spec,
            unitName: row.unitName || exists.unitName,
            barcode: row.barcode || exists.barcode,
            retailPrice: retail,
            defaultSupplyPrice: supply,
            cartonQty: Number(row.cartonQty || exists.cartonQty),
          },
        });
        updated++;
      } else {
        await this.prisma.product.create({
          data: {
            skuCode: sku,
            name: row.name.trim(),
            brandId,
            categoryId,
            spec: row.spec || '',
            unitName: row.unitName || '盒',
            barcode: row.barcode || null,
            retailPrice: retail,
            defaultSupplyPrice: supply,
            cartonQty: Number(row.cartonQty || 12),
            isTraceable: true,
          },
        });
        created++;
      }
    }

    return { total: rows.length, created, updated, errors };
  }
}

@Module({
  controllers: [ProductController],
})
export class ProductModule {}
