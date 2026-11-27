import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../../common/prisma.module';
import { RedisService } from '../../common/redis.module';

export type SmsScene = 'LOGIN' | 'REGISTER' | 'TEST';

const PHONE_REGEX = /^1[3-9]\d{9}$/;
const CODE_TTL_SECONDS = 300; // 5 minutes
const COOLDOWN_SECONDS = 60;
const MAX_DAILY_PER_PHONE = 15;
const MAX_VERIFY_ATTEMPTS = 5;

export interface ResolvedJumDataConfig {
  apiUrl: string;
  appId: string;
  appSecret: string;
  templateId: string;
  allowMock: boolean;
  isLiveConfigured: boolean;
}

@Injectable()
export class JumDataSmsService {
  private readonly logger = new Logger(JumDataSmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  normalizePhone(raw: string): string {
    const clean = String(raw || '').trim().replace(/[\s-]/g, '');
    if (!PHONE_REGEX.test(clean)) {
      throw new BadRequestException('请输入有效的 11 位中国大陆手机号');
    }
    return clean;
  }

  async resolveConfig(): Promise<ResolvedJumDataConfig> {
    const cfg = await this.prisma.systemRuleConfig.findUnique({ where: { id: 'default' } }).catch(() => null);
    const apiUrl = (process.env.JUMDATA_SMS_API_URL || 'https://api.jumdata.com/sms/send').trim();
    const appId = (cfg?.jumdataAppId || process.env.JUMDATA_APP_ID || '').trim();
    const appSecret = (cfg?.jumdataAppSecret || process.env.JUMDATA_APP_SECRET || '').trim();
    const templateId = (cfg?.jumdataSmsTemplateId || process.env.JUMDATA_SMS_TEMPLATE_ID || 'JM1000372').trim();
    const allowMock = process.env.JUMDATA_SMS_MOCK !== 'false';
    const isLiveConfigured = Boolean(appId && appSecret);
    return { apiUrl, appId, appSecret, templateId, allowMock, isLiveConfigured };
  }

  async getPublicStatus() {
    const cfg = await this.resolveConfig();
    return {
      provider: 'JUMDATA',
      providerName: '聚美智数短信验证码',
      mode: cfg.isLiveConfigured ? 'LIVE' : cfg.allowMock ? 'MOCK' : 'UNCONFIGURED',
      templateId: cfg.templateId,
      cooldownSeconds: COOLDOWN_SECONDS,
      expiresInSeconds: CODE_TTL_SECONDS,
    };
  }

  async getAdminConfig() {
    const cfg = await this.resolveConfig();
    return {
      apiUrl: cfg.apiUrl,
      appId: cfg.appId,
      hasAppSecret: Boolean(cfg.appSecret),
      appSecretMasked: cfg.appSecret
        ? `${cfg.appSecret.slice(0, 4)}****${cfg.appSecret.slice(-4)}`
        : '',
      templateId: cfg.templateId,
      mode: cfg.isLiveConfigured ? 'LIVE' : cfg.allowMock ? 'MOCK' : 'UNCONFIGURED',
    };
  }

  async updateAdminConfig(body: {
    appId?: string;
    appSecret?: string;
    templateId?: string;
  }) {
    const updateData: Record<string, any> = {};
    if (body.appId !== undefined) updateData.jumdataAppId = body.appId.trim() || null;
    if (body.appSecret !== undefined && body.appSecret.trim() !== '') {
      updateData.jumdataAppSecret = body.appSecret.trim();
    }
    if (body.templateId !== undefined) {
      updateData.jumdataSmsTemplateId = body.templateId.trim() || 'JM1000372';
    }
    await this.prisma.systemRuleConfig.upsert({
      where: { id: 'default' },
      update: updateData,
      create: { id: 'default', ...updateData },
    });
    return this.getAdminConfig();
  }

  private codeKey(scene: SmsScene, phone: string) {
    return `lumina:sms:code:${scene}:${phone}`;
  }
  private tryKey(scene: SmsScene, phone: string) {
    return `lumina:sms:try:${scene}:${phone}`;
  }
  private cooldownKey(phone: string) {
    return `lumina:sms:cd:${phone}`;
  }
  private dailyKey(phone: string) {
    const day = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
    return `lumina:sms:daily:${phone}:${day}`;
  }

  /**
   * Computes JumData official SHA-256 signature:
   * sign = sha256(appId + appSecret + timestamp)
   */
  buildJumDataSign(appId: string, appSecret: string, timestamp: string): string {
    return createHash('sha256').update(`${appId}${appSecret}${timestamp}`).digest('hex');
  }

  async sendVerificationCode(rawPhone: string, scene: SmsScene) {
    const phone = this.normalizePhone(rawPhone);

    // 1. 60s send cooldown check
    const cdRemain = await this.redis.getTtlSeconds(this.cooldownKey(phone));
    if (cdRemain > 0) {
      throw new BadRequestException(`发送过于频繁，请 ${cdRemain} 秒后再试`);
    }

    // 2. Daily per-phone quota check
    const dailyCount = await this.redis.incrementWithTtl(this.dailyKey(phone), 86400);
    if (dailyCount > MAX_DAILY_PER_PHONE) {
      throw new BadRequestException('该手机号今日短信验证码发送已达上限，请明日再试');
    }

    const code = String(randomInt(100000, 1000000));
    const cfg = await this.resolveConfig();

    // 3. Dispatch via official JumData /sms/send API or explicit sandbox fallback
    let taskNo: string | undefined;
    let taskId: string | undefined;
    let mode: 'LIVE' | 'MOCK' = 'LIVE';

    if (cfg.isLiveConfigured) {
      const timestamp = String(Date.now());
      const sign = this.buildJumDataSign(cfg.appId, cfg.appSecret, timestamp);

      const form = new URLSearchParams();
      form.set('appId', cfg.appId);
      form.set('timestamp', timestamp);
      form.set('sign', sign);
      form.set('productCode', 'sms');
      form.set('receive', phone);
      form.set('templateId', cfg.templateId);
      form.set('values', code);

      let respJson: any;
      try {
        const resp = await fetch(cfg.apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
          signal: AbortSignal.timeout(10000),
        });
        respJson = await resp.json();
      } catch (err: any) {
        this.logger.error(`JumData SMS HTTP error for ${phone}: ${err?.message || err}`);
        throw new ServiceUnavailableException('短信网关请求超时，请稍后重试');
      }

      if (!respJson || Number(respJson.code) !== 200) {
        const errMsg = respJson?.msg || `短信发送失败（错误码 ${respJson?.code ?? 'UNKNOWN'}）`;
        this.logger.warn(`JumData SMS rejected (${phone}): ${JSON.stringify(respJson)}`);
        throw new BadRequestException(`聚美智数短信发送失败：${errMsg}`);
      }

      taskNo = respJson.taskNo;
      taskId = respJson.data?.taskId;
      this.logger.log(`JumData SMS sent [${scene}] to ${phone} (taskNo=${taskNo}, taskId=${taskId})`);
    } else if (cfg.allowMock) {
      mode = 'MOCK';
      this.logger.log(`[MOCK SMS][${scene}] phone=${phone} code=${code} (configure JUMDATA_APP_ID & JUMDATA_APP_SECRET for live SMS)`);
    } else {
      throw new ServiceUnavailableException('短信通道尚未配置聚美智数 appId 与 appSecret，请联系管理员配置');
    }

    // 4. Store code in Redis with 5-minute TTL + set 60s cooldown + reset attempts
    await this.redis.setValue(this.codeKey(scene, phone), code, CODE_TTL_SECONDS);
    await this.redis.deleteValue(this.tryKey(scene, phone));
    await this.redis.setValue(this.cooldownKey(phone), '1', COOLDOWN_SECONDS);

    return {
      ok: true,
      mode,
      phone,
      expiresInSeconds: CODE_TTL_SECONDS,
      cooldownSeconds: COOLDOWN_SECONDS,
      ...(taskNo ? { taskNo, taskId } : {}),
      ...(mode === 'MOCK' ? { mockCode: code } : {}),
      message:
        mode === 'LIVE'
          ? '短信验证码已发送，请注意查收（5 分钟内有效）'
          : `演示模式验证码：${code}（在「商品与规则」填入聚美智数 appId / appSecret 后即可真实下发短信）`,
    };
  }

  async verifyCode(rawPhone: string, scene: SmsScene, rawCode: string): Promise<string> {
    const phone = this.normalizePhone(rawPhone);
    const inputCode = String(rawCode || '').trim();
    if (!/^\d{6}$/.test(inputCode)) {
      throw new BadRequestException('请输入 6 位数字短信验证码');
    }

    const stored = await this.redis.getValue(this.codeKey(scene, phone));
    if (!stored) {
      throw new BadRequestException('验证码已过期或未发送，请重新获取');
    }

    if (stored !== inputCode) {
      const attempts = await this.redis.incrementWithTtl(this.tryKey(scene, phone), CODE_TTL_SECONDS);
      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        await this.redis.deleteValue(this.codeKey(scene, phone));
        await this.redis.deleteValue(this.tryKey(scene, phone));
        throw new BadRequestException('验证码错误次数过多，已失效，请重新获取');
      }
      throw new BadRequestException(`验证码不正确（还可尝试 ${MAX_VERIFY_ATTEMPTS - attempts} 次）`);
    }

    // Consume code immediately (one-time use)
    await this.redis.deleteValue(this.codeKey(scene, phone));
    await this.redis.deleteValue(this.tryKey(scene, phone));
    return phone;
  }
}
