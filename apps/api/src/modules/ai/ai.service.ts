import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.module';
import { RedisService } from '../../common/redis.module';
import { AuthUser } from '../../common/auth.decorators';
import { AuditService } from '../audit/audit.module';
import {
  AI_TOOL_DEFS,
  ALLOWED_ROUTES,
  AiAction,
  AiScope,
  AiToolsService,
  DataCard,
  TOOL_LABELS,
  TOOL_SHORT,
} from './ai-tools.service';

export interface ChatContext {
  route?: string;
  scopeOrgId?: string;
  activeCode?: string;
  activeOrderNo?: string;
}

export type SseEmit = (event: string, data: unknown) => void;

interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

const ROLE_LABEL: Record<string, string> = {
  HQ_ADMIN: '品牌总部管理员',
  HQ_WAREHOUSE: '总仓库管',
  HQ_COMPLIANCE: '流向管控负责人',
  DEALER_ADMIN: '服务商负责人',
  DEALER_WAREHOUSE: '服务商库管',
  SALES_REP: '外勤销售',
};

const ROUTE_LABEL: Record<string, string> = {
  '/': '总控台',
  '/purchase': '扫码入库建档',
  '/sales': '出库与打单',
  '/trace': '流向追溯查询',
  '/inventory': '库存与核验',
  '/crm': '客户拜访赋能',
  '/channels': '代理商与机构',
  '/reports': '报表与返点',
  '/settings': '商品与规则',
  '/audit-logs': '操作审计日志',
};

class UpstreamError extends Error {}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tools: AiToolsService,
    private readonly audit: AuditService,
  ) {}

  private cfg() {
    return {
      key: process.env.BAILIAN_API_KEY || '',
      base: (process.env.BAILIAN_BASE_URL || '').replace(/\/+$/, ''),
      model: process.env.BAILIAN_MODEL || 'deepseek-v4.1-flash',
      timeoutMs: Math.max(5000, Number(process.env.BAILIAN_TIMEOUT_MS) || 45000),
      maxRounds: Math.min(6, Math.max(1, Number(process.env.BAILIAN_MAX_TOOL_ROUNDS) || 4)),
    };
  }

  modelInfo() {
    const c = this.cfg();
    return { model: c.model, configured: Boolean(c.key && c.base) };
  }

  async enforceRateLimit(userId: string) {
    const bucket = Math.floor(Date.now() / 60000);
    const n = await this.redis.incrementWithTtl(`ai:rl:${userId}:${bucket}`, 70);
    if (n > 20) {
      throw new HttpException('提问过于频繁，请 1 分钟后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------
  listSessions(user: AuthUser) {
    return this.prisma.aiChatSession.findMany({
      where: { userId: user.userId },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { id: true, title: true, updatedAt: true, createdAt: true },
    });
  }

  async getMessages(user: AuthUser, id: string) {
    const s = await this.prisma.aiChatSession.findUnique({ where: { id } });
    if (!s || s.userId !== user.userId) throw new HttpException('会话不存在', HttpStatus.NOT_FOUND);
    const messages = await this.prisma.aiChatMessage.findMany({ where: { sessionId: id }, orderBy: { createdAt: 'asc' } });
    return { session: { id: s.id, title: s.title }, messages };
  }

  async deleteSession(user: AuthUser, id: string) {
    const s = await this.prisma.aiChatSession.findUnique({ where: { id } });
    if (!s || s.userId !== user.userId) throw new HttpException('会话不存在', HttpStatus.NOT_FOUND);
    await this.prisma.aiChatSession.delete({ where: { id } });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // LLM transport (OpenAI-compatible Bailian endpoint)
  // ---------------------------------------------------------------------------
  private async callCompletion(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    const c = this.cfg();
    if (!c.key || !c.base) throw new UpstreamError('AI 服务未配置');
    const timeout = AbortSignal.timeout(c.timeoutMs);
    const res = await fetch(`${c.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
      body: JSON.stringify({ model: c.model, ...body }),
      signal: AbortSignal.any([signal, timeout]),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`Bailian HTTP ${res.status}: ${text.slice(0, 300)}`);
      throw new UpstreamError(`upstream ${res.status}`);
    }
    return res;
  }

  private async streamCompletion(body: Record<string, unknown>, signal: AbortSignal, onDelta: (t: string) => void) {
    const res = await this.callCompletion({ ...body, stream: true }, signal);
    if (!res.body) throw new UpstreamError('empty stream');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            full += delta;
            onDelta(delta);
          }
        } catch {
          // ignore keep-alive / partial frames
        }
      }
    }
    return full;
  }

  // ---------------------------------------------------------------------------
  // Prompting
  // ---------------------------------------------------------------------------
  private systemPrompt(user: AuthUser, scope: AiScope, ctx: ChatContext) {
    const today = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
    }).format(new Date());
    const page = ctx.route ? ROUTE_LABEL[ctx.route.split('?')[0]] || ctx.route : '未知页面';
    return [
      '你是「Lumina 品牌供销溯源与渠道运营系统」的内部业务助手，服务于品牌总部、代理商（服务商）与外勤销售。',
      `当前用户：${user.realName}（${ROLE_LABEL[user.roleCode] || user.roleCode}），数据视野：${scope.label}。今天是 ${today}（北京时间）。`,
      `用户当前所在页面：${page}${ctx.activeCode ? `；页面已选中防伪码 ${ctx.activeCode}` : ''}${ctx.activeOrderNo ? `；页面已选中单号 ${ctx.activeOrderNo}` : ''}。`,
      '',
      '工作纪律：',
      '1. 所有数字、单号、防伪码状态、机构归属、规则阈值必须严格来自本轮工具返回的数据；工具未查到时直接回答“当前权限范围内暂无匹配记录”，禁止推测或编造。',
      '2. 需要数据时先调用工具，可一次调用多个；不要向用户索要系统里能查到的信息。问题含糊时按最常见的业务理解直接查询。',
      '3. 回答精简直白、结论先行：先给核心数字或判定结论，再用 2~5 条要点说明；不写寒暄、不写营销套话、不重复工具原始 JSON。',
      '4. 使用简洁 Markdown：加粗关键结论，列表列要点；单号与防伪码用 `行内代码`。系统会在你的回答下方自动附上数据表与跳转按钮，正文无需再画大表格。',
      '5. 本助手只读：若用户要求修改库存、删除单据、审批或越权查询其他组织数据，说明“当前仅支持只读查数与流程引导”，并指引到对应页面操作。',
      '6. 金额统一用人民币 ¥ 并保留两位小数；日期使用北京时间。',
    ].join('\n');
  }

  /** Keyword router used when the upstream model cannot do tool-calling. */
  private heuristicTools(message: string, ctx: ChatContext): Array<{ name: string; args: any }> {
    const out: Array<{ name: string; args: any }> = [];
    const compact = message.replace(/\s+/g, '').toUpperCase();
    const code = compact.match(/[0-9A-Z]{16}/)?.[0] || ctx.activeCode;
    if (code && /码|链路|流向|窜货|验真|走过|护照/.test(message)) out.push({ name: 'trace_code_timeline', args: { codeToken: code } });
    if (/预警|窜货|破价|异常|风险/.test(message)) out.push({ name: 'query_compliance_alerts', args: { status: 'UNRESOLVED' } });
    if (/解绑|保护期|临期|到期|公海/.test(message)) out.push({ name: 'query_clinic_protection', args: { expiringWithinDays: 30 } });
    if (/拜访|业务员|得分|评分|门店评级|纳新/.test(message)) out.push({ name: 'query_crm_visit_stats', args: {} });
    if (/库存|在库|有货|缺货/.test(message)) out.push({ name: 'query_stock_balances', args: { lowStockOnly: /缺货|低库存|不足/.test(message) } });
    if (/订单|拿货|金额|销售|排名|供货额/.test(message)) out.push({ name: 'query_sales_orders', args: { groupByDealer: /排名|最高|哪个代理/.test(message) } });
    if (/折|红线|特批|退货|规则|流程|怎么|如何|为什么/.test(message)) out.push({ name: 'get_business_rules_and_sop', args: { topic: 'ALL' } });
    if (/待办|待处理|待出库|今天|巡检/.test(message) || !out.length) out.push({ name: 'get_pending_work_summary', args: {} });
    const seen = new Set<string>();
    return out.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true))).slice(0, 4);
  }

  private trimForLlm(result: unknown) {
    const text = JSON.stringify(result);
    return text.length > 12000 ? `${text.slice(0, 12000)}…（数据过长已截断）` : text;
  }

  private sanitizeActions(list: AiAction[]) {
    const seen = new Set<string>();
    return list
      .filter((a) => a && ALLOWED_ROUTES.has(a.route))
      .filter((a) => {
        const k = `${a.route}?${JSON.stringify(a.query || {})}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 3);
  }

  // ---------------------------------------------------------------------------
  // Main orchestration
  // ---------------------------------------------------------------------------
  async chat(
    user: AuthUser,
    body: { sessionId?: string; message: string; context?: ChatContext },
    emit: SseEmit,
    signal: AbortSignal,
  ) {
    const started = Date.now();
    const message = String(body.message || '').trim().slice(0, 1000);
    if (!message) throw new HttpException('请输入问题', HttpStatus.BAD_REQUEST);
    const ctx: ChatContext = body.context || {};
    const scope = await this.tools.resolveScope(user, ctx.scopeOrgId);
    const c = this.cfg();

    // Session bootstrap
    let session = body.sessionId
      ? await this.prisma.aiChatSession.findUnique({ where: { id: body.sessionId } })
      : null;
    if (session && session.userId !== user.userId) session = null;
    if (!session) {
      session = await this.prisma.aiChatSession.create({
        data: {
          userId: user.userId,
          orgId: user.orgId,
          roleCode: user.roleCode,
          title: message.replace(/\s+/g, ' ').slice(0, 30),
        },
      });
    }
    emit('session', { sessionId: session.id, title: session.title, scope: scope.label, model: c.model });

    const history = await this.prisma.aiChatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { role: true, content: true },
    });
    await this.prisma.aiChatMessage.create({ data: { sessionId: session.id, role: 'user', content: message } });

    const messages: LlmMessage[] = [
      { role: 'system', content: this.systemPrompt(user, scope, ctx) },
      ...history.reverse().map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content.slice(0, 2000) })),
      { role: 'user', content: message },
    ];

    const toolTrace: Array<{ tool: string; args: unknown; ok: boolean; ms: number }> = [];
    const cards: DataCard[] = [];
    const actions: AiAction[] = [];
    let answer = '';
    let usedFallback = false;

    const runTool = async (name: string, args: any) => {
      emit('status', { tool: name, label: TOOL_LABELS[name] || '正在查询…' });
      const t0 = Date.now();
      try {
        const out = await this.tools.execute(name, args, user, scope);
        toolTrace.push({ tool: name, args, ok: true, ms: Date.now() - t0 });
        if (out.card) cards.push(out.card);
        if (out.actions) actions.push(...out.actions);
        return out.result;
      } catch (err: any) {
        toolTrace.push({ tool: name, args, ok: false, ms: Date.now() - t0 });
        this.logger.warn(`Tool ${name} failed: ${err?.message}`);
        return { error: '查询失败，请稍后重试' };
      }
    };

    try {
      // Phase 1: tool planning (non-streaming, bounded rounds)
      let planningOk = true;
      let directAnswer: string | null = null;
      try {
        for (let round = 0; round < c.maxRounds; round += 1) {
          const res = await this.callCompletion(
            { messages, tools: AI_TOOL_DEFS, tool_choice: 'auto', temperature: 0.1, stream: false },
            signal,
          );
          const json: any = await res.json();
          const msg = json?.choices?.[0]?.message;
          const calls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
          if (!calls.length) {
            directAnswer = typeof msg?.content === 'string' ? msg.content : '';
            break;
          }
          messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
          const results = await Promise.all(
            calls.map(async (call: any) => {
              let args: any = {};
              try {
                args = JSON.parse(call.function?.arguments || '{}');
              } catch {
                args = {};
              }
              const result = await runTool(call.function?.name, args);
              return { id: call.id, result };
            }),
          );
          for (const r of results) {
            messages.push({ role: 'tool', tool_call_id: r.id, content: this.trimForLlm(r.result) });
          }
        }
      } catch (err) {
        if (signal.aborted) throw err;
        planningOk = false;
        this.logger.warn(`Tool planning failed, falling back to keyword routing: ${(err as Error).message}`);
      }

      if (!planningOk) {
        usedFallback = true;
        const plan = this.heuristicTools(message, ctx);
        const results: Array<{ tool: string; result: unknown }> = [];
        for (const p of plan) results.push({ tool: p.name, result: await runTool(p.name, p.args) });
        const dataMsg = results.map((r) => `【${TOOL_SHORT[r.tool]}】${this.trimForLlm(r.result)}`).join('\n');
        messages.splice(messages.length - 1, 1, {
          role: 'user',
          content: `${message}\n\n以下是系统刚刚为该问题实时查询到的业务数据（仅可依据这些数据回答）：\n${dataMsg}`,
        });
      }

      // Phase 2: final streamed answer
      if (directAnswer && directAnswer.trim() && planningOk) {
        answer = directAnswer;
        for (const chunk of directAnswer.match(/[\s\S]{1,24}/g) || []) emit('delta', { text: chunk });
      } else {
        try {
          const finalBody: Record<string, unknown> = { messages, temperature: 0.2 };
          if (planningOk && toolTrace.length) {
            finalBody.tools = AI_TOOL_DEFS;
            finalBody.tool_choice = 'none';
          }
          answer = await this.streamCompletion(finalBody, signal, (t) => emit('delta', { text: t }));
        } catch (err) {
          if (signal.aborted) throw err;
          this.logger.warn(`Final stream failed: ${(err as Error).message}`);
          if (!toolTrace.length) {
            // Nothing was fetched yet: run the keyword plan so the user still sees real data
            for (const p of this.heuristicTools(message, ctx)) await runTool(p.name, p.args);
          }
          answer = 'AI 生成服务暂时繁忙，以下为系统按你的问题实时查询到的数据，可直接参考：';
          emit('delta', { text: answer });
        }
        if (!answer.trim()) {
          answer = toolTrace.length ? '已完成查询，结果见下方数据卡片。' : '当前权限范围内暂无匹配记录。';
          emit('delta', { text: answer });
        }
      }

      const finalCards = cards.slice(0, 2);
      const finalActions = this.sanitizeActions(actions);
      if (finalCards.length) emit('data_card', finalCards.length === 1 ? finalCards[0] : finalCards);
      if (finalActions.length) emit('actions', finalActions);

      const latencyMs = Date.now() - started;
      const saved = await this.prisma.aiChatMessage.create({
        data: {
          sessionId: session.id,
          role: 'assistant',
          content: answer,
          toolTrace: toolTrace as any,
          structuredData: finalCards.length ? (finalCards as any) : undefined,
          actions: finalActions as any,
          model: c.model,
          latencyMs,
        },
      });
      await this.prisma.aiChatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
      emit('done', {
        messageId: saved.id,
        latencyMs,
        tools: toolTrace.map((t) => TOOL_SHORT[t.tool] || t.tool),
        fallback: usedFallback,
      });

      void this.audit.log({
        orgId: user.orgId,
        operatorId: user.userId,
        operatorName: user.realName,
        roleCode: user.roleCode,
        module: 'AI',
        action: 'AI_QUERY',
        targetType: 'AiChatSession',
        targetId: session.id,
        summary: `AI 助手查询 · ${message.slice(0, 60)}`,
        diffSnapshot: { scope: scope.label, tools: toolTrace.map((t) => t.tool), latencyMs, fallback: usedFallback },
      });
    } catch (err: any) {
      if (signal.aborted) {
        if (answer) {
          await this.prisma.aiChatMessage
            .create({ data: { sessionId: session.id, role: 'assistant', content: `${answer}\n\n（已停止生成）`, model: c.model } })
            .catch(() => undefined);
        }
        return;
      }
      this.logger.error(`AI chat failed: ${err?.message}`);
      emit('error', { message: 'AI 助手暂时无法响应，请稍后重试' });
    }
  }
}
