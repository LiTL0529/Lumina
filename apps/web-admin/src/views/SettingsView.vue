<template>
  <div>
    <div class="page-header">
      <div>
        <h1 class="page-title">商品主数据、打印模板与合同规则设置</h1>
        <p class="page-subtitle">支持从「生意通」导出 CSV 一键迁移商品、配置针式联单打印字段及灵活调整合同红线参数</p>
      </div>
      <div style="display: flex; gap: 10px" v-if="auth.isHQ">
        <el-button @click="importDialog = true">生意通 CSV 批量导入</el-button>
        <el-button type="primary" @click="productDialog = true">+ 新增商品</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="surface-card">
      <el-tab-pane label="商品主数据（指导价与箱规）" name="products">
        <el-table :data="products" size="small">
          <el-table-column prop="skuCode" label="货号" width="110">
            <template #default="{ row }"><span class="mono">{{ row.skuCode }}</span></template>
          </el-table-column>
          <el-table-column prop="name" label="商品名称" min-width="180" />
          <el-table-column label="品牌" width="120">
            <template #default="{ row }">{{ row.brand?.name }}</template>
          </el-table-column>
          <el-table-column prop="spec" label="规格" width="95" />
          <el-table-column label="箱规" width="90" align="center">
            <template #default="{ row }">{{ row.cartonQty }}{{ row.unitName }}/箱</template>
          </el-table-column>
          <el-table-column label="官方零售价" width="105" align="right">
            <template #default="{ row }"><span class="mono">¥{{ Number(row.retailPrice).toFixed(2) }}</span></template>
          </el-table-column>
          <el-table-column label="标准供货价" width="105" align="right">
            <template #default="{ row }"><span class="mono">¥{{ Number(row.defaultSupplyPrice).toFixed(2) }}</span></template>
          </el-table-column>
          <el-table-column label="供货红线" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" type="danger">{{ (Number(row.minSupplyDiscount) * 10).toFixed(1) }} 折</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="一物一码" width="85" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.isTraceable ? 'success' : 'info'">{{ row.isTraceable ? '启用' : '否' }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="针式套打模板与字段勾选" name="print">
        <div v-for="tpl in printTemplates" :key="tpl.id" class="tpl-card">
          <div class="tpl-header">
            <div>
              <strong>{{ tpl.name }}</strong>
              <el-tag size="small" style="margin-left: 8px">{{ tpl.paperType }}</el-tag>
              <el-tag v-if="tpl.isDefault" size="small" type="success" style="margin-left: 6px">默认模板</el-tag>
            </div>
            <el-button size="small" type="primary" @click="savePrintTemplate(tpl)">保存勾选配置</el-button>
          </div>
          <div class="tpl-section">
            <div class="tpl-label">商品明细表格列：</div>
            <el-checkbox-group v-model="tpl.visibleColumns">
              <el-checkbox v-for="col in columnDefs" :key="col.key" :value="col.key">{{ col.label }}</el-checkbox>
            </el-checkbox-group>
          </div>
          <div class="tpl-section">
            <div class="tpl-label">单据系统变量：</div>
            <el-checkbox-group v-model="tpl.systemVars">
              <el-checkbox v-for="v in systemVarDefs" :key="v.key" :value="v.key">{{ v.label }}</el-checkbox>
            </el-checkbox-group>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="渠道合同规则参数" name="rules">
        <el-form v-if="rules" :model="rules" label-width="190px" style="max-width: 620px; padding-top: 8px">
          <el-form-item label="机构首次报备保护期（天）">
            <el-input-number v-model="rules.clinicProtectDays" :min="7" :max="365" />
          </el-form-item>
          <el-form-item label="无复购自动解绑周期（天）">
            <el-input-number v-model="rules.clinicUnbindDays" :min="30" :max="730" />
          </el-form-item>
          <el-form-item label="解绑前自动预警提前天数">
            <el-input-number v-model="rules.unbindWarnDaysBefore" :min="3" :max="90" />
          </el-form-item>
          <el-form-item label="默认供货价最低红线比例">
            <el-input-number v-model="rules.defaultMinSupplyRatio" :min="0.1" :max="1" :step="0.05" :precision="2" />
            <span style="margin-left: 10px; font-size: 12px; color: var(--text-muted)">0.35 即 3.5 折红线</span>
          </el-form-item>
          <el-form-item label="终端零售价合规红线比例">
            <el-input-number v-model="rules.defaultMinRetailRatio" :min="0.5" :max="1" :step="0.05" :precision="2" />
            <span style="margin-left: 10px; font-size: 12px; color: var(--text-muted)">0.85 即 8.5 折零售红线</span>
          </el-form-item>
          <el-form-item label="防伪码高频查验告警阈值">
            <el-input-number v-model="rules.highFreqVerifyThreshold" :min="2" :max="50" />
          </el-form-item>
          <el-form-item label="允许破红线提交总部特批">
            <el-switch v-model="rules.allowSpecialPriceApprove" />
          </el-form-item>
          <el-form-item label="防伪查询独立域名根地址">
            <el-input v-model="rules.verifyBaseUrl" placeholder="如 https://v.lumina.cn/v" />
          </el-form-item>
          <el-form-item v-if="auth.isHQ">
            <el-button type="primary" @click="saveRules">保存规则配置</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <!-- Create Product Modal -->
    <el-dialog v-model="productDialog" title="新增商品主数据" width="540px">
      <el-form :model="productForm" label-width="100px">
        <el-form-item label="商品货号" required><el-input v-model="productForm.skuCode" placeholder="如 LM-020" /></el-form-item>
        <el-form-item label="商品名称" required><el-input v-model="productForm.name" /></el-form-item>
        <el-form-item label="所属品牌" required>
          <el-select v-model="productForm.brandId" style="width: 100%">
            <el-option v-for="b in brands" :key="b.id" :label="b.name" :value="b.id" />
          </el-select>
        </el-form-item>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
          <el-form-item label="规格"><el-input v-model="productForm.spec" placeholder="如 50ml" /></el-form-item>
          <el-form-item label="每箱盒数"><el-input-number v-model="productForm.cartonQty" :min="1" style="width: 100%" /></el-form-item>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
          <el-form-item label="官方指导价" required><el-input-number v-model="productForm.retailPrice" :min="1" style="width: 100%" /></el-form-item>
          <el-form-item label="标准供货价" required><el-input-number v-model="productForm.defaultSupplyPrice" :min="1" style="width: 100%" /></el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="productDialog = false">取消</el-button>
        <el-button type="primary" @click="createProduct">保存商品</el-button>
      </template>
    </el-dialog>

    <!-- Import CSV Modal -->
    <el-dialog v-model="importDialog" title="生意通商品表格一键导入" width="600px">
      <p style="font-size: 12.5px; color: var(--text-secondary); margin-top: 0">
        每行一条，格式：<code>货号,商品名称,品牌,规格,官方零售价,箱规</code>（可直接从生意通导出表粘贴）
      </p>
      <el-input
        v-model="importText"
        type="textarea"
        :rows="7"
        placeholder="YLT001,伊丽妥防晒霜30g,Lumina,30g,268,24&#10;BKR001,碧珂润小分子玻尿酸,SILKY PLAN,5ml*10,598,12"
      />
      <template #footer>
        <el-button @click="importDialog = false">取消</el-button>
        <el-button type="primary" @click="runImport">立即导入</el-button>
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
const activeTab = ref('products');
const products = ref<any[]>([]);
const brands = ref<any[]>([]);
const printTemplates = ref<any[]>([]);
const columnDefs = ref<any[]>([]);
const systemVarDefs = ref<any[]>([]);
const rules = ref<any>(null);

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

async function loadAll() {
  const [p, b, pt, r] = await Promise.all([
    api.get('/products'),
    api.get('/brands'),
    api.get('/print/templates'),
    api.get('/rules'),
  ]);
  products.value = p as unknown as any[];
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
}

onMounted(loadAll);

async function createProduct() {
  await api.post('/products', productForm.value);
  ElMessage.success('商品添加成功');
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
  ElMessage.success(`模板【${tpl.name}】字段配置已保存并更新套打坐标`);
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
  ElMessage.success('合同规则参数已保存生效');
}
</script>

<style scoped>
.tpl-card {
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 14px;
  background: var(--bg-canvas);
}
.tpl-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.tpl-section {
  margin-top: 8px;
}
.tpl-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
  font-weight: 600;
}
</style>
