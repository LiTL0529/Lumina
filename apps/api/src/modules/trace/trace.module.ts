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
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  AlertSeverity,
  AlertType,
  TraceCodeLevel,
  TraceCodeStatus,
  TraceEventType,
} from '@lumina/shared-types';
import {
  buildVerifyUrl,
  extractTokenFromScanInput,
  generateBatchCodeSet,
  verifyTraceTokenSignature,
} from '@lumina/trace-crypto';
import { PrismaService } from '../../common/prisma.module';
import { EventsGateway } from '../../common/events.module';
import { AuthUser, CurrentUser, Public } from '../../common/auth.decorators';

const TRACE_SECRET =
  process.env.TRACE_HMAC_SECRET || 'lumina_trace_hmac_secret_key_change_in_prod_2026';

@Injectable()
export class TraceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  private async getVerifyBaseUrl() {
    const cfg = await this.prisma.systemRuleConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });
    return cfg.verifyBaseUrl || process.env.VERIFY_BASE_URL || 'http://localhost:5174/v';
  }

  async listBatches() {
    return this.prisma.codeBatch.findMany({
      include: {
        product: { include: { brand: true } },
        _count: { select: { codes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createBatch(
    user: AuthUser,
    body: {
      productId: string;
      batchNo?: string;
      unitCount: number;
      cartonQty?: number;
      enableCarton?: boolean;
      mfgDate?: string;
      expDate?: string;
      remark?: string;
    },
  ) {
    if (user.orgType !== 'HQ') {
      throw new ForbiddenException('仅品牌总部有权生成防伪溯源码批次');
    }
    const unitCount = Number(body.unitCount);
    if (!body.productId || !Number.isInteger(unitCount) || unitCount < 1 || unitCount > 20000) {
      throw new BadRequestException('单次生码盒数需为 1 ~ 20,000 之间的整数');
    }

    const product = await this.prisma.product.findUnique({ where: { id: body.productId } });
    if (!product) throw new NotFoundException('商品不存在');

    const cartonQty = Number(body.cartonQty || product.cartonQty || 6);
    const enableCarton = body.enableCarton !== false;
    const verifyBaseUrl = await this.getVerifyBaseUrl();
    const batchNo =
      body.batchNo?.trim() ||
      `${product.skuCode}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;

    const generated = generateBatchCodeSet({
      unitCount,
      cartonQty,
      secret: TRACE_SECRET,
      verifyBaseUrl,
      enableCarton,
    });

    const mfgDate = body.mfgDate ? new Date(body.mfgDate) : new Date();
    const expDate = body.expDate
      ? new Date(body.expDate)
      : new Date(mfgDate.getFullYear() + 3, mfgDate.getMonth(), mfgDate.getDate());

    const batch = await this.prisma.$transaction(async (tx) => {
      const b = await tx.codeBatch.create({
        data: {
          batchNo,
          productId: product.id,
          mfgDate,
          expDate,
          unitCount,
          cartonCount: generated.cartons.length,
          cartonQty: enableCarton ? cartonQty : 1,
          createdById: user.userId,
          remark: body.remark || null,
        },
        include: { product: { include: { brand: true } } },
      });

      for (const carton of generated.cartons) {
        const cartonRec = await tx.traceCode.create({
          data: {
            codeToken: carton.cartonToken,
            codeLevel: TraceCodeLevel.CARTON,
            batchId: b.id,
            productId: product.id,
            status: TraceCodeStatus.GENERATED,
          },
        });
        await tx.traceEvent.create({
          data: {
            traceCodeId: cartonRec.id,
            eventType: TraceEventType.BATCH_GENERATED,
            operatorId: user.userId,
            remark: `批次 ${batchNo} 工厂箱码生成（含 ${carton.unitTokens.length} 盒）`,
          },
        });

        await tx.traceCode.createMany({
          data: carton.unitTokens.map((u) => ({
            codeToken: u.token,
            codeLevel: TraceCodeLevel.UNIT,
            parentId: cartonRec.id,
            batchId: b.id,
            productId: product.id,
            status: TraceCodeStatus.GENERATED,
          })),
        });
      }

      if (generated.looseUnits.length > 0) {
        await tx.traceCode.createMany({
          data: generated.looseUnits.map((u) => ({
            codeToken: u.token,
            codeLevel: TraceCodeLevel.UNIT,
            batchId: b.id,
            productId: product.id,
            status: TraceCodeStatus.GENERATED,
          })),
        });
      }

      return b;
    });

    return {
      batch,
      cartonCount: generated.cartons.length,
      unitCount,
      sampleCartonToken: generated.cartons[0]?.cartonToken ?? null,
      sampleUnitToken:
        generated.cartons[0]?.unitTokens[0]?.token ?? generated.looseUnits[0]?.token ?? null,
    };
  }

  async getBatchCodes(batchId: string) {
    const batch = await this.prisma.codeBatch.findUnique({
      where: { id: batchId },
      include: { product: { include: { brand: true } } },
    });
    if (!batch) throw new NotFoundException('批次不存在');
    const verifyBaseUrl = await this.getVerifyBaseUrl();

    const codes = await this.prisma.traceCode.findMany({
      where: { batchId },
      include: { parent: { select: { codeToken: true } } },
      orderBy: [{ codeLevel: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });

    return {
      batch,
      codes: codes.map((c) => ({
        ...c,
        verifyUrl: buildVerifyUrl(verifyBaseUrl, c.codeToken),
        parentToken: c.parent?.codeToken ?? null,
      })),
    };
  }

  async exportBatchCsv(batchId: string): Promise<{ filename: string; csv: string }> {
    const { batch, codes } = await this.getBatchCodes(batchId);
    const header = [
      '批次号',
      '商品货号',
      '商品名称',
      '码级别',
      '防伪码Token',
      '所属外箱码',
      '防伪二维码链接',
      '当前状态',
      '生产日期',
      '有效期至',
    ];
    const lines = [header.join(',')];
    for (const c of codes) {
      lines.push(
        [
          batch.batchNo,
          batch.product.skuCode,
          `"${batch.product.name}"`,
          c.codeLevel === 'CARTON' ? '外箱码' : '单品盒码',
          c.codeToken,
          c.parentToken || '',
          c.verifyUrl,
          c.status,
          batch.mfgDate.toISOString().slice(0, 10),
          batch.expDate.toISOString().slice(0, 10),
        ].join(','),
      );
    }
    return {
      filename: `${batch.batchNo}_trace_codes.csv`,
      csv: '\uFEFF' + lines.join('\n'),
    };
  }

  /**
   * Post-packaging binding: associates N unboxed unit tokens to a single carton token.
   */
  async bindCarton(user: AuthUser, cartonRaw: string, unitRaws: string[]) {
    const cartonToken = extractTokenFromScanInput(cartonRaw);
    if (!cartonToken) throw new BadRequestException('外箱码格式不正确');

    const carton = await this.prisma.traceCode.findUnique({ where: { codeToken: cartonToken } });
    if (!carton || carton.codeLevel !== TraceCodeLevel.CARTON) {
      throw new BadRequestException('未找到有效外箱码');
    }

    const cleanUnitTokens = Array.from(
      new Set(
        unitRaws
          .map((r) => extractTokenFromScanInput(r))
          .filter((x): x is string => Boolean(x)),
      ),
    );
    if (cleanUnitTokens.length === 0) {
      throw new BadRequestException('请至少扫描 1 个有效单品盒码');
    }

    const units = await this.prisma.traceCode.findMany({
      where: { codeToken: { in: cleanUnitTokens } },
    });
    if (units.length !== cleanUnitTokens.length) {
      throw new BadRequestException('部分单品码不存在于系统中');
    }
    for (const u of units) {
      if (u.codeLevel !== TraceCodeLevel.UNIT) {
        throw new BadRequestException(`码 ${u.codeToken} 不是单品盒码`);
      }
      if (u.productId !== carton.productId) {
        throw new BadRequestException(`码 ${u.codeToken} 与外箱所属商品不一致`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.traceCode.updateMany({
        where: { id: { in: units.map((u) => u.id) } },
        data: { parentId: carton.id },
      });
      await tx.traceEvent.create({
        data: {
          traceCodeId: carton.id,
          eventType: TraceEventType.CARTON_BOUND,
          operatorId: user.userId,
          remark: `现场装箱绑定 ${units.length} 盒单品码`,
        },
      });
    });

    return { cartonToken, boundCount: units.length };
  }

  /**
   * Full lifecycle timeline lookup for HQ / Dealer auditing.
   */
  async getCodeTimeline(rawInput: string) {
    const token = extractTokenFromScanInput(rawInput);
    if (!token) throw new BadRequestException('无法识别的防伪溯源码格式');

    const sig = verifyTraceTokenSignature(token, TRACE_SECRET);
    const code = await this.prisma.traceCode.findUnique({
      where: { codeToken: sig.normalizedToken || token },
      include: {
        batch: true,
        product: { include: { brand: true } },
        parent: { select: { codeToken: true, status: true } },
        children: { select: { codeToken: true, status: true } },
        events: { orderBy: { occurredAt: 'asc' } },
        verifyLogs: { orderBy: { verifiedAt: 'desc' }, take: 20 },
      },
    });
    if (!code) {
      throw new NotFoundException(
        sig.valid ? '验签合法但数据库未收录该码' : '该防伪码签名校验失败，疑似伪造假码！',
      );
    }

    const [dealer, clinic] = await Promise.all([
      code.assignedDealerId
        ? this.prisma.organization.findUnique({
            where: { id: code.assignedDealerId },
            select: { id: true, name: true, city: true, regionCodes: true },
          })
        : null,
      code.targetClinicId
        ? this.prisma.clinic.findUnique({
            where: { id: code.targetClinicId },
            select: { id: true, name: true, city: true, address: true },
          })
        : null,
    ]);

    return {
      signatureValid: sig.valid,
      code,
      assignedDealer: dealer,
      targetClinic: clinic,
    };
  }

  /**
   * Public C-End Anti-Counterfeiting Verification Endpoint.
   * Performs stateless HMAC check -> DB check -> Cross-region & High-frequency fleeing detection.
   */
  async publicVerify(
    rawInput: string,
    meta: { ip?: string; city?: string; deviceHash?: string; openid?: string },
  ) {
    const token = extractTokenFromScanInput(rawInput);
    if (!token) {
      return {
        authentic: false,
        verdict: 'INVALID_FORMAT',
        headline: '无法识别的防伪码',
        message: '您扫描的二维码格式不符合 Lumina 官方防伪编码规范，谨防假冒。',
      };
    }

    const sig = verifyTraceTokenSignature(token, TRACE_SECRET);
    if (!sig.valid || !sig.normalizedToken) {
      return {
        authentic: false,
        verdict: 'COUNTERFEIT_SIGNATURE',
        headline: '防伪校验未通过（疑似假码）',
        message: '该防伪码数字签名校验失败，非官方合法生成码，请勿使用并联系官方核实。',
      };
    }

    const code = await this.prisma.traceCode.findUnique({
      where: { codeToken: sig.normalizedToken },
      include: {
        batch: true,
        product: { include: { brand: true } },
      },
    });

    if (!code || code.status === TraceCodeStatus.VOIDED) {
      return {
        authentic: false,
        verdict: 'NOT_FOUND_OR_VOID',
        headline: '未查询到有效正品记录',
        message: '该码未激活或已作废，请核对产品来源渠道。',
      };
    }

    const rules = await this.prisma.systemRuleConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });

    const [dealer, clinic] = await Promise.all([
      code.assignedDealerId
        ? this.prisma.organization.findUnique({ where: { id: code.assignedDealerId } })
        : null,
      code.targetClinicId
        ? this.prisma.clinic.findUnique({ where: { id: code.targetClinicId } })
        : null,
    ]);

    const detectedCity = meta.city?.trim() || '南昌市';
    const nextSeq = code.verifyCount + 1;
    const isHighFreq = nextSeq > rules.highFreqVerifyThreshold;

    // Cross-region check against dealer's authorized region list
    const authorizedRegions: string[] = Array.isArray(dealer?.regionCodes)
      ? (dealer.regionCodes as string[])
      : [];
    const isCrossRegion =
      Boolean(dealer) &&
      authorizedRegions.length > 0 &&
      !authorizedRegions.includes('全国') &&
      !authorizedRegions.some(
        (r) => detectedCity.includes(r.replace(/[省市区县]/g, '')) || r.includes(detectedCity.replace(/[省市区县]/g, '')),
      );

    const isAbnormal = isHighFreq || isCrossRegion;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.traceCode.update({
        where: { id: code.id },
        data: {
          verifyCount: nextSeq,
          firstVerifyAt: code.firstVerifyAt ?? now,
          firstVerifyCity: code.firstVerifyCity ?? detectedCity,
          status:
            code.status === TraceCodeStatus.SOLD_TO_CLINIC
              ? TraceCodeStatus.CONSUMED
              : code.status,
        },
      });

      await tx.consumerVerifyLog.create({
        data: {
          traceCodeId: code.id,
          ip: meta.ip || null,
          resolvedCity: detectedCity,
          geoCity: meta.city || null,
          deviceHash: meta.deviceHash || null,
          openid: meta.openid || null,
          verifySeq: nextSeq,
          isAbnormal,
          verifiedAt: now,
        },
      });

      if (nextSeq === 1) {
        await tx.traceEvent.create({
          data: {
            traceCodeId: code.id,
            eventType: TraceEventType.CONSUMER_VERIFIED,
            remark: `终端顾客于【${detectedCity}】首次扫码验真`,
            occurredAt: now,
          },
        });
      }
    });

    if (isCrossRegion) {
      const alert = await this.prisma.antiFleeingAlert.create({
        data: {
          alertType: AlertType.CROSS_REGION,
          severity: AlertSeverity.HIGH,
          orgId: dealer?.id,
          traceCodeToken: code.codeToken,
          title: `疑似跨区域窜货（授权 ${authorizedRegions.slice(0, 2).join('/')} → ${detectedCity} 验真）`,
          detail: `单品码 ${code.codeToken}（${code.product.name}）归属服务商【${dealer?.name}】，在非授权城市【${detectedCity}】被终端消费者扫码验真（第 ${nextSeq} 次）。`,
          evidenceSnapshot: {
            authorizedRegions,
            detectedCity,
            dealerName: dealer?.name,
            clinicName: clinic?.name,
            verifySeq: nextSeq,
          },
        },
      });
      this.events.notifyAlert({
        id: alert.id,
        alertType: alert.alertType,
        title: alert.title,
        severity: alert.severity,
      });
    } else if (isHighFreq) {
      const alert = await this.prisma.antiFleeingAlert.create({
        data: {
          alertType: AlertType.HIGH_FREQ_VERIFY,
          severity: AlertSeverity.MEDIUM,
          orgId: dealer?.id,
          traceCodeToken: code.codeToken,
          title: `高频重复扫码防伪告警（累计 ${nextSeq} 次）`,
          detail: `单品码 ${code.codeToken} 累计验真已达 ${nextSeq} 次（阈值 ${rules.highFreqVerifyThreshold} 次），谨防假码复制或回收包装盒。`,
          evidenceSnapshot: { verifySeq: nextSeq, detectedCity },
        },
      });
      this.events.notifyAlert({
        id: alert.id,
        alertType: alert.alertType,
        title: alert.title,
        severity: alert.severity,
      });
    }

    let riskLevel: 'FIRST_AUTH' | 'REPEAT_OK' | 'HIGH_FREQ_WARNING' = 'FIRST_AUTH';
    let headline = '官方正品 · 首次防伪认证通过';
    let subMessage = '本盒产品为品牌官方正规渠道出厂正品，请放心使用。';

    if (isHighFreq) {
      riskLevel = 'HIGH_FREQ_WARNING';
      headline = `高频查验预警 · 已被查询 ${nextSeq} 次`;
      subMessage = `该防伪码查验次数异常偏高（首次查验：${(code.firstVerifyAt ?? now).toISOString().slice(0, 16).replace('T', ' ')}），谨防复制假码或二次回收包材。`;
    } else if (nextSeq > 1) {
      riskLevel = 'REPEAT_OK';
      headline = `官方正品 · 第 ${nextSeq} 次防伪查询`;
      subMessage = `首次验证时间：${(code.firstVerifyAt ?? now).toISOString().slice(0, 16).replace('T', ' ')}（${code.firstVerifyCity ?? detectedCity}），如非本人重复查询请注意核实。`;
    }

    const retailPrice = Number(code.product.retailPrice);
    const minCompliantRetail = Number((retailPrice * Number(rules.defaultMinRetailRatio)).toFixed(2));

    return {
      authentic: true,
      riskLevel,
      headline,
      subMessage,
      verifySeq: nextSeq,
      firstVerifyAt: (code.firstVerifyAt ?? now).toISOString(),
      firstVerifyCity: code.firstVerifyCity ?? detectedCity,
      codeToken: code.codeToken,
      codeLevel: code.codeLevel,
      product: {
        name: code.product.name,
        skuCode: code.product.skuCode,
        brandName: code.product.brand.name,
        spec: code.product.spec,
        unitName: code.product.unitName,
        retailPrice,
        minCompliantRetail,
        retailRedlineFold: Number((Number(rules.defaultMinRetailRatio) * 10).toFixed(1)),
      },
      batch: {
        batchNo: code.batch.batchNo,
        mfgDate: code.batch.mfgDate.toISOString().slice(0, 10),
        expDate: code.batch.expDate.toISOString().slice(0, 10),
      },
      channelEndorsement: {
        dealerName: dealer?.name || 'Lumina 品牌官方直供总仓',
        authorizedRegions,
        clinicName: clinic?.name || null,
        clinicCity: clinic?.city || null,
      },
      // Extension hooks pre-wired for Requirement 2 (NFC anime & post-care guide)
      extensions: {
        nfcAnimeReady: true,
        usageGuideTitle: `${code.product.name} · 院线级居家护理指南`,
        postCareHint: '术后 2-3 天重补水修护，7 天周期维稳护理（AI 护理助手即将上线）',
      },
    };
  }

  /**
   * 8.5折 Retail Price Redline feedback / anonymous low-price report from C-end consumers.
   */
  async submitRetailPriceReport(body: {
    codeToken: string;
    paidPrice: number;
    storeName?: string;
    city?: string;
    contact?: string;
    remark?: string;
  }) {
    const token = extractTokenFromScanInput(body.codeToken) || body.codeToken;
    const code = await this.prisma.traceCode.findUnique({
      where: { codeToken: token },
      include: { product: true },
    });
    if (!code) throw new NotFoundException('未找到对应防伪码');

    const retail = Number(code.product.retailPrice);
    const ratio = retail > 0 ? Number((Number(body.paidPrice) / retail).toFixed(4)) : 1;

    const alert = await this.prisma.antiFleeingAlert.create({
      data: {
        alertType: AlertType.RETAIL_PRICE_REPORT,
        severity: ratio < 0.85 ? AlertSeverity.HIGH : AlertSeverity.LOW,
        orgId: code.assignedDealerId,
        traceCodeToken: code.codeToken,
        title: `C端零售核价反馈（实付 ¥${body.paidPrice}，折合 ${(ratio * 10).toFixed(1)} 折）`,
        detail: `顾客反馈于【${body.storeName || '未填写门店'}】（${body.city || '未知城市'}）以 ¥${body.paidPrice} 购入 ${code.product.name}（官方指导价 ¥${retail}，8.5 折红线 ¥${(retail * 0.85).toFixed(0)}）。备注：${body.remark || '无'}`,
        evidenceSnapshot: {
          paidPrice: body.paidPrice,
          retailPrice: retail,
          ratio,
          storeName: body.storeName,
          city: body.city,
          contact: body.contact,
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
      submitted: true,
      alertId: alert.id,
      belowRetailRedline: ratio < 0.85,
      message: '感谢您的核价反馈，品牌流向管控中心已收到并将核实处理。',
    };
  }

  async listAlerts(user: AuthUser, status?: string) {
    return this.prisma.antiFleeingAlert.findMany({
      where: {
        ...(user.orgType !== 'HQ' ? { orgId: user.orgId } : {}),
        ...(status ? { status } : {}),
      },
      include: { org: { select: { id: true, name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async resolveAlert(
    user: AuthUser,
    id: string,
    body: { status: string; resolution: string },
  ) {
    if (user.orgType !== 'HQ') {
      throw new ForbiddenException('仅品牌流向管控负责人可处置风控预警');
    }
    return this.prisma.antiFleeingAlert.update({
      where: { id },
      data: {
        status: body.status || 'RESOLVED',
        resolution: body.resolution,
        handlerId: user.userId,
        resolvedAt: body.status === 'RESOLVED' ? new Date() : null,
      },
    });
  }
}

@Controller()
export class TraceController {
  constructor(private readonly traceService: TraceService) {}

  @Get('trace/batches')
  listBatches() {
    return this.traceService.listBatches();
  }

  @Post('trace/batches')
  createBatch(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      productId: string;
      batchNo?: string;
      unitCount: number;
      cartonQty?: number;
      enableCarton?: boolean;
      mfgDate?: string;
      expDate?: string;
      remark?: string;
    },
  ) {
    return this.traceService.createBatch(user, body);
  }

  @Get('trace/batches/:id/codes')
  getBatchCodes(@Param('id') id: string) {
    return this.traceService.getBatchCodes(id);
  }

  @Get('trace/batches/:id/export')
  async exportBatchCsv(@Param('id') id: string, @Res() res: Response) {
    const { filename, csv } = await this.traceService.exportBatchCsv(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(csv);
  }

  @Post('trace/carton/bind')
  bindCarton(
    @CurrentUser() user: AuthUser,
    @Body() body: { cartonCode: string; unitCodes: string[] },
  ) {
    return this.traceService.bindCarton(user, body.cartonCode, body.unitCodes || []);
  }

  @Get('trace/codes/:rawInput/timeline')
  timeline(@Param('rawInput') rawInput: string) {
    return this.traceService.getCodeTimeline(decodeURIComponent(rawInput));
  }

  @Get('trace/alerts')
  alerts(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.traceService.listAlerts(user, status);
  }

  @Patch('trace/alerts/:id/resolve')
  resolveAlert(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { status: string; resolution: string },
  ) {
    return this.traceService.resolveAlert(user, id, body);
  }

  @Public()
  @Get('public/verify/:token')
  publicVerify(
    @Param('token') token: string,
    @Query('city') city: string | undefined,
    @Query('device') device: string | undefined,
    @Req() req: Request,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      '127.0.0.1';
    return this.traceService.publicVerify(token, { ip, city, deviceHash: device });
  }

  @Public()
  @Post('public/verify/price-report')
  submitPriceReport(
    @Body()
    body: {
      codeToken: string;
      paidPrice: number;
      storeName?: string;
      city?: string;
      contact?: string;
      remark?: string;
    },
  ) {
    return this.traceService.submitRetailPriceReport(body);
  }
}

@Module({
  controllers: [TraceController],
  providers: [TraceService],
  exports: [TraceService],
})
export class TraceModule {}
