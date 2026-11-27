<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">库存与月度核验</h1>
        <p class="page-subtitle">实时在库存穿透查码与月度盘点核验</p>
      </div>
      <div class="page-actions">
        <el-button v-if="auth.isHQ" type="primary" @click="generateCurrentMonth">生成本月核验单</el-button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-cell">
        <div class="kpi-label">当前在库</div>
        <div class="kpi-value">{{ inStockTotal.toLocaleString() }}<span class="unit">盒</span></div>
        <div class="kpi-meta">{{ balances.length }} 个商品 / 仓库组合</div>
      </div>
      <div class="kpi-cell" :class="{ accent: lowStockCount > 0 }">
        <div class="kpi-label">低于预警线</div>
        <div class="kpi-value">{{ lowStockCount }}<span class="unit">项</span></div>
        <div class="kpi-meta">建议及时补货</div>
      </div>
      <div class="kpi-cell" :class="{ accent: pendingRecCount > 0 }">
        <div class="kpi-label">待填报核验单</div>
        <div class="kpi-value">{{ pendingRecCount }}<span class="unit">张</span></div>
        <div class="kpi-meta">服务商尚未提交实盘</div>
      </div>
      <div class="kpi-cell">
        <div class="kpi-label">存在账实差异</div>
        <div class="kpi-value">{{ varianceCount }}<span class="unit">张</span></div>
        <div class="kpi-meta">需流向管控负责人处置</div>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="plain-tabs">
      <el-tab-pane label="实时库存" name="balances">
        <div class="surface-card">
          <div class="toolbar-row">
            <el-select v-model="filterWarehouse" clearable placeholder="全部仓库" class="filter-select" @change="loadBalances(1)">
              <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
            </el-select>
            <el-input
              v-model="keyword"
              placeholder="搜索商品名称或货号"
              clearable
              class="filter-input"
              @keyup.enter="loadBalances(1)"
            />
            <el-button @click="loadBalances(1)">查询</el-button>
            <span class="toolbar-note">点“在库码”可看这一批货具体是哪些码</span>
          </div>

          <el-table :data="balances" size="small" empty-text="没有符合条件的库存">
            <el-table-column label="仓库" min-width="156" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="cell-strong">{{ row.warehouse.name }}</div>
                <div class="cell-sub">{{ row.warehouse.org.name }}</div>
              </template>
            </el-table-column>
            <el-table-column label="商品" min-width="170" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="cell-strong">{{ row.product.name }}</div>
                <div class="cell-sub mono">{{ row.product.skuCode }} · {{ row.product.spec }}</div>
              </template>
            </el-table-column>
            <el-table-column label="品牌" width="108" show-overflow-tooltip>
              <template #default="{ row }">{{ row.product.brand?.name }}</template>
            </el-table-column>
            <el-table-column label="在库" width="92" align="right">
              <template #default="{ row }">
                <span class="stock-qty" :class="{ low: row.qty <= row.warnMinQty }">{{ row.qty }} {{ row.product.unitName }}</span>
              </template>
            </el-table-column>
            <el-table-column label="预警线" width="76" align="right">
              <template #default="{ row }"><span class="mono muted">{{ row.warnMinQty }}</span></template>
            </el-table-column>
            <el-table-column label="" width="82" align="right">
              <template #default="{ row }">
                <el-button size="small" link type="primary" @click="openCodeDrilldown(row)">在库码</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="balTotal"
              :page-size="balPageSize"
              :current-page="balPage"
              @current-change="(p: number) => loadBalances(p)"
            />
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="月度流向核验" name="reconciliation">
        <div class="surface-card flush">
          <el-table :data="reconciliations" size="small" empty-text="本月还没有核验单，点右上角生成">
            <el-table-column label="账期" width="90">
              <template #default="{ row }"><span class="mono">{{ row.periodMonth }}</span></template>
            </el-table-column>
            <el-table-column label="服务商" min-width="148" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="cell-strong">{{ row.org.name }}</div>
                <div v-if="row.org.supplyFrozen" class="frozen-tip">已停供</div>
              </template>
            </el-table-column>
            <el-table-column label="理论" width="80" align="right">
              <template #default="{ row }"><span class="mono">{{ row.totalTheoretical }}</span></template>
            </el-table-column>
            <el-table-column label="实盘" width="80" align="right">
              <template #default="{ row }"><span class="mono">{{ row.totalActual }}</span></template>
            </el-table-column>
            <el-table-column label="差异" width="90" align="right">
              <template #default="{ row }">
                <span class="mono variance" :class="row.totalVariance !== 0 ? 'bad' : 'ok'">
                  {{ row.totalVariance > 0 ? '+' : '' }}{{ row.totalVariance }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <span class="rec-pill" :class="recClass(row.status)">{{ recLabel(row.status) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="dealerNote" label="差异说明" show-overflow-tooltip min-width="136" />
            <el-table-column label="操作" width="132" align="right" :fixed="width <= 1180 ? false : 'right'">
              <template #default="{ row }">
                <el-button
                  v-if="row.status === 'PENDING_SUBMIT'"
                  size="small"
                  type="primary"
                  plain
                  @click="openSubmitRec(row)"
                >
                  填报实盘
                </el-button>
                <el-button
                  v-if="auth.isHQ && row.status === 'VARIANCE_FLAGGED'"
                  size="small"
                  type="danger"
                  @click="openAuditRec(row)"
                >
                  核查处置
                </el-button>
                <span v-else-if="row.hqAuditAction" class="cell-sub">{{ row.hqAuditAction }}</span>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="recTotal"
              :page-size="recPageSize"
              :current-page="recPage"
              @current-change="(p: number) => loadReconciliations(p)"
            />
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="库存流水" name="ledgers">
        <div class="surface-card flush">
          <el-table :data="ledgers" size="small" empty-text="暂无流水">
            <el-table-column label="时间" width="160">
              <template #default="{ row }">
                <span class="mono cell-sub">{{ formatDateTime(row.createdAt, true) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="仓库" width="140">
              <template #default="{ row }">{{ row.warehouse?.name }}</template>
            </el-table-column>
            <el-table-column label="商品" min-width="200">
              <template #default="{ row }">
                {{ row.product?.name }}
                <span class="cell-sub mono">{{ row.product?.skuCode }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="docType" label="业务" width="130" />
            <el-table-column prop="docNo" label="单号" width="150">
              <template #default="{ row }"><span class="mono">{{ row.docNo }}</span></template>
            </el-table-column>
            <el-table-column label="变动" width="80" align="right">
              <template #default="{ row }">
                <span class="mono" :class="row.deltaQty > 0 ? 'plus' : 'minus'">
                  {{ row.deltaQty > 0 ? '+' : '' }}{{ row.deltaQty }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="结存" width="80" align="right">
              <template #default="{ row }"><span class="mono muted">{{ row.afterQty }}</span></template>
            </el-table-column>
          </el-table>
          <div class="table-pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="ledgerTotal"
              :page-size="ledgerPageSize"
              :current-page="ledgerPage"
              @current-change="(p: number) => loadLedgers(p)"
            />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 在库码穿透 -->
    <el-dialog v-model="drillDialog" :title="`在库防伪码 · ${drillTitle}`" width="min(760px, 94vw)" align-center>
      <p class="dialog-note">这些码当前实际存放在该仓库，点击防伪码即可复制。售出后会自动转为“已出库”并挂到客户名下。</p>
      <el-table :data="drillCodes" size="small" style="width: 100%" max-height="420" empty-text="该仓该商品暂无在库码">
        <el-table-column label="级别" width="76">
          <template #default="{ row }">
            <span class="level-tag" :class="row.codeLevel === 'CARTON' ? 'carton' : 'unit'">
              {{ row.codeLevel === 'CARTON' ? '外箱' : '单盒' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="codeToken" label="防伪码" min-width="210">
          <template #default="{ row }">
            <span class="code-chip clickable" title="点击复制" @click="copyCode(row.codeToken)">
              {{ formatCodeGroups(row.codeToken) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="所属外箱" min-width="195">
          <template #default="{ row }">
            <span class="mono cell-sub">{{ row.parent?.codeToken ? formatCodeGroups(row.parent.codeToken) : '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="批次" min-width="135">
          <template #default="{ row }"><span class="mono cell-sub">{{ row.batch?.batchNo }}</span></template>
        </el-table-column>
      </el-table>
      <div class="table-pager">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="drillTotal"
          :page-size="drillPageSize"
          :current-page="drillPage"
          @current-change="(p: number) => loadDrillCodes(p)"
        />
      </div>
    </el-dialog>

    <!-- 实盘填报 -->
    <el-dialog v-model="submitRecDialog" title="提交月度实盘" width="min(660px, 94vw)" align-center>
      <p class="dialog-note">按实际盘点数填写。差异处请写明原因，总部会逐条核查。</p>
      <el-table :data="recSubmitItems" size="small" border>
        <el-table-column prop="productName" label="商品" min-width="160" />
        <el-table-column prop="theoreticalQty" label="系统理论" width="90" align="right" />
        <el-table-column label="实盘数量" width="130">
          <template #default="{ row }">
            <el-input-number v-model="row.actualQty" :min="0" size="small" controls-position="right" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column label="差异说明" min-width="180">
          <template #default="{ row }">
            <el-input v-model="row.explanation" size="small" placeholder="不符时必填" />
          </template>
        </el-table-column>
      </el-table>
      <el-input v-model="recDealerNote" style="margin-top: 12px" placeholder="整体说明（选填）" />
      <template #footer>
        <el-button @click="submitRecDialog = false">取消</el-button>
        <el-button type="primary" @click="doSubmitRec">提交总部核验</el-button>
      </template>
    </el-dialog>

    <!-- 核查处置 -->
    <el-dialog v-model="auditRecDialog" title="账实差异核查处置" width="min(540px, 94vw)" align-center>
      <div class="audit-head">
        <div class="audit-org">{{ activeRec?.org?.name }}</div>
        <div class="audit-diff">
          差异 <span class="mono">{{ activeRec?.totalVariance }}</span> 盒
        </div>
      </div>
      <el-form label-width="90px">
        <el-form-item label="处置措施">
          <el-radio-group v-model="auditAction" class="audit-radios">
            <el-radio value="PASS">解释合理，通过结案</el-radio>
            <el-radio value="RECOUNT">退回重新盘点</el-radio>
            <el-radio value="PRICE_ADJUST">调整供货价阶梯</el-radio>
            <el-radio value="FREEZE_SUPPLY">无法解释，立即停供</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="审核意见">
          <el-input v-model="auditNote" type="textarea" :rows="3" placeholder="记录核查结论，永久留痕" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="auditRecDialog = false">取消</el-button>
        <el-button type="primary" @click="doAuditRec">确认执行</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';
import { formatCodeGroups, formatDateTime, useViewport } from '../utils/format';

const auth = useAuthStore();
const { width } = useViewport();
const isCompact = computed(() => width.value <= 960);
const activeTab = ref('balances');
const warehouses = ref<any[]>([]);
const filterWarehouse = ref('');
const keyword = ref('');
const balances = ref<any[]>([]);
const ledgers = ref<any[]>([]);
const reconciliations = ref<any[]>([]);

const drillDialog = ref(false);
const drillTitle = ref('');
const drillCodes = ref<any[]>([]);

const submitRecDialog = ref(false);
const activeRec = ref<any>(null);
const recSubmitItems = ref<any[]>([]);
const recDealerNote = ref('');

const auditRecDialog = ref(false);
const auditAction = ref<'PASS' | 'RECOUNT' | 'PRICE_ADJUST' | 'FREEZE_SUPPLY'>('RECOUNT');
const auditNote = ref('');

const inStockTotal = computed(() => balances.value.reduce((s, r) => s + Number(r.qty || 0), 0));
const lowStockCount = computed(() => balances.value.filter((r) => Number(r.qty) <= Number(r.warnMinQty)).length);
const pendingRecCount = computed(() => reconciliations.value.filter((r) => r.status === 'PENDING_SUBMIT').length);
const varianceCount = computed(() => reconciliations.value.filter((r) => r.status === 'VARIANCE_FLAGGED').length);

const balPage = ref(1);
const balPageSize = 20;
const balTotal = ref(0);
const recPage = ref(1);
const recPageSize = 20;
const recTotal = ref(0);
const ledgerPage = ref(1);
const ledgerPageSize = 20;
const ledgerTotal = ref(0);
const drillPage = ref(1);
const drillPageSize = 50;
const drillTotal = ref(0);
const drillTarget = ref<{ warehouseId: string; productId: string } | null>(null);

async function loadBalances(p = 1) {
  balPage.value = p;
  const res = (await api.get('/stock/balances', {
    params: {
      warehouseId: filterWarehouse.value || undefined,
      keyword: keyword.value || undefined,
      page: p,
      pageSize: balPageSize,
    },
  })) as any;
  balances.value = Array.isArray(res) ? res : res.items || [];
  balTotal.value = Array.isArray(res) ? res.length : Number(res.total || 0);
}

async function loadReconciliations(p = recPage.value) {
  recPage.value = p;
  const res = (await api.get('/reconciliations', { params: { page: p, pageSize: recPageSize } })) as any;
  reconciliations.value = Array.isArray(res) ? res : res.items || [];
  recTotal.value = Array.isArray(res) ? res.length : Number(res.total || 0);
}

async function loadLedgers(p = ledgerPage.value) {
  ledgerPage.value = p;
  const res = (await api.get('/stock/ledgers', { params: { page: p, pageSize: ledgerPageSize } })) as any;
  ledgers.value = Array.isArray(res) ? res : res.items || [];
  ledgerTotal.value = Array.isArray(res) ? res.length : Number(res.total || 0);
}

async function loadAll() {
  const [whs] = await Promise.all([
    api.get('/warehouses'),
    loadLedgers(1),
    loadReconciliations(1),
    loadBalances(1),
  ]);
  warehouses.value = whs as unknown as any[];
}

onMounted(loadAll);

function copyCode(token: string) {
  navigator.clipboard?.writeText(token);
  ElMessage.success(`已复制：${token}`);
}

async function loadDrillCodes(p = 1) {
  if (!drillTarget.value) return;
  drillPage.value = p;
  const { warehouseId, productId } = drillTarget.value;
  const res = (await api.get(`/stock/balances/${warehouseId}/${productId}/codes`, {
    params: { page: p, pageSize: drillPageSize },
  })) as any;
  drillCodes.value = Array.isArray(res) ? res : res.items || [];
  drillTotal.value = Array.isArray(res) ? res.length : Number(res.total || 0);
}

async function openCodeDrilldown(row: any) {
  drillTitle.value = `${row.warehouse.name} · ${row.product.name}`;
  drillTarget.value = { warehouseId: row.warehouseId, productId: row.productId };
  await loadDrillCodes(1);
  drillDialog.value = true;
}

async function generateCurrentMonth() {
  const periodMonth = new Date().toISOString().slice(0, 7);
  await api.post('/reconciliations/generate', { periodMonth });
  ElMessage.success(`已生成 ${periodMonth} 全渠道核验单`);
  activeTab.value = 'reconciliation';
  await loadAll();
}

function openSubmitRec(row: any) {
  activeRec.value = row;
  recDealerNote.value = '';
  recSubmitItems.value = row.items.map((i: any) => ({
    itemId: i.id,
    productName: i.productName,
    theoreticalQty: i.theoreticalQty,
    actualQty: i.actualQty ?? i.theoreticalQty,
    explanation: i.explanation || '',
  }));
  submitRecDialog.value = true;
}

async function doSubmitRec() {
  await api.post(`/reconciliations/${activeRec.value.id}/submit`, {
    dealerNote: recDealerNote.value,
    items: recSubmitItems.value,
  });
  ElMessage.success('实盘数据已提交');
  submitRecDialog.value = false;
  await loadAll();
}

function openAuditRec(row: any) {
  activeRec.value = row;
  auditAction.value = 'RECOUNT';
  auditNote.value = '';
  auditRecDialog.value = true;
}

async function doAuditRec() {
  await api.post(`/reconciliations/${activeRec.value.id}/audit`, {
    action: auditAction.value,
    note: auditNote.value,
  });
  ElMessage.success(auditAction.value === 'FREEZE_SUPPLY' ? '已暂停该服务商供货' : '处置已完成');
  auditRecDialog.value = false;
  await loadAll();
}

function recLabel(s: string) {
  const m: Record<string, string> = {
    PENDING_SUBMIT: '待填报',
    MATCHED: '账实一致',
    VARIANCE_FLAGGED: '存在差异',
    RESOLVED: '已结案',
  };
  return m[s] || s;
}

function recClass(s: string) {
  if (s === 'MATCHED' || s === 'RESOLVED') return 'ok';
  if (s === 'VARIANCE_FLAGGED') return 'bad';
  return 'wait';
}
</script>

<style scoped>
.plain-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}
.toolbar-row {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.filter-select {
  width: 210px;
}
.filter-input {
  width: 230px;
}
.toolbar-note {
  font-size: 11.5px;
  color: var(--ink-3);
  margin-left: auto;
}
@media (max-width: 720px) {
  .filter-select,
  .filter-input {
    width: 100%;
  }
  .toolbar-note {
    margin-left: 0;
    width: 100%;
  }
}
.cell-strong {
  font-size: 13px;
  font-weight: 600;
}
.cell-sub {
  font-size: 11px;
  color: var(--ink-3);
  margin-top: 1px;
}
.stock-qty {
  font-family: var(--font-num);
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
}
.stock-qty.low {
  color: var(--ochre);
}
.stock-unit {
  font-size: 11px;
  color: var(--ink-3);
  margin-left: 3px;
}
.frozen-tip {
  font-size: 10px;
  color: var(--seal);
  margin-top: 2px;
}
.variance {
  font-size: 13px;
  font-weight: 600;
}
.variance.bad {
  color: var(--seal);
}
.variance.ok {
  color: var(--jade);
}
.rec-pill {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 3px;
  border: 1px solid transparent;
  white-space: nowrap;
}
.rec-pill.ok {
  background: var(--jade-tint);
  border-color: #cfe0d3;
  color: var(--jade);
}
.rec-pill.bad {
  background: var(--seal-tint);
  border-color: var(--seal-line);
  color: var(--seal);
}
.rec-pill.wait {
  background: var(--ochre-tint);
  border-color: #e6d5ae;
  color: var(--ochre);
}
.plus {
  color: var(--jade);
  font-weight: 600;
}
.minus {
  color: var(--seal);
  font-weight: 600;
}
.dialog-note {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--ink-2);
  line-height: 1.6;
}
.audit-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  border: 1px solid var(--line);
  background: var(--surface-2);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 16px;
}
.audit-org {
  font-size: 13px;
  font-weight: 600;
}
.audit-diff {
  font-size: 12px;
  color: var(--ink-2);
}
.audit-diff .mono {
  font-size: 15px;
  color: var(--seal);
  font-weight: 600;
}
.audit-radios {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.level-tag {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--ink-2);
}
.level-tag.carton {
  border-color: #dcc9a3;
  background: var(--ochre-tint);
  color: var(--ochre);
}
.level-tag.unit {
  border-color: var(--brand-line);
  background: var(--brand-tint);
  color: var(--brand-ink);
}
</style>
