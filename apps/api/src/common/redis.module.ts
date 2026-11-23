import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;
  private readonly memoryLocks = new Map<string, number>();

  constructor() {
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = Number(process.env.REDIS_PORT || 6379);
    let redis: Redis | null = null;
    try {
      redis = new Redis({
        host,
        port,
        maxRetriesPerRequest: 2,
        lazyConnect: true,
        retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
      });
      redis.on('error', (err) => {
        this.logger.warn(`Redis warning (falling back safely if needed): ${err.message}`);
      });
    } catch {
      redis = null;
    }
    this.client = redis;
  }

  /**
   * Acquires a short-lived distributed mutex lock (NX PX) to guarantee first-come-first-served
   * semantics for clinic reporting and concurrent stock scanning.
   */
  async acquireLock(key: string, ttlMs = 5000): Promise<boolean> {
    if (this.client) {
      try {
        const res = await this.client.set(key, '1', 'PX', ttlMs, 'NX');
        return res === 'OK';
      } catch {
        // Fallback to in-process lock if Redis temporarily unavailable
      }
    }
    const now = Date.now();
    const existing = this.memoryLocks.get(key);
    if (existing && existing > now) return false;
    this.memoryLocks.set(key, now + ttlMs);
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    if (this.client) {
      try {
        await this.client.del(key);
      } catch {
        // ignore
      }
    }
    this.memoryLocks.delete(key);
  }

  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const acquired = await this.acquireLock(key, ttlMs);
    if (!acquired) {
      throw new Error('操作并发冲突，请 1 秒后重试');
    }
    try {
      return await fn();
    } finally {
      await this.releaseLock(key);
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit().catch(() => undefined);
    }
  }
}

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
