<template>
  <transition name="drawer">
    <aside v-if="modelValue" class="ai-drawer" aria-label="AI 业务助手">
      <!-- 顶栏 -->
      <header class="ai-head">
        <div class="ai-title">
          <span>AI 业务助手</span>
          <span v-if="modelName" class="model-badge">{{ modelName }}</span>
        </div>
        <div class="ai-head-actions">
          <el-dropdown trigger="click" @visible-change="onHistoryToggle" @command="openSession">
            <button type="button" class="head-btn">历史<el-icon><ArrowDown /></el-icon></button>
            <template #dropdown>
              <el-dropdown-menu class="ai-history-menu">
                <div v-if="!sessions.length" class="history-empty">暂无历史会话</div>
                <el-dropdown-item v-for="s in sessions" :key="s.id" :command="s.id">
                  <div class="history-row">
                    <span class="history-title">{{ s.title }}</span>
                    <span class="history-time">{{ shortTime(s.updatedAt) }}</span>
                    <button type="button" class="history-del" title="删除" @click.stop="removeSession(s.id)">×</button>
                  </div>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <button type="button" class="head-btn" @click="newChat">新对话</button>
          <button type="button" class="head-close" aria-label="关闭" @click="close">
            <el-icon><Close /></el-icon>
          </button>
        </div>
      </header>

      <!-- 消息流 -->
      <div ref="scrollRef" class="ai-body">
        <div v-if="!messages.length" class="ai-empty">
          <div class="empty-scope">
            <span class="empty-key">当前视角</span>
            <span class="empty-val">{{ scopeLabel }}</span>
          </div>
          <p class="empty-desc">基于实时业务库只读查数：流向追溯、订单与拿货、库存、预警、机构保护期、拜访业绩与规则流程。</p>
          <div class="suggest-list">
            <button v-for="q in suggestions" :key="q" type="button" class="suggest" @click="send(q)">{{ q }}</button>
          </div>
        </div>

        <template v-for="(m, idx) in messages" :key="idx">
          <div v-if="m.role === 'user'" class="msg-user">
            <div class="bubble">{{ m.content }}</div>
          </div>
          <div v-else class="msg-ai">
            <div v-if="m.tools.length || m.statusLabel" class="tool-strip" :class="{ live: m.streaming && !m.tools.length }">
              <template v-if="m.tools.length && !m.streaming">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                已查询：{{ m.tools.join(' · ') }}
              </template>
              <template v-else>
                <span class="spinner" />
                {{ m.statusLabel || '正在思考…' }}
              </template>
            </div>
            <div v-if="m.content" class="md" v-html="renderMarkdown(m.content)" />
            <div v-else-if="m.streaming && !m.statusLabel" class="typing"><span /><span /><span /></div>

            <div v-for="(card, ci) in m.cards" :key="ci" class="data-card">
              <div class="card-title">{{ card.title }}</div>
              <div v-if="card.type === 'metrics'" class="metrics">
                <div v-for="it in card.items" :key="it.label" class="metric">
                  <div class="metric-label">{{ it.label }}</div>
                  <div class="metric-value" :class="it.tone">{{ it.value }}</div>
                </div>
              </div>
              <div v-else class="mini-table-wrap">
                <table class="mini-table">
                  <thead>
                    <tr><th v-for="c in card.columns" :key="c">{{ c }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, ri) in card.rows" :key="ri">
                      <td v-for="(cell, cj) in row" :key="cj">{{ cell }}</td>
                    </tr>
                    <tr v-if="!card.rows?.length"><td :colspan="card.columns?.length || 1" class="empty-cell">暂无匹配记录</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div v-if="m.actions.length" class="action-row">
              <button v-for="a in m.actions" :key="a.label" type="button" class="action-btn" @click="goAction(a)">
                {{ a.label }}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
              </button>
            </div>
            <div v-if="m.error" class="msg-error">{{ m.error }}</div>
          </div>
        </template>
      </div>

      <!-- 上下文提示 -->
      <div v-if="contextCode && !contextDismissed" class="ctx-chip">
        <span>已关联上下文：<code>{{ contextCode }}</code></span>
        <button type="button" aria-label="移除上下文" @click="contextDismissed = true">×</button>
      </div>

      <!-- 输入区 -->
      <footer class="ai-input">
        <div class="input-box">
          <textarea
            ref="inputRef"
            v-model="draft"
            rows="1"
            placeholder="问数据、查链路、问流程…"
            @input="autosize"
            @keydown.enter.exact.prevent="send()"
          />
          <button v-if="streaming" type="button" class="send-btn" title="停止生成" @click="stop">
            <svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
          </button>
          <button v-else type="button" class="send-btn" :disabled="!draft.trim()" title="发送（Enter）" @click="send()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
          </button>
        </div>
        <div class="input-note">仅执行权限内只读查数，数据实时来自业务库 · Shift+Enter 换行</div>
      </footer>
    </aside>
  </transition>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowDown, Close } from '@element-plus/icons-vue';
import { api, API_BASE } from '../utils/api';
import { useAuthStore } from '../stores/auth';
import { useScopeStore } from '../stores/scope';

interface DataCard {
  type: 'table' | 'metrics';
  title: string;
  columns?: string[];
  rows?: Array<Array<string | number>>;
  items?: Array<{ label: string; value: string | number; tone?: string }>;
}
interface AiAction {
  label: string;
  route: string;
  query?: Record<string, string>;
}
interface UiMessage {
  role: 'user' | 'assistant';
  content: string;
  tools: string[];
  statusLabel?: string;
  cards: DataCard[];
  actions: AiAction[];
  streaming?: boolean;
  error?: string;
}

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>();

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const scope = useScopeStore();

const messages = ref<UiMessage[]>([]);
const draft = ref('');
const streaming = ref(false);
const sessionId = ref<string>('');
const sessions = ref<Array<{ id: string; title: string; updatedAt: string }>>([]);
const modelName = ref('');
const scrollRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);
const contextDismissed = ref(false);
let controller: AbortController | null = null;

const scopeLabel = computed(() => (auth.isHQ ? scope.label : auth.user?.orgName || '本服务商'));

const contextCode = computed(() => {
  const c = route.query.code;
  return typeof c === 'string' && c.trim() ? c.trim().toUpperCase() : '';
});

watch(contextCode, () => {
  contextDismissed.value = false;
});

const suggestions = computed(() => {
  const path = route.path;
  const code = contextCode.value || 'BES0GHDKZ3Z4R3PC';
  if (path === '/trace') {
    return [
      `查一下防伪码 ${code} 走过哪些环节，有没有跨区窜货？`,
      '现在有哪些没处理的窜货预警？',
      '高频验真的码有哪些？',
      '顾客验真跨区是怎么判定的？',
    ];
  }
  if (path === '/sales' || path === '/purchase') {
    return [
      '现在有哪些待扫码出库和待特批的订单？',
      '本月哪个代理商拿货金额最高？',
      '这张单打 3.2 折为什么提交不了？特批怎么走？',
      '退货回仓应该怎么操作？',
    ];
  }
  if (path === '/crm') {
    return [
      '本月各业务员拜访得分排名是多少？',
      '本月有哪些优秀门店？',
      '拜访得分是怎么计算的？',
      '30 天内快要解绑的机构有哪些？',
    ];
  }
  if (path === '/inventory') {
    return ['哪些商品低于库存预警线？', '各仓库当前在库多少盒？', '本月哪个代理商拿货金额最高？', '盘点出现账实差异怎么处理？'];
  }
  if (path === '/channels') {
    return ['30 天内快要解绑的机构有哪些？', '现在有哪些没处理的窜货预警？', '机构报备保护期规则是什么？', '本月哪个代理商拿货金额最高？'];
  }
  return [
    '今天有哪些待处理事项？',
    '本月哪个代理商拿货金额最高？各业务员拜访得分排名？',
    '现在有哪些没处理的窜货预警，以及 30 天内快要解绑的机构？',
    `查一下防伪码 ${code} 走过哪些环节？`,
  ];
});

function close() {
  emit('update:modelValue', false);
}

function shortTime(t: string) {
  const d = new Date(t);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

async function loadMeta() {
  try {
    const meta = (await api.get('/ai/meta')) as any;
    modelName.value = meta?.model || '';
  } catch {
    modelName.value = '';
  }
}

async function onHistoryToggle(visible: boolean) {
  if (!visible) return;
  try {
    sessions.value = (await api.get('/ai/sessions')) as any;
  } catch {
    sessions.value = [];
  }
}

async function openSession(id: string) {
  if (!id || streaming.value) return;
  const data = (await api.get(`/ai/sessions/${id}/messages`)) as any;
  sessionId.value = id;
  messages.value = (data.messages || []).map((m: any) => {
    const sd = m.structuredData;
    const cards: DataCard[] = Array.isArray(sd) ? sd : sd ? [sd] : [];
    const trace = Array.isArray(m.toolTrace) ? m.toolTrace : [];
    return {
      role: m.role,
      content: m.content,
      tools: trace.map((t: any) => toolShort(t.tool)),
      cards,
      actions: Array.isArray(m.actions) ? m.actions : [],
    } as UiMessage;
  });
  scrollToBottom();
}

async function removeSession(id: string) {
  await api.delete(`/ai/sessions/${id}`);
  sessions.value = sessions.value.filter((s) => s.id !== id);
  if (sessionId.value === id) newChat();
}

const TOOL_SHORT: Record<string, string> = {
  get_pending_work_summary: '待办汇总',
  trace_code_timeline: '防伪码链路',
  query_stock_balances: '实时库存',
  query_sales_orders: '销售订单',
  query_compliance_alerts: '合规预警',
  query_clinic_protection: '机构保护期',
  query_crm_visit_stats: '拜访统计',
  get_business_rules_and_sop: '规则与流程',
};
function toolShort(t: string) {
  return TOOL_SHORT[t] || t;
}

function newChat() {
  stop();
  messages.value = [];
  sessionId.value = '';
  nextTick(() => inputRef.value?.focus());
}

function autosize() {
  const el = inputRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
}

function scrollToBottom() {
  nextTick(() => {
    const el = scrollRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function stop() {
  controller?.abort();
  controller = null;
}

function goAction(a: AiAction) {
  router.push({ path: a.route, query: a.query || {} });
}

async function send(text?: string) {
  const message = (text ?? draft.value).trim();
  if (!message || streaming.value) return;
  draft.value = '';
  nextTick(autosize);

  messages.value.push({ role: 'user', content: message, tools: [], cards: [], actions: [] });
  messages.value.push({ role: 'assistant', content: '', tools: [], cards: [], actions: [], streaming: true });
  const ai = messages.value[messages.value.length - 1];
  const seenTools = new Set<string>();
  streaming.value = true;
  scrollToBottom();

  controller = new AbortController();
  try {
    const res = await fetch(`${API_BASE}/ai/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('lumina_token') || ''}`,
      },
      body: JSON.stringify({
        sessionId: sessionId.value || undefined,
        message,
        context: {
          route: route.fullPath,
          scopeOrgId: auth.isHQ ? scope.scopeOrgId || undefined : undefined,
          activeCode: contextCode.value && !contextDismissed.value ? contextCode.value : undefined,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        window.location.href = `${API_BASE.replace(/\/api\/v1$/, '')}/login`;
        return;
      }
      throw new Error(body?.message || 'AI 助手暂时无法响应');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = 'message';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        let payload: any;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        if (event === 'session') {
          sessionId.value = payload.sessionId;
          if (payload.model) modelName.value = payload.model;
        } else if (event === 'status') {
          ai.statusLabel = payload.label;
          if (payload.tool && !seenTools.has(payload.tool)) {
            seenTools.add(payload.tool);
          }
        } else if (event === 'delta') {
          ai.content += payload.text || '';
          scrollToBottom();
        } else if (event === 'data_card') {
          ai.cards = Array.isArray(payload) ? payload : [payload];
        } else if (event === 'actions') {
          ai.actions = Array.isArray(payload) ? payload : [];
        } else if (event === 'done') {
          ai.tools = (payload.tools || []).filter((t: string, i: number, arr: string[]) => arr.indexOf(t) === i);
        } else if (event === 'error') {
          ai.error = payload.message || 'AI 助手暂时无法响应，请稍后重试';
        }
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      if (ai.content) ai.content += '\n\n（已停止生成）';
      else ai.error = '已停止生成';
    } else {
      ai.error = err?.message || 'AI 助手暂时无法响应，请稍后重试';
    }
  } finally {
    ai.streaming = false;
    ai.statusLabel = '';
    if (!ai.tools.length && seenTools.size) ai.tools = [...seenTools].map(toolShort);
    streaming.value = false;
    controller = null;
    scrollToBottom();
  }
}

// ---------------------------------------------------------------------------
// Minimal, safe Markdown renderer (escape first, then a small whitelist)
// ---------------------------------------------------------------------------
function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function inline(s: string) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
}
function renderMarkdown(src: string) {
  const lines = src.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let i = 0;
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (/^\|.*\|$/.test(t) && i + 1 < lines.length && /^\|[\s:-|]+\|$/.test(lines[i + 1].trim())) {
      closeList();
      const head = t.slice(1, -1).split('|').map((c) => `<th>${inline(c.trim())}</th>`).join('');
      i += 2;
      const rows: string[] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        rows.push(
          `<tr>${lines[i].trim().slice(1, -1).split('|').map((c) => `<td>${inline(c.trim())}</td>`).join('')}</tr>`,
        );
        i += 1;
      }
      out.push(`<div class="md-table"><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
      continue;
    }
    const h = t.match(/^#{1,4}\s+(.*)$/);
    const ul = t.match(/^[-*•]\s+(.*)$/);
    const ol = t.match(/^\d+[.)、]\s+(.*)$/);
    if (h) {
      closeList();
      out.push(`<p class="md-h">${inline(h[1])}</p>`);
    } else if (ul) {
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inline(ul[1])}</li>`);
    } else if (ol) {
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inline(ol[1])}</li>`);
    } else if (!t) {
      closeList();
    } else if (/^-{3,}$/.test(t)) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(t)}</p>`);
    }
    i += 1;
  }
  closeList();
  return out.join('');
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      if (!modelName.value) loadMeta();
      nextTick(() => inputRef.value?.focus());
    }
  },
);

onMounted(() => {
  if (props.modelValue) loadMeta();
});
</script>

<style scoped>
.ai-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 420px;
  max-width: 100vw;
  background: #ffffff;
  border-left: 1px solid var(--border-hairline);
  box-shadow: var(--shadow-pop);
  z-index: 60;
  display: flex;
  flex-direction: column;
}
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(24px);
  opacity: 0;
}

.ai-head {
  height: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 18px;
  border-bottom: 1px solid var(--border-hairline);
}
.ai-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-primary);
}
.model-badge {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--ink-muted);
  border: 1px solid var(--border-hairline);
  border-radius: 4px;
  padding: 0 6px;
  line-height: 18px;
  font-family: var(--font-mono);
}
.ai-head-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.head-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 0;
  background: transparent;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink-secondary);
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.head-btn:hover {
  background: var(--bg-subtle);
  color: var(--ink-primary);
}
.head-close {
  width: 30px;
  height: 30px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  color: var(--ink-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
}
.head-close:hover {
  background: var(--bg-subtle);
  color: var(--ink-primary);
}
:deep(.ai-history-menu) {
  width: 300px;
  max-height: 360px;
  overflow-y: auto;
}
.history-empty {
  padding: 14px 16px;
  font-size: 12.5px;
  color: var(--ink-muted);
}
.history-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 260px;
}
.history-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}
.history-time {
  font-size: 11px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}
.history-del {
  border: 0;
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
}
.history-del:hover {
  color: var(--status-danger);
}

.ai-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 18px 12px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.ai-empty {
  padding-top: 8px;
}
.empty-scope {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
}
.empty-key {
  color: var(--ink-muted);
}
.empty-val {
  color: var(--ink-primary);
  font-weight: 600;
}
.empty-desc {
  margin: 10px 0 18px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ink-muted);
}
.suggest-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.suggest {
  text-align: left;
  border: 1px solid var(--border-hairline);
  background: #ffffff;
  border-radius: 6px;
  padding: 9px 12px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-primary);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.suggest:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

.msg-user {
  display: flex;
  justify-content: flex-end;
}
.msg-user .bubble {
  max-width: 86%;
  background: var(--bg-subtle);
  color: var(--ink-primary);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-ai {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tool-strip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  font-size: 11.5px;
  color: var(--ink-muted);
  background: var(--bg-rail);
  border: 1px solid var(--border-hairline);
  border-radius: 4px;
  padding: 2px 8px;
}
.tool-strip svg {
  width: 12px;
  height: 12px;
  color: var(--status-ok);
}
.spinner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  border-top-color: var(--ink-primary);
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.typing {
  display: inline-flex;
  gap: 4px;
  padding: 4px 0;
}
.typing span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ink-muted);
  animation: blink 1.2s infinite ease-in-out;
}
.typing span:nth-child(2) {
  animation-delay: 0.15s;
}
.typing span:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes blink {
  50% {
    opacity: 0.25;
  }
}

.md {
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--ink-primary);
  word-break: break-word;
}
.md :deep(p) {
  margin: 0 0 6px;
}
.md :deep(.md-h) {
  font-weight: 600;
  margin-top: 6px;
}
.md :deep(ul),
.md :deep(ol) {
  margin: 2px 0 8px;
  padding-left: 18px;
}
.md :deep(li) {
  margin: 2px 0;
}
.md :deep(strong) {
  font-weight: 600;
}
.md :deep(code) {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--bg-subtle);
  border-radius: 4px;
  padding: 1px 5px;
}
.md :deep(.md-table) {
  overflow-x: auto;
  margin: 4px 0 8px;
}
.md :deep(table) {
  border-collapse: collapse;
  font-size: 12px;
  width: 100%;
}
.md :deep(th),
.md :deep(td) {
  border-bottom: 1px solid var(--border-hairline);
  padding: 5px 8px;
  text-align: left;
  white-space: nowrap;
}
.md :deep(th) {
  color: var(--ink-muted);
  font-weight: 500;
  background: var(--bg-rail);
}

.data-card {
  border: 1px solid var(--border-hairline);
  border-radius: 8px;
  overflow: hidden;
}
.card-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-primary);
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-hairline);
  background: var(--bg-rail);
}
.metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.metric {
  padding: 9px 12px;
  border-top: 1px solid var(--border-hairline);
  min-width: 0;
}
.metric:nth-child(-n + 2) {
  border-top: 0;
}
.metric:nth-child(even) {
  border-left: 1px solid var(--border-hairline);
}
.metric-label {
  font-size: 11px;
  color: var(--ink-muted);
}
.metric-value {
  margin-top: 2px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink-primary);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.metric-value.danger {
  color: var(--status-danger);
}
.metric-value.warn {
  color: var(--status-warn);
}
.metric-value.ok {
  color: var(--status-ok);
}
.mini-table-wrap {
  overflow-x: auto;
}
.mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.mini-table th {
  text-align: left;
  font-weight: 500;
  color: var(--ink-muted);
  padding: 6px 12px;
  white-space: nowrap;
  border-bottom: 1px solid var(--border-hairline);
}
.mini-table td {
  padding: 7px 12px;
  border-bottom: 1px solid var(--border-hairline);
  color: var(--ink-primary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.mini-table tr:last-child td {
  border-bottom: 0;
}
.empty-cell {
  color: var(--ink-muted);
  text-align: center;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border-strong);
  background: #ffffff;
  border-radius: 6px;
  padding: 5px 10px;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink-primary);
  cursor: pointer;
}
.action-btn svg {
  width: 13px;
  height: 13px;
}
.action-btn:hover {
  border-color: #111827;
}
.msg-error {
  font-size: 12.5px;
  color: var(--status-danger);
  background: var(--status-danger-bg);
  border: 1px solid var(--status-danger-line);
  border-radius: 6px;
  padding: 7px 10px;
}

.ctx-chip {
  margin: 0 18px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-secondary);
  background: var(--bg-rail);
  border: 1px solid var(--border-hairline);
  border-radius: 6px;
  padding: 5px 10px;
}
.ctx-chip code {
  font-family: var(--font-mono);
  color: var(--ink-primary);
}
.ctx-chip button {
  border: 0;
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
  font-size: 14px;
}

.ai-input {
  flex-shrink: 0;
  padding: 10px 18px 14px;
  border-top: 1px solid var(--border-hairline);
}
.input-box {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 8px 8px 8px 12px;
  transition: border-color 0.15s ease;
}
.input-box:focus-within {
  border-color: #111827;
}
.input-box textarea {
  flex: 1;
  border: 0;
  outline: none;
  resize: none;
  font-family: inherit;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--ink-primary);
  max-height: 140px;
  background: transparent;
  padding: 3px 0;
}
.input-box textarea::placeholder {
  color: #9ca3af;
}
.send-btn {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border: 0;
  border-radius: 6px;
  background: #111827;
  color: #ffffff;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.send-btn svg {
  width: 15px;
  height: 15px;
}
.send-btn:hover:not(:disabled) {
  background: #1f2937;
}
.send-btn:disabled {
  background: #d1d5db;
  cursor: not-allowed;
}
.input-note {
  margin-top: 7px;
  font-size: 11px;
  color: var(--ink-muted);
}

@media (max-width: 1080px) {
  .ai-drawer {
    width: min(420px, 100vw);
  }
}
</style>
