<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">操作审计日志</h1>
        <p class="page-subtitle">入库、出库、特批、预警处置、规则修改与 AI 查询全部留痕，共 {{ total }} 条</p>
      </div>
      <div class="page-actions">
        <el-button @click="exportCsv">导出 CSV</el-button>
      </div>
    </div>

    <div class="filters">
      <el-select v-model="filters.module" placeholder="全部模块" clearable style="width: 140px" @change="reload">
        <el-option v-for="m in modules" :key="m.value" :label="m.label" :value="m.value" />
      </el-select>
      <el-input v-model="filters.operator" placeholder="操作人" clearable style="width: 140px" @change="reload" />
      <el-input v-model="filters.keyword" placeholder="单号 / 摘要关键字" clearable style="width: 220px" @change="reload" />
      <el-date-picker
        v-model="dateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
        style="width: 260px"
        @change="reload"
      />
      <el-button @click="resetFilters">重置</el-button>
    </div>

    <div class="table-shell">
      <el-table
        v-loading="loading"
        :data="items"
        size="small"
        style="width: 100%"
        row-key="id"
        empty-text="当前筛选下暂无操作记录"
      >
        <el-table-column type="expand" width="36">
          <template #default="{ row }">
            <div class="diff-box">
              <div class="diff-meta">
                <span>对象类型：{{ row.targetType || '—' }}</span>
                <span>对象标识：<code>{{ row.targetId || '—' }}</code></span>
                <span>角色：{{ roleLabel(row.roleCode) }}</span>
              </div>
              <pre class="diff-json">{{ pretty(row.diffSnapshot) }}</pre>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="150">
          <template #default="{ row }"><span class="mono cell-sub">{{ fmt(row.createdAt) }}</span></template>
        </el-table-column>
        <el-table-column label="模块" width="104">
          <template #default="{ row }"><span class="status-tag" :class="moduleTone(row.module)">{{ moduleLabel(row.module) }}</span></template>
        </el-table-column>
        <el-table-column label="操作摘要" min-width="320">
          <template #default="{ row }"><span class="summary">{{ row.summary }}</span></template>
        </el-table-column>
        <el-table-column label="操作人" width="140">
          <template #default="{ row }">{{ row.operatorName }}</template>
        </el-table-column>
        <el-table-column label="所属组织" min-width="150" show-overflow-tooltip>
          <template #default="{ row }"><span class="cell-sub">{{ row.orgName }}</span></template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="total"
          :page-size="pageSize"
          :current-page="page"
          @current-change="(p: number) => load(p)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../utils/api';

const items = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const modules = ref<Array<{ value: string; label: string }>>([]);
const dateRange = ref<[string, string] | null>(null);
const filters = reactive({ module: '', operator: '', keyword: '' });

const MODULE_LABEL: Record<string, string> = {
  STOCK: '出入库',
  ORDER: '订单',
  TRACE: '溯源预警',
  CLINIC: '机构保护',
  CRM: '客户拜访',
  RULE: '规则配置',
  ORG: '组织仓库',
  PRODUCT: '商品资料',
  REBATE: '返点',
  AI: 'AI 助手',
};

function moduleLabel(m: string) {
  return MODULE_LABEL[m] || m;
}
function moduleTone(m: string) {
  if (m === 'RULE') return 'warn';
  if (m === 'TRACE') return 'danger';
  return '';
}
function roleLabel(r?: string) {
  const map: Record<string, string> = {
    HQ_ADMIN: '品牌总部管理员',
    HQ_WAREHOUSE: '总仓库管',
    HQ_COMPLIANCE: '流向管控负责人',
    DEALER_ADMIN: '服务商负责人',
    DEALER_WAREHOUSE: '服务商库管',
    SALES_REP: '外勤销售',
  };
  return (r && map[r]) || r || '—';
}
function fmt(t: string) {
  return new Date(t).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }).replace(/\//g, '-').slice(0, 16);
}
function pretty(v: unknown) {
  try {
    return JSON.stringify(v ?? {}, null, 2);
  } catch {
    return String(v);
  }
}

async function load(p = 1) {
  loading.value = true;
  try {
    const res = (await api.get('/audit-logs', {
      params: {
        page: p,
        pageSize,
        module: filters.module || undefined,
        operator: filters.operator || undefined,
        keyword: filters.keyword || undefined,
        dateFrom: dateRange.value?.[0],
        dateTo: dateRange.value?.[1],
      },
    })) as any;
    items.value = res.items || [];
    total.value = res.total || 0;
    page.value = res.page || p;
    if (res.modules) modules.value = res.modules;
  } finally {
    loading.value = false;
  }
}

function reload() {
  load(1);
}

function resetFilters() {
  filters.module = '';
  filters.operator = '';
  filters.keyword = '';
  dateRange.value = null;
  load(1);
}

function exportCsv() {
  const header = ['时间', '模块', '动作', '操作摘要', '操作人', '角色', '所属组织', '对象标识'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = items.value.map((r) =>
    [fmt(r.createdAt), moduleLabel(r.module), r.action, r.summary, r.operatorName, roleLabel(r.roleCode), r.orgName, r.targetId]
      .map(esc)
      .join(','),
  );
  const blob = new Blob([`\ufeff${header.join(',')}\n${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lumina-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

onMounted(() => load(1));
</script>

<style scoped>
.filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.filters .el-button {
  margin-left: 0;
}
.table-shell {
  border: 1px solid var(--border-hairline);
  border-radius: 8px;
  overflow: hidden;
}
.pager {
  padding: 4px 14px 14px;
}
.summary {
  color: var(--ink-primary);
}
.cell-sub {
  color: var(--ink-muted);
  font-size: 12.5px;
}
.diff-box {
  padding: 4px 22px 14px 50px;
}
.diff-meta {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--ink-muted);
  margin-bottom: 8px;
}
.diff-meta code {
  font-family: var(--font-mono);
  color: var(--ink-primary);
}
.diff-json {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  background: var(--bg-rail);
  border: 1px solid var(--border-hairline);
  border-radius: 6px;
  padding: 10px 12px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--ink-secondary);
}
</style>
