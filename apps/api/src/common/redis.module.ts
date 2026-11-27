import { ConflictException, Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;
  private readonly memoryLocks = new Map<string, number>();
  private readonly memoryKv = new Map<string, { value: string; expiresAt: number }>();

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
      throw new ConflictException('操作并发冲突，请 1 秒后重试');
    }
    try {
      return await fn();
    } finally {
      await this.releaseLock(key);
    }
  }

  async getValue(key: string): Promise<string | null> {
    if (this.client) {
      try {
        return await this.client.get(key);
      } catch {
        // Fallback to in-memory store
      }
    }
    const entry = this.memoryKv.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.memoryKv.delete(key);
      return null;
    }
    return entry.value;
  }

  async setValue(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.client) {
      try {
        await this.client.set(key, value, 'EX', ttlSeconds);
        return;
      } catch {
        // Fallback to in-memory store
      }
    }
    this.memoryKv.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async deleteValue(key: string): Promise<void> {
    if (this.client) {
      try {
        await this.client.del(key);
      } catch {
        // ignore
      }
    }
    this.memoryKv.delete(key);
  }

  async getTtlSeconds(key: string): Promise<number> {
    if (this.client) {
      try {
        const ttl = await this.client.ttl(key);
        return ttl > 0 ? ttl : 0;
      } catch {
        // Fallback to in-memory store
      }
    }
    const entry = this.memoryKv.get(key);
    if (!entry || entry.expiresAt <= Date.now()) return 0;
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
  }

  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    if (this.client) {
      try {
        const next = await this.client.incr(key);
        if (next === 1) await this.client.expire(key, ttlSeconds);
        return next;
      } catch {
        // Fallback to in-memory store
      }
    }
    const existing = await this.getValue(key);
    const next = (existing ? Number(existing) : 0) + 1;
    await this.setValue(key, String(next), ttlSeconds);
    return next;
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
