import {
  BadRequestException,
  Body,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { AuthGuard, PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma.module';
import { AuthUser, CurrentUser, IS_PUBLIC_KEY, Public } from '../../common/auth.decorators';
import { JumDataSmsService, SmsScene } from './sms.service';

const JWT_SECRET = process.env.JWT_SECRET || 'lumina_jwt_dev_secret_change_in_prod_2026';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: JWT_SECRET,
    });
  }

  async validate(payload: AuthUser): Promise<AuthUser> {
    return payload;
  }
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly smsService: JumDataSmsService,
  ) {}

  private async issueSession(user: {
    id: string;
    username: string;
    realName: string;
    orgId: string;
    roleCode: string;
    org: { type: string; name: string };
  }) {
    const payload: AuthUser = {
      userId: user.id,
      username: user.username,
      realName: user.realName,
      orgId: user.orgId,
      orgType: user.org.type as 'HQ' | 'DEALER',
      orgName: user.org.name,
      roleCode: user.roleCode,
    };
    const accessToken = await this.jwtService.signAsync(payload);
    return { accessToken, user: payload };
  }

  async login(account: string, password: string) {
    const key = String(account || '').trim();
    if (!key || !password) {
      throw new BadRequestException('请输入账号与密码');
    }
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: key }, { phone: key }],
      },
      include: { org: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('账号不存在或已停用');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('账号或密码错误');
    }
    return this.issueSession(user);
  }

  async sendSmsCode(rawPhone: string, scene: SmsScene) {
    if (scene !== 'LOGIN' && scene !== 'REGISTER') {
      throw new BadRequestException('无效的验证码业务场景');
    }
    const phone = this.smsService.normalizePhone(rawPhone);
    const existing = await this.prisma.user.findFirst({
      where: { phone },
      select: { id: true, status: true },
    });

    if (scene === 'LOGIN') {
      // First-time SMS login auto-registers; only block explicitly disabled accounts
      if (existing && existing.status !== 'ACTIVE') {
        throw new UnauthorizedException('该账号已停用，请联系管理员');
      }
    } else if (scene === 'REGISTER') {
      if (existing) {
        throw new BadRequestException('该手机号已注册，请直接使用短信验证码登录');
      }
    }

    return this.smsService.sendVerificationCode(phone, scene);
  }

  async loginBySms(rawPhone: string, code: string) {
    const phone = await this.smsService.verifyCode(rawPhone, 'LOGIN', code);
    let user = await this.prisma.user.findFirst({
      where: { phone },
      include: { org: true },
    });

    if (user) {
      if (user.status !== 'ACTIVE') {
        throw new UnauthorizedException('该账号已停用，请联系管理员');
      }
      const session = await this.issueSession(user);
      return { ...session, isNewUser: false };
    }

    // First-time SMS login: auto-register under default active DEALER org as SALES_REP
    const dealerOrg = await this.prisma.organization.findFirst({
      where: { type: 'DEALER', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!dealerOrg) {
      throw new BadRequestException('系统暂无可加入的启用服务商组织，请联系品牌总部');
    }

    let username = phone;
    const dupUsername = await this.prisma.user.findUnique({ where: { username } });
    if (dupUsername) {
      username = `u_${phone}`;
    }

    const passwordHash = await bcrypt.hash(randomBytes(24).toString('hex'), 10);
    user = await this.prisma.user.create({
      data: {
        orgId: dealerOrg.id,
        roleCode: 'SALES_REP',
        username,
        realName: `用户${phone.slice(-4)}`,
        phone,
        passwordHash,
        status: 'ACTIVE',
      },
      include: { org: true },
    });

    const session = await this.issueSession(user);
    return { ...session, isNewUser: true };
  }

  async registerBySms(body: {
    phone: string;
    code: string;
    realName: string;
    password: string;
    orgId?: string;
    roleCode?: string;
  }) {
    const realName = String(body.realName || '').trim();
    const password = String(body.password || '');
    if (realName.length < 2 || realName.length > 30) {
      throw new BadRequestException('请输入 2–30 个字的真实姓名');
    }
    if (password.length < 6 || password.length > 50) {
      throw new BadRequestException('请设置 6–50 位登录密码');
    }

    const phone = await this.smsService.verifyCode(body.phone, 'REGISTER', body.code);

    const existing = await this.prisma.user.findFirst({ where: { phone } });
    if (existing) {
      throw new BadRequestException('该手机号已注册，请直接登录');
    }

    // Public self-registration only permits joining an active DEALER organization as SALES_REP or DEALER_WAREHOUSE
    let dealerOrg = body.orgId
      ? await this.prisma.organization.findFirst({
          where: { id: body.orgId, type: 'DEALER', status: 'ACTIVE' },
        })
      : null;
    if (!dealerOrg) {
      dealerOrg = await this.prisma.organization.findFirst({
        where: { type: 'DEALER', status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      });
    }
    if (!dealerOrg) {
      throw new BadRequestException('系统暂无可加入的启用服务商组织，请联系品牌总部');
    }

    const allowedSelfRoles = ['SALES_REP', 'DEALER_WAREHOUSE'];
    const roleCode = allowedSelfRoles.includes(String(body.roleCode || ''))
      ? String(body.roleCode)
      : 'SALES_REP';

    let username = phone;
    const dupUsername = await this.prisma.user.findUnique({ where: { username } });
    if (dupUsername) {
      username = `u_${phone}`;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const created = await this.prisma.user.create({
      data: {
        orgId: dealerOrg.id,
        roleCode,
        username,
        realName,
        phone,
        passwordHash,
        status: 'ACTIVE',
      },
      include: { org: true },
    });

    return this.issueSession(created);
  }

  async getRegisterOptions() {
    const [dealers, smsStatus] = await Promise.all([
      this.prisma.organization.findMany({
        where: { type: 'DEALER', status: 'ACTIVE' },
        select: { id: true, name: true, province: true, city: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.smsService.getPublicStatus(),
    ]);
    return {
      dealers,
      roles: [
        { code: 'SALES_REP', label: '外勤销售 / 渠道业务员' },
        { code: 'DEALER_WAREHOUSE', label: '服务商库管' },
      ],
      smsStatus,
    };
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly smsService: JumDataSmsService,
  ) {}

  @Public()
  @Post('login')
  login(@Body() body: { username: string; password: string }) {
    return this.authService.login(body.username, body.password);
  }

  @Public()
  @Post('sms/send')
  sendSms(@Body() body: { phone: string; scene?: SmsScene }) {
    return this.authService.sendSmsCode(body.phone, body.scene || 'LOGIN');
  }

  @Public()
  @Post('login-sms')
  loginBySms(@Body() body: { phone: string; code: string }) {
    return this.authService.loginBySms(body.phone, body.code);
  }

  @Public()
  @Post('register')
  register(
    @Body()
    body: {
      phone: string;
      code: string;
      realName: string;
      password: string;
      orgId?: string;
      roleCode?: string;
    },
  ) {
    return this.authService.registerBySms(body);
  }

  @Public()
  @Get('register-options')
  getRegisterOptions() {
    return this.authService.getRegisterOptions();
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Get('sms/config')
  getSmsConfig(@CurrentUser() user: AuthUser) {
    if (user.orgType !== 'HQ') {
      throw new ForbiddenException('仅品牌总部管理员可查看短信网关配置');
    }
    return this.smsService.getAdminConfig();
  }

  @Put('sms/config')
  updateSmsConfig(
    @CurrentUser() user: AuthUser,
    @Body() body: { appId?: string; appSecret?: string; templateId?: string },
  ) {
    if (user.orgType !== 'HQ') {
      throw new ForbiddenException('仅品牌总部管理员可修改短信网关配置');
    }
    return this.smsService.updateAdminConfig(body);
  }

  @Post('sms/test')
  testSms(@CurrentUser() user: AuthUser, @Body() body: { phone: string }) {
    if (user.orgType !== 'HQ') {
      throw new ForbiddenException('仅品牌总部管理员可发送测试短信');
    }
    return this.smsService.sendVerificationCode(body.phone, 'TEST');
  }
}

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: JWT_SECRET,
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    JumDataSmsService,
    AuthService,
    JwtStrategy,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [AuthService, JumDataSmsService],
})
export class AuthModule {}
