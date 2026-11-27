<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">商品与规则</h1>
        <p class="page-subtitle">商品档案、打印模板、渠道规则与短信通道</p>
      </div>
      <div class="page-actions" v-if="auth.isHQ">
        <el-button @click="importDialog = true">CSV 批量导入</el-button>
        <el-button type="primary" @click="productDialog = true">新增商品</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="plain-tabs">
      <el-tab-pane label="商品主数据" name="products">
        <div class="surface-card flush">
          <el-table :data="products" size="small" empty-text="还没有商品">
            <el-table-column prop="skuCode" label="货号" width="110">
              <template #default="{ row }"><span class="mono cell-doc">{{ row.skuCode }}</span></template>
            </el-table-column>
            <el-table-column label="商品" min-width="190">
              <template #default="{ row }">
                <div class="cell-strong">{{ row.name }}</div>
                <div class="cell-sub">{{ row.spec }}</div>
              </template>
            </el-table-column>
            <el-table-column label="品牌" width="130">
              <template #default="{ row }">{{ row.brand?.name }}</template>
            </el-table-column>
            <el-table-column label="箱规" width="110">
              <template #default="{ row }">
                <span class="mono">{{ row.cartonQty }}</span>
                <span class="cell-sub">{{ row.unitName }}/箱</span>
              </template>
            </el-table-column>
            <el-table-column label="零售指导价" width="115" align="right">
              <template #default="{ row }"><span class="mono">¥{{ Number(row.retailPrice).toFixed(2) }}</span></template>
            </el-table-column>
            <el-table-column label="标准供货价" width="115" align="right">
              <template #default="{ row }"><span class="mono">¥{{ Number(row.defaultSupplyPrice).toFixed(2) }}</span></template>
            </el-table-column>
            <el-table-column label="供货红线" width="100" align="right">
              <template #default="{ row }">
                <span class="redline-value">{{ (Number(row.minSupplyDiscount) * 10).toFixed(1) }} 折</span>
              </template>
            </el-table-column>
            <el-table-column label="一物一码" width="95">
              <template #default="{ row }">
                <span class="trace-flag" :class="row.isTraceable ? 'on' : 'off'">
                  {{ row.isTraceable ? '启用' : '未启用' }}
                </span>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="prodTotal"
              :page-size="prodPageSize"
              :current-page="prodPage"
              @current-change="(p: number) => loadProducts(p)"
            />
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="针式联单模板" name="print">
        <div class="tpl-grid">
          <article v-for="tpl in printTemplates" :key="tpl.id" class="tpl-card">
            <div class="tpl-head">
              <div>
                <div class="tpl-name">{{ tpl.name }}</div>
                <div class="tpl-meta">
                  <span class="paper-chip">{{ tpl.paperType }}</span>
                  <span v-if="tpl.isDefault" class="default-chip">默认</span>
                </div>
              </div>
              <el-button size="small" type="primary" plain @click="savePrintTemplate(tpl)">保存</el-button>
            </div>

            <div class="tpl-section">
              <div class="tpl-label">明细列</div>
              <el-checkbox-group v-model="tpl.visibleColumns" class="check-grid">
                <el-checkbox v-for="col in columnDefs" :key="col.key" :value="col.key">{{ col.label }}</el-checkbox>
              </el-checkbox-group>
            </div>

            <div class="tpl-section">
              <div class="tpl-label">单据变量</div>
              <el-checkbox-group v-model="tpl.systemVars" class="check-grid">
                <el-checkbox v-for="v in systemVarDefs" :key="v.key" :value="v.key">{{ v.label }}</el-checkbox>
              </el-checkbox-group>
            </div>
          </article>
        </div>
        <p class="hint-line">
          仓库老式针式打印机不需要改造：打单时选择浏览器打印即可走系统打印驱动；装了本地打印桥则支持静默直打，避免走纸偏移。
        </p>
      </el-tab-pane>

      <el-tab-pane label="渠道规则" name="rules">
        <form class="rule-form" v-if="rules" @submit.prevent="saveRules">
          <section class="rule-section">
            <div class="rule-section-head">
              <h3>机构归属</h3>
              <p>合同附件里的 90 / 270 条款，系统按这里的天数自动执行。</p>
            </div>
            <div class="rule-row">
              <label>首次报备保护期</label>
              <div class="rule-control">
                <el-input-number v-model="rules.clinicProtectDays" :min="7" :max="365" controls-position="right" />
                <span class="rule-unit">天</span>
              </div>
              <p class="rule-note">保护期内其他服务商报备同一机构会被服务端时间戳驳回。</p>
            </div>
            <div class="rule-row">
              <label>无复购自动解绑</label>
              <div class="rule-control">
                <el-input-number v-model="rules.clinicUnbindDays" :min="30" :max="730" controls-position="right" />
                <span class="rule-unit">天</span>
              </div>
              <p class="rule-note">超过此天数没有新订单，机构自动回公海，其他人可报备。</p>
            </div>
            <div class="rule-row">
              <label>解绑前预警</label>
              <div class="rule-control">
                <el-input-number v-model="rules.unbindWarnDaysBefore" :min="3" :max="90" controls-position="right" />
                <span class="rule-unit">天</span>
              </div>
              <p class="rule-note">提前多少天在总控台提醒。</p>
            </div>
          </section>

          <section class="rule-section">
            <div class="rule-section-head">
              <h3>价格红线</h3>
              <p>按指导价折算，赠品与抹零一并计入整单综合折率，绕不过去。</p>
            </div>
            <div class="rule-row">
              <label>最低供货折率</label>
              <div class="rule-control">
                <el-input-number v-model="rules.defaultMinSupplyRatio" :min="0.1" :max="1" :step="0.05" :precision="2" controls-position="right" />
                <span class="rule-unit">{{ (rules.defaultMinSupplyRatio * 10).toFixed(1) }} 折</span>
              </div>
              <p class="rule-note">低于该折率的单据直接拦截，需总部特批才能出库。</p>
            </div>
            <div class="rule-row">
              <label>终端零售红线</label>
              <div class="rule-control">
                <el-input-number v-model="rules.defaultMinRetailRatio" :min="0.5" :max="1" :step="0.05" :precision="2" controls-position="right" />
                <span class="rule-unit">{{ (rules.defaultMinRetailRatio * 10).toFixed(1) }} 折</span>
              </div>
              <p class="rule-note">顾客验真页会展示合规零售区间，低于此价会被标记。</p>
            </div>
            <div class="rule-row inline">
              <label>允许破线特批</label>
              <el-switch v-model="rules.allowSpecialPriceApprove" />
              <p class="rule-note">关闭后，破线单据只能作废，不能提特批。</p>
            </div>
          </section>

          <section class="rule-section">
            <div class="rule-section-head">
              <h3>风控与验真</h3>
              <p>防备伪查询被刷，也决定二维码里印什么地址。</p>
            </div>
            <div class="rule-row">
              <label>高频查验阈值</label>
              <div class="rule-control">
                <el-input-number v-model="rules.highFreqVerifyThreshold" :min="2" :max="50" controls-position="right" />
                <span class="rule-unit">次</span>
              </div>
              <p class="rule-note">同一个码超过这个次数，系统生成预警。</p>
            </div>
            <div class="rule-row column">
              <label>验真页根地址</label>
              <el-input v-model="rules.verifyBaseUrl" placeholder="如 https://v.lumina.cn/v" />
              <p class="rule-note">生码二维码指向这里。用独立域名时填写你的域名。</p>
            </div>
          </section>

          <section v-if="auth.isHQ && smsCfg" class="rule-section">
            <div class="rule-section-head">
              <h3>
                聚美智数 · 短信验证码通道
                <span class="sms-state-pill" :class="smsCfg.mode === 'LIVE' ? 'live' : 'mock'">
                  {{ smsCfg.mode === 'LIVE' ? '已接入真实发信' : '演示模式（未填凭据）' }}
                </span>
              </h3>
              <p>对接官方 POST https://api.jumdata.com/sms/send（SHA-256 签名）。填入 appId 与 appSecret 保存后立即切换真实短信下发。</p>
            </div>
            <div class="rule-row column">
              <label>聚美智数 AppId</label>
              <el-input v-model="smsForm.appId" placeholder="请输入聚美智数控制台分配的 appId" />
            </div>
            <div class="rule-row column">
              <label>聚美智数 AppSecret（密钥）</label>
              <el-input
                v-model="smsForm.appSecret"
                type="password"
                show-password
                :placeholder="smsCfg.hasAppSecret ? `已配置（${smsCfg.appSecretMasked}），留空则保持不变` : '请输入聚美智数 appSecret'"
              />
            </div>
            <div class="rule-row column">
              <label>短信模板 ID（templateId）</label>
              <el-input v-model="smsForm.templateId" placeholder="默认官方测试模板 JM1000372" />
              <p class="rule-note">正式商用请在聚美智数后台报备自定义签名与模板 ID；调试期可使用官方测试模板 JM1000372。</p>
            </div>
            <div class="sms-cfg-actions">
              <el-button type="primary" plain :loading="savingSms" @click="saveSmsConfig">保存短信配置</el-button>
              <el-input v-model="testSmsPhone" maxlength="11" placeholder="输入手机号测试发信" style="width: 180px" />
              <el-button :loading="testingSms" @click="sendTestSms">发送测试短信</el-button>
            </div>
          </section>

          <div class="rule-actions" v-if="auth.isHQ">
            <el-button type="primary" native-type="submit">保存规则</el-button>
            <span class="hint-line">保存后立即对新单据生效，历史单据不变。</span>
          </div>
        </form>
      </el-tab-pane>
    </el-tabs>

    <!-- 新增商品 -->
    <el-dialog v-model="productDialog" title="新增商品" width="min(540px, 94vw)" align-center>
      <el-form :model="productForm" :label-width="isMobile ? 'auto' : '100px'" :label-position="isMobile ? 'top' : 'right'">
        <el-form-item label="货号" required><el-input v-model="productForm.skuCode" placeholder="如 LM-020" /></el-form-item>
        <el-form-item label="名称" required><el-input v-model="productForm.name" /></el-form-item>
        <el-form-item label="品牌" required>
          <el-select v-model="productForm.brandId" style="width: 100%">
            <el-option v-for="b in brands" :key="b.id" :label="b.name" :value="b.id" />
          </el-select>
        </el-form-item>
        <div class="form-2">
          <el-form-item label="规格"><el-input v-model="productForm.spec" placeholder="如 50ml" /></el-form-item>
          <el-form-item label="每箱盒数">
            <el-input-number v-model="productForm.cartonQty" :min="1" style="width: 100%" controls-position="right" />
          </el-form-item>
        </div>
        <div class="form-2">
          <el-form-item label="零售指导价" required>
            <el-input-number v-model="productForm.retailPrice" :min="1" style="width: 100%" controls-position="right" />
          </el-form-item>
          <el-form-item label="标准供货价" required>
            <el-input-number v-model="productForm.defaultSupplyPrice" :min="1" style="width: 100%" controls-position="right" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="productDialog = false">取消</el-button>
        <el-button type="primary" @click="createProduct">保存</el-button>
      </template>
    </el-dialog>

    <!-- 导入 -->
    <el-dialog v-model="importDialog" title="CSV 批量导入商品" width="min(620px, 94vw)" align-center>
      <p class="dialog-note">
        每行一条：<code class="mono">货号,商品名称,品牌,规格,官方零售价,箱规</code>，可直接从生意通导出的表格粘贴。
      </p>
      <el-input
        v-model="importText"
        type="textarea"
        :rows="8"
        placeholder="YLT001,伊丽妥防晒霜30g,Lumina,30g,268,24&#10;BKR001,碧珂润小分子玻尿酸,SILKY PLAN,5ml*10,598,12"
      />
      <template #footer>
        <el-button @click="importDialog = false">取消</el-button>
        <el-button type="primary" @click="runImport">导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';
import { useViewport } from '../utils/format';

const auth = useAuthStore();
const { width } = useViewport();
const isMobile = computed(() => width.value <= 720);
const activeTab = ref('products');
const products = ref<any[]>([]);
const brands = ref<any[]>([]);
const printTemplates = ref<any[]>([]);
const columnDefs = ref<any[]>([]);
const systemVarDefs = ref<any[]>([]);
const rules = ref<any>(null);
const smsCfg = ref<any>(null);
const smsForm = ref({ appId: '', appSecret: '', templateId: 'JM1000372' });
const savingSms = ref(false);
const testingSms = ref(false);
const testSmsPhone = ref('');

const productDialog = ref(false);
const productForm = ref({
  skuCode: '',
  name: '',
  brandId: '',
  spec: '',
  unitName: '盒',
  cartonQty: 12,
  retailPrice: 598,
  defaultSupplyPrice: 239,
});

const importDialog = ref(false);
const importText = ref('');

const prodPage = ref(1);
const prodPageSize = 20;
const prodTotal = ref(0);

async function loadProducts(page = prodPage.value) {
  prodPage.value = page;
  const res = (await api.get('/products', { params: { page, pageSize: prodPageSize } })) as any;
  products.value = Array.isArray(res) ? res : res.items || [];
  prodTotal.value = Array.isArray(res) ? res.length : Number(res.total || 0);
}

async function loadAll() {
  const [, b, pt, r] = await Promise.all([
    loadProducts(prodPage.value),
    api.get('/brands'),
    api.get('/print/templates'),
    api.get('/rules'),
  ]);
  brands.value = b as unknown as any[];
  const ptData = pt as any;
  printTemplates.value = ptData.templates;
  columnDefs.value = ptData.columnDefs;
  systemVarDefs.value = ptData.systemVarDefs;
  rules.value = {
    ...(r as any),
    defaultMinSupplyRatio: Number((r as any).defaultMinSupplyRatio),
    defaultMinRetailRatio: Number((r as any).defaultMinRetailRatio),
  };
  if (brands.value.length && !productForm.value.brandId) {
    productForm.value.brandId = brands.value[0].id;
  }
  if (auth.isHQ) {
    try {
      const sc = (await api.get('/auth/sms/config')) as any;
      smsCfg.value = sc;
      smsForm.value = {
        appId: sc.appId || '',
        appSecret: '',
        templateId: sc.templateId || 'JM1000372',
      };
    } catch {
      // ignore
    }
  }
}

onMounted(loadAll);

async function createProduct() {
  await api.post('/products', productForm.value);
  ElMessage.success('商品已添加');
  productDialog.value = false;
  productForm.value.skuCode = '';
  productForm.value.name = '';
  await loadAll();
}

async function runImport() {
  const lines = importText.value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const rows = lines.map((line) => {
    const [skuCode, name, brandName, spec, retailPrice, cartonQty] = line.split(/[,，\t]/).map((x) => x?.trim());
    return {
      skuCode,
      name,
      brandName,
      spec,
      retailPrice: Number(retailPrice || 398),
      cartonQty: Number(cartonQty || 12),
    };
  });
  const res = (await api.post('/products/import', { rows })) as any;
  ElMessage.success(`导入完成：新增 ${res.created} 条，更新 ${res.updated} 条`);
  importDialog.value = false;
  importText.value = '';
  await loadAll();
}

async function savePrintTemplate(tpl: any) {
  await api.put(`/print/templates/${tpl.id}`, {
    name: tpl.name,
    visibleColumns: tpl.visibleColumns,
    systemVars: tpl.systemVars,
  });
  ElMessage.success(`模板「${tpl.name}」已保存`);
}

async function saveRules() {
  await api.put('/rules', {
    clinicProtectDays: rules.value.clinicProtectDays,
    clinicUnbindDays: rules.value.clinicUnbindDays,
    unbindWarnDaysBefore: rules.value.unbindWarnDaysBefore,
    defaultMinSupplyRatio: rules.value.defaultMinSupplyRatio,
    defaultMinRetailRatio: rules.value.defaultMinRetailRatio,
    highFreqVerifyThreshold: rules.value.highFreqVerifyThreshold,
    allowSpecialPriceApprove: rules.value.allowSpecialPriceApprove,
    verifyBaseUrl: rules.value.verifyBaseUrl,
  });
  ElMessage.success('规则已保存生效');
}

async function saveSmsConfig() {
  savingSms.value = true;
  try {
    const sc = (await api.put('/auth/sms/config', smsForm.value)) as any;
    smsCfg.value = sc;
    smsForm.value.appSecret = '';
    ElMessage.success(sc.mode === 'LIVE' ? '聚美智数短信配置已保存并切换为真实发信模式' : '短信配置已保存');
  } finally {
    savingSms.value = false;
  }
}

async function sendTestSms() {
  if (!/^1[3-9]\d{9}$/.test(testSmsPhone.value.trim())) {
    return ElMessage.warning('请输入有效的 11 位测试手机号');
  }
  testingSms.value = true;
  try {
    const res = (await api.post('/auth/sms/test', { phone: testSmsPhone.value.trim() })) as any;
    ElMessage.success(res.message || '测试短信已发送');
  } finally {
    testingSms.value = false;
  }
}
</script>

<style scoped>
.plain-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}
.sms-state-pill {
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 99px;
  vertical-align: middle;
}
.sms-state-pill.live {
  background: var(--jade-tint);
  color: var(--jade);
  border: 1px solid #cfe0d3;
}
.sms-state-pill.mock {
  background: var(--ochre-tint);
  color: var(--ochre);
  border: 1px solid #e6d5ae;
}
.sms-cfg-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.sms-cfg-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.cell-doc {
  color: var(--brand-ink);
  font-size: 12.5px;
  font-weight: 600;
}
.cell-strong {
  font-size: 13px;
  font-weight: 600;
}
.cell-sub {
  font-size: 11px;
  color: var(--ink-3);
}
.redline-value {
  font-family: var(--font-num);
  font-size: 13px;
  color: var(--seal);
}
.trace-flag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid transparent;
}
.trace-flag.on {
  background: var(--jade-tint);
  border-color: #cfe0d3;
  color: var(--jade);
}
.trace-flag.off {
  background: var(--surface-3);
  border-color: var(--line);
  color: var(--ink-3);
}

/* 模板 */
.tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
  gap: 14px;
}
.tpl-card {
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
  padding: 16px 18px;
}
.tpl-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.tpl-name {
  font-size: 13.5px;
  font-weight: 600;
}
.tpl-meta {
  display: flex;
  gap: 6px;
  margin-top: 5px;
}
.paper-chip,
.default-chip {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--line);
  color: var(--ink-2);
  background: var(--surface-2);
}
.default-chip {
  border-color: var(--brand-line);
  color: var(--brand-ink);
  background: var(--brand-tint);
}
.tpl-section {
  margin-top: 12px;
}
.tpl-label {
  font-size: 11px;
  color: var(--ink-3);
  margin-bottom: 6px;
}
.check-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 10px;
}
.check-grid :deep(.el-checkbox) {
  margin-right: 0;
  height: 26px;
}
.hint-line {
  font-size: 11.5px;
  color: var(--ink-3);
  line-height: 1.7;
  margin-top: 14px;
}

/* 规则 */
.rule-form {
  max-width: 720px;
}
.rule-section {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 18px 22px 8px;
  margin-bottom: 14px;
}
.rule-section-head {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 4px;
}
.rule-section-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.rule-section-head p {
  margin: 5px 0 0;
  font-size: 11.5px;
  color: var(--ink-3);
  line-height: 1.6;
}
.rule-row {
  display: grid;
  grid-template-columns: 190px 220px 1fr;
  gap: 14px;
  align-items: start;
  padding: 13px 0;
  border-bottom: 1px solid var(--line);
}
.rule-row:last-child {
  border-bottom: 0;
}
.rule-row > label {
  font-size: 12.5px;
  color: var(--ink);
  padding-top: 7px;
}
.rule-control {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rule-control :deep(.el-input-number) {
  width: 130px;
}
.rule-unit {
  font-size: 12px;
  color: var(--ink-2);
  font-family: var(--font-num);
}
.rule-note {
  margin: 0;
  font-size: 11.5px;
  color: var(--ink-3);
  line-height: 1.65;
  padding-top: 7px;
}
.rule-row.inline {
  grid-template-columns: 190px 60px 1fr;
  align-items: center;
}
.rule-row.inline .rule-note {
  padding-top: 0;
}
.rule-row.column {
  grid-template-columns: 190px 1fr;
}
.rule-row.column .rule-note {
  grid-column: 2;
  padding-top: 6px;
}
.rule-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 6px 2px 10px;
}
.rule-actions .hint-line {
  margin: 0;
}

.form-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.dialog-note {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--ink-2);
  line-height: 1.7;
}
.dialog-note code {
  background: var(--surface-3);
  padding: 1px 5px;
  border-radius: 3px;
}

@media (max-width: 860px) {
  .rule-section {
    padding: 14px 14px 6px;
  }
  .rule-row,
  .rule-row.inline,
  .rule-row.column {
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .rule-row > label {
    padding-top: 0;
  }
  .rule-row.column .rule-note {
    grid-column: auto;
  }
  .rule-note {
    padding-top: 0;
  }
  .rule-actions {
    flex-wrap: wrap;
  }
  .form-2 {
    grid-template-columns: 1fr;
  }
}
</style>
