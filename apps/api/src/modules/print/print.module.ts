import { Body, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Put } from '@nestjs/common';
import { PrintPaperType } from '@lumina/shared-types';
import {
  buildHiprintTemplate,
  ORDER_SYSTEM_VARS,
  ORDER_TABLE_COLUMNS,
  PAPER_DIMENSIONS,
} from '@lumina/print-templates';
import { PrismaService } from '../../common/prisma.module';
import { AuthUser, CurrentUser } from '../../common/auth.decorators';

@Controller('print')
export class PrintController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('templates')
  async listTemplates() {
    const templates = await this.prisma.printTemplate.findMany({
      orderBy: [{ docType: 'asc' }, { isDefault: 'desc' }],
    });
    return {
      templates,
      columnDefs: ORDER_TABLE_COLUMNS,
      systemVarDefs: ORDER_SYSTEM_VARS,
      paperDimensions: PAPER_DIMENSIONS,
    };
  }

  @Put('templates/:id')
  async updateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      isDefault?: boolean;
      visibleColumns?: string[];
      systemVars?: string[];
    },
  ) {
    if (user.orgType !== 'HQ') {
      throw new ForbiddenException('仅品牌总部可修改打印模板');
    }
    const existing = await this.prisma.printTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('打印模板不存在');

    const visibleColumns =
      body.visibleColumns ?? (existing.visibleColumns as string[]);
    const systemVars = body.systemVars ?? (existing.systemVars as string[]);
    const title = body.name || existing.name;

    const hiprintJson = buildHiprintTemplate({
      paperType: existing.paperType as PrintPaperType,
      title: `Lumina ${title.split(' - ')[0]}`,
      visibleColumns,
      systemVars,
    });

    if (body.isDefault) {
      await this.prisma.printTemplate.updateMany({
        where: { docType: existing.docType },
        data: { isDefault: false },
      });
    }

    return this.prisma.printTemplate.update({
      where: { id },
      data: {
        name: title,
        isDefault: body.isDefault ?? existing.isDefault,
        visibleColumns,
        systemVars,
        hiprintJson: hiprintJson as unknown as object,
      },
    });
  }

  @Get('sales-order/:id')
  async getSalesOrderPrintPayload(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: {
        sellerOrg: true,
        buyerOrg: true,
        clinic: true,
        warehouse: true,
        items: { include: { product: { include: { brand: true } } } },
      },
    });
    if (!order) throw new NotFoundException('销售单不存在');
    if (
      user.orgType !== 'HQ' &&
      order.sellerOrgId !== user.orgId &&
      order.buyerOrgId !== user.orgId
    ) {
      throw new ForbiddenException('无权打印或查看其他主体的销售单');
    }

    const traceEvents = await this.prisma.traceEvent.findMany({
      where: { docNo: order.docNo },
      include: { traceCode: { select: { codeToken: true, productId: true } } },
    });
    const traceByProd = new Map<string, string[]>();
    for (const ev of traceEvents) {
      const list = traceByProd.get(ev.traceCode.productId) || [];
      list.push(ev.traceCode.codeToken);
      traceByProd.set(ev.traceCode.productId, list);
    }

    const templates = await this.prisma.printTemplate.findMany({
      where: { docType: 'SALES_OUTBOUND' },
      orderBy: { isDefault: 'desc' },
    });

    const previousArrears = Number(order.clinic?.arrearsAmount || 0);
    const thisUnpaid = Math.max(0, Number(order.totalAmount) - Number(order.paidAmount));

    return {
      templates,
      paperDimensions: PAPER_DIMENSIONS,
      printData: {
        docNo: order.docNo,
        docDate: order.bizDate.toISOString().slice(0, 10),
        customerName: order.buyerOrg?.name || order.clinic?.name || '匿名客户',
        warehouseName: order.warehouse.name,
        sellerOrgName: order.sellerOrg.name,
        salesRepName: order.salesRepId ? '业务专员' : '-',
        creatorName: '系统制单',
        shippingInfo: `${order.shippingMethod}${order.trackingNo ? ` / ${order.trackingNo}` : ''}`,
        docRemark: order.remark || '无',
        totalAmount: Number(order.totalAmount).toFixed(2),
        paidAmount: Number(order.paidAmount).toFixed(2),
        roundingAmount: Number(order.roundingAmount).toFixed(2),
        otherFee: Number(order.otherFee).toFixed(2),
        previousArrears: previousArrears.toFixed(2),
        totalArrears: (previousArrears + thisUnpaid).toFixed(2),
        items: order.items.map((it, idx) => ({
          index: idx + 1,
          productName: it.product.name,
          skuCode: it.product.skuCode,
          spec: it.product.spec || '-',
          unitName: it.product.unitName,
          qty: it.qty,
          unitPrice: Number(it.unitPrice).toFixed(2),
          discountPercent: it.isGift ? '赠品' : `${Number(it.discountPercent).toFixed(0)}%`,
          discountedPrice: it.isGift
            ? '0.00'
            : ((Number(it.unitPrice) * Number(it.discountPercent)) / 100).toFixed(2),
          lineAmount: Number(it.lineAmount).toFixed(2),
          traceCount: `${it.outboundQty}/${it.qty}`,
          traceCodes: traceByProd.get(it.productId) || [],
          remark: it.remark || '',
        })),
      },
    };
  }
}

@Module({
  controllers: [PrintController],
})
export class PrintModule {}
