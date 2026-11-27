import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from './prisma.module';
import { AuthUser } from './auth.decorators';

export const SCOPE_HEADER = 'x-scope-org-id';

export interface ScopedAuthUser extends AuthUser {
  /** Original HQ org id when an HQ user drills down into a dealer view. */
  scopedFromOrgId?: string;
}

/**
 * HQ "organization perspective" drill-down.
 *
 * When an HQ user sends `X-Scope-Org-Id: <dealerOrgId>` on a **read-only GET** request,
 * the request user is projected onto that dealer so every existing list / dashboard endpoint
 * automatically returns the dealer-scoped view. Mutations (POST/PUT/PATCH/DELETE) are never
 * projected, and non-HQ users can never widen their own scope with this header.
 */
@Injectable()
export class ScopeInterceptor implements NestInterceptor {
  private readonly cache = new Map<string, { id: string; name: string; type: string; exp: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    const raw = req.headers?.[SCOPE_HEADER];
    const scopeOrgId = typeof raw === 'string' ? raw.trim() : '';
    const path: string = req.originalUrl || req.url || '';

    if (
      user &&
      user.orgType === 'HQ' &&
      req.method === 'GET' &&
      scopeOrgId &&
      scopeOrgId !== user.orgId &&
      !path.includes('/auth/')
    ) {
      const org = await this.lookup(scopeOrgId);
      if (org && org.type === 'DEALER') {
        const projected: ScopedAuthUser = {
          ...user,
          orgId: org.id,
          orgType: 'DEALER',
          orgName: org.name,
          scopedFromOrgId: user.orgId,
        };
        req.user = projected;
      }
    }
    return next.handle();
  }

  private async lookup(id: string) {
    const now = Date.now();
    const hit = this.cache.get(id);
    if (hit && hit.exp > now) return hit;
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: { id: true, name: true, type: true, status: true },
    });
    if (!org || org.status !== 'ACTIVE') return null;
    const entry = { id: org.id, name: org.name, type: org.type, exp: now + 60_000 };
    this.cache.set(id, entry);
    return entry;
  }
}
