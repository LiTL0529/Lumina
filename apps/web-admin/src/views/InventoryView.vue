<template>
  <div>
    <div class="page-header">
      <div>
        <h1 class="page-title">实时库存、流水账与月度流向核验</h1>
        <p class="page-subtitle">每一盒在库库存均可穿透到具体防伪单品码，杜绝负库存；按月核验服务商账实差异并支持一键停供处置</p>
      </div>
      <el-button v-if="auth.isHQ" type="primary" @click="generateCurrentMonth">
        生成本月全渠道流向核验单
      </el-button>
    </div>

    <el-tabs v-model="activeTab" class="surface-card">
      <el-tab-pane label="实时库存查询（支持码穿透）" name="balances">
        <div style="display: flex; gap: 10px; margin-bottom: 14px">
          <el-select v-model="filterWarehouse" clearable placeholder="全部仓库" style="width: 220px" @change="loadBalances">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
          <el-input v-model="keyword" placeholder="搜索商品名称 / 货号" clearable style="width: 240px" @keyup.enter="loadBalances" />
          <el-button @click="loadBalances">查询</el-button>
        </div>

        <el-table :data="balances" size="small">
          <el-table-column label="所属仓库" width="170">
            <template #default="{ row }">
              <strong>{{ row.warehouse.name }}</strong>
              <div style="font-size: 11px; color: var(--text-muted)">{{ row.warehouse.org.name }}</div>
            </template>
          </el-table-column>
          <el-table-column label="商品名称">
            <template #default="{ row }">
              <strong>{{ row.product.name }}</strong>
              <span class="mono" style="margin-left: 6px; color: var(--text-muted)">{{ row.product.skuCode }}</span>
            </template>
          </el-table-column>
          <el-table-column label="品牌 / 规格" width="160">
            <template #default="{ row }">{{ row.product.brand?.name }} · {{ row.product.spec }}</template>
          </el-table-column>
          <el-table-column label="当前在库数" width="120" align="right">
            <template #default="{ row }">
              <el-tag :type="row.qty <= row.warnMinQty ? 'warning' : 'success'" class="mono">
                {{ row.qty }} {{ row.product.unitName }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="openCodeDrilldown(row)">查看在库防伪码</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="月度流向库存核验（三步闭环）" name="reconciliation">
        <el-table :data="reconciliations" size="small">
          <el-table-column prop="periodMonth" label="核验月份" width="105">
            <template #default="{ row }"><span class="mono">{{ row.periodMonth }}</span></template>
          </el-table-column>
          <el-table-column label="服务商">
            <template #default="{ row }">
              <strong>{{ row.org.name }}</strong>
              <el-tag v-if="row.org.supplyFrozen" size="small" type="danger" style="margin-left: 6px">已停供</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="totalTheoretical" label="系统理论库存" width="115" align="right" />
          <el-table-column prop="totalActual" label="服务商实盘数" width="115" align="right" />
          <el-table-column label="账实差异" width="100" align="right">
            <template #default="{ row }">
              <span class="mono" :style="{ color: row.totalVariance !== 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }">
                {{ row.totalVariance > 0 ? '+' : '' }}{{ row.totalVariance }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="核验状态" width="115">
            <template #default="{ row }">
              <el-tag size="small" :type="recTag(row.status)">{{ recLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="dealerNote" label="差异说明" show-overflow-tooltip />
          <el-table-column label="操作" width="190" fixed="right">
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
                总部核查处置
              </el-button>
              <span v-else-if="row.hqAuditAction" style="font-size: 12px; color: var(--text-muted)">
                {{ row.hqAuditAction }}
              </span>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="不可篡改库存流水账" name="ledgers">
        <el-table :data="ledgers" size="small">
          <el-table-column label="时间" width="160">
            <template #default="{ row }"><span class="mono">{{ row.createdAt?.replace('T', ' ').slice(0, 19) }}</span></template>
          </el-table-column>
          <el-table-column label="仓库" width="150">
            <template #default="{ row }">{{ row.warehouse?.name }}</template>
          </el-table-column>
          <el-table-column label="商品">
            <template #default="{ row }">{{ row.product?.name }} ({{ row.product?.skuCode }})</template>
          </el-table-column>
          <el-table-column prop="docType" label="业务类型" width="140" />
          <el-table-column prop="docNo" label="关联单号" width="145">
            <template #default="{ row }"><span class="mono">{{ row.docNo }}</span></template>
          </el-table-column>
          <el-table-column label="变动" width="90" align="right">
            <template #default="{ row }">
              <strong class="mono" :style="{ color: row.deltaQty > 0 ? 'var(--success)' : 'var(--danger)' }">
                {{ row.deltaQty > 0 ? '+' : '' }}{{ row.deltaQty }}
              </strong>
            </template>
          </el-table-column>
          <el-table-column label="结存" width="80" align="right">
            <template #default="{ row }"><span class="mono">{{ row.afterQty }}</span></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- In-Stock Codes Drilldown -->
    <el-dialog v-model="drillDialog" :title="`在库防伪码穿透：${drillTitle}`" width="680px">
      <el-table :data="drillCodes" size="small" max-height="420">
        <el-table-column label="级别" width="85">
          <template #default="{ row }">
            <el-tag size="small" :type="row.codeLevel === 'CARTON' ? 'warning' : 'success'">
              {{ row.codeLevel === 'CARTON' ? '外箱' : '单盒' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="codeToken" label="防伪码 Token" width="190">
          <template #default="{ row }"><span class="code-chip">{{ row.codeToken }}</span></template>
        </el-table-column>
        <el-table-column label="所属箱码" width="170">
          <template #default="{ row }"><span class="mono">{{ row.parent?.codeToken || '-' }}</span></template>
        </el-table-column>
        <el-table-column label="批次号">
          <template #default="{ row }"><span class="mono">{{ row.batch?.batchNo }}</span></template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- Dealer Submit Physical Count -->
    <el-dialog v-model="submitRecDialog" title="服务商月度实盘库存提报" width="640px">
      <el-table :data="recSubmitItems" size="small" border>
        <el-table-column prop="productName" label="商品" />
        <el-table-column prop="theoreticalQty" label="系统理论库存" width="110" align="right" />
        <el-table-column label="实盘数量" width="130">
          <template #default="{ row }">
            <el-input-number v-model="row.actualQty" :min="0" size="small" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column label="差异说明">
          <template #default="{ row }">
            <el-input v-model="row.explanation" size="small" placeholder="若不符请填原因" />
          </template>
        </el-table-column>
      </el-table>
      <el-input v-model="recDealerNote" style="margin-top: 12px" placeholder="整体核验备注" />
      <template #footer>
        <el-button @click="submitRecDialog = false">取消</el-button>
        <el-button type="primary" @click="doSubmitRec">提交总部核验</el-button>
      </template>
    </el-dialog>

    <!-- HQ Audit & Freeze Modal -->
    <el-dialog v-model="auditRecDialog" title="品牌流向管控负责人 · 异常核验处置" width="520px">
      <el-form label-width="100px">
        <el-form-item label="服务商">
          <strong>{{ activeRec?.org?.name }}</strong>（差异 {{ activeRec?.totalVariance }} 盒）
        </el-form-item>
        <el-form-item label="处置措施">
          <el-radio-group v-model="auditAction">
            <el-radio value="PASS">解释合理 · 通过结案</el-radio>
            <el-radio value="RECOUNT">退回要求重新盘点</el-radio>
            <el-radio value="PRICE_ADJUST">标记调整供货价格阶梯</el-radio>
            <el-radio value="FREEZE_SUPPLY" style="color: var(--danger)">无法解释 · 立即暂停供货（冻结下单）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="审核意见">
          <el-input v-model="auditNote" type="textarea" :rows="3" placeholder="记录流向管控审核意见，永久留痕" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="auditRecDialog = false">取消</el-button>
        <el-button type="primary" @click="doAuditRec">确认执行处置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
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

async function loadBalances() {
  balances.value = (await api.get('/stock/balances', {
    params: {
      warehouseId: filterWarehouse.value || undefined,
      keyword: keyword.value || undefined,
    },
  })) as unknown as any[];
}

async function loadAll() {
  const [whs, lds, recs] = await Promise.all([
    api.get('/warehouses'),
    api.get('/stock/ledgers'),
    api.get('/reconciliations'),
  ]);
  warehouses.value = whs as unknown as any[];
  ledgers.value = lds as unknown as any[];
  reconciliations.value = recs as unknown as any[];
  await loadBalances();
}

onMounted(loadAll);

async function openCodeDrilldown(row: any) {
  drillTitle.value = `${row.warehouse.name} · ${row.product.name}`;
  drillCodes.value = (await api.get(`/stock/balances/${row.warehouseId}/${row.productId}/codes`)) as unknown as any[];
  drillDialog.value = true;
}

async function generateCurrentMonth() {
  const periodMonth = new Date().toISOString().slice(0, 7);
  await api.post('/reconciliations/generate', { periodMonth });
  ElMessage.success(`已生成 ${periodMonth} 全渠道服务商月度核验单`);
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
  ElMessage.success('月度实盘数据已提交');
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
  ElMessage.success(auditAction.value === 'FREEZE_SUPPLY' ? '已执行停供冻结该服务商！' : '审核处置已完成');
  auditRecDialog.value = false;
  await loadAll();
}

function recLabel(s: string) {
  const m: Record<string, string> = {
    PENDING_SUBMIT: '待服务商填报',
    MATCHED: '账实一致',
    VARIANCE_FLAGGED: '存在账实差异',
    RESOLVED: '已核查结案',
  };
  return m[s] || s;
}
function recTag(s: string): any {
  if (s === 'MATCHED' || s === 'RESOLVED') return 'success';
  if (s === 'VARIANCE_FLAGGED') return 'danger';
  return 'warning';
}
</script>
