import {
  Body,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Module,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { AuthGuard, PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma.module';
import { AuthUser, CurrentUser, IS_PUBLIC_KEY, Public } from '../../common/auth.decorators';

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
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { org: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('账号不存在或已停用');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('用户名或密码错误');
    }

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

  async getDemoAccounts() {
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      include: { org: true },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => ({
      username: u.username,
      realName: u.realName,
      roleCode: u.roleCode,
      orgName: u.org.name,
      orgType: u.org.type,
    }));
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() body: { username: string; password: string }) {
    return this.authService.login(body.username, body.password);
  }

  @Public()
  @Get('demo-accounts')
  getDemoAccounts() {
    return this.authService.getDemoAccounts();
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
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
    AuthService,
    JwtStrategy,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
