import { Body, Controller, Delete, Get, HttpException, Module, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/auth.decorators';
import { CrmModule } from '../crm/crm.module';
import { ClinicModule } from '../clinic/clinic.module';
import { TraceModule } from '../trace/trace.module';
import { AiService, ChatContext } from './ai.service';
import { AiToolsService } from './ai-tools.service';

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('meta')
  meta() {
    return this.ai.modelInfo();
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.ai.listSessions(user);
  }

  @Get('sessions/:id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ai.getMessages(user, id);
  }

  @Delete('sessions/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ai.deleteSession(user, id);
  }

  @Post('chat/stream')
  async stream(
    @CurrentUser() user: AuthUser,
    @Body() body: { sessionId?: string; message: string; context?: ChatContext },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      await this.ai.enforceRateLimit(user.userId);
    } catch (err) {
      const e = err as HttpException;
      res.status(e.getStatus?.() || 429).json({ message: e.message });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const controller = new AbortController();
    let finished = false;
    res.on('close', () => {
      if (!finished) controller.abort();
    });

    const emit = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15000);

    try {
      await this.ai.chat(user, body || ({} as any), emit, controller.signal);
    } catch (err: any) {
      emit('error', { message: err?.message && err instanceof HttpException ? err.message : 'AI 助手暂时无法响应，请稍后重试' });
    } finally {
      finished = true;
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
    void req;
  }
}

@Module({
  imports: [CrmModule, ClinicModule, TraceModule],
  controllers: [AiController],
  providers: [AiService, AiToolsService],
})
export class AiModule {}
