<template>
  <div class="phone-frame">
    <header class="verify-topbar">
      <div class="brand-block">
        <div class="brand-word">LUMINA</div>
        <div class="brand-caption">官方一物一码防伪溯源</div>
      </div>
      <router-link to="/m/workbench" class="b2b-switch">销售工作台</router-link>
    </header>

    <div class="verify-body">
      <!-- 手动查码 / 演示城市 -->
      <div class="m-card search-card">
        <div class="search-row">
          <input
            v-model="inputToken"
            class="m-input mono"
            placeholder="输入 16 位防伪码"
            @keyup.enter="runVerify()"
          />
          <button class="search-btn" type="button" @click="runVerify()">查验</button>
        </div>
        <div class="city-row">
          <span class="city-label">扫码所在地（演示跨区检测）</span>
          <select v-model="simCity" class="city-select" @change="runVerify()">
            <option value="南昌市">南昌市 · 授权区</option>
            <option value="宜春市">宜春市 · 授权区</option>
            <option value="杭州市">杭州市 · 跨区</option>
            <option value="北京市">北京市 · 跨区</option>
          </select>
        </div>
      </div>

      <div v-if="loading" class="m-card loading-card">
        <span class="spin" />
        正在进行签名与流向核验…
      </div>

      <template v-else-if="result">
        <!-- 结论 -->
        <div class="verdict" :class="verdictClass">
          <div class="verdict-main">
            <div class="verdict-line">{{ result.authentic ? '官方正品' : '查验未通过' }}</div>
            <h1 class="verdict-title">{{ result.headline }}</h1>
            <p class="verdict-sub">{{ result.subMessage || result.message }}</p>
          </div>
          <div class="verdict-seal" :class="result.authentic ? 'ok' : 'bad'">
            <span>{{ result.authentic ? '已验真' : '异常' }}</span>
          </div>
        </div>
        <div v-if="result.authentic" class="verdict-meta mono">
          防伪码 {{ result.codeToken }} · 这是第 {{ result.verifySeq }} 次查验
        </div>

        <template v-if="result.authentic">
          <!-- 产品档案 -->
          <section class="m-card profile-card">
            <div class="m-kicker">产品身份档案</div>
            <div class="prod-name">{{ result.product.name }}</div>
            <div class="kv-grid">
              <div class="kv-row"><span>品牌</span><strong>{{ result.product.brandName }}</strong></div>
              <div class="kv-row">
                <span>货号 / 规格</span>
                <strong class="mono">{{ result.product.skuCode }} · {{ result.product.spec }}</strong>
              </div>
              <div class="kv-row"><span>生产批号</span><strong class="mono">{{ result.batch.batchNo }}</strong></div>
              <div class="kv-row">
                <span>生产 / 有效期</span>
                <strong class="mono">{{ result.batch.mfgDate }} — {{ result.batch.expDate }}</strong>
              </div>
              <div class="kv-row price-row">
                <span>官方建议零售价</span>
                <strong class="price num">¥{{ result.product.retailPrice.toFixed(2) }}</strong>
              </div>
              <div class="kv-row">
                <span>合规零售下限</span>
                <strong class="mono">≥ ¥{{ result.product.minCompliantRetail.toFixed(2) }}（{{ result.product.retailRedlineFold }} 折红线）</strong>
              </div>
            </div>
          </section>

          <!-- 渠道背书 -->
          <section class="m-card endorse-card">
            <div class="m-kicker endorse-kicker">官方授权渠道</div>
            <div class="dealer-title">{{ result.channelEndorsement.dealerName }}</div>
            <div class="region-chips" v-if="result.channelEndorsement.authorizedRegions?.length">
              <span v-for="r in result.channelEndorsement.authorizedRegions" :key="r" class="region-chip">{{ r }}</span>
            </div>
            <div v-if="result.channelEndorsement.clinicName" class="clinic-row">
              授权终端机构
              <strong>{{ result.channelEndorsement.clinicName }}</strong>
              <span v-if="result.channelEndorsement.clinicCity" class="muted">（{{ result.channelEndorsement.clinicCity }}）</span>
            </div>
            <div class="first-scan mono">
              首次验证 {{ result.firstVerifyAt?.replace('T', ' ').slice(0, 16) }} · {{ result.firstVerifyCity }}
            </div>
          </section>

          <!-- 延伸服务 -->
          <section class="m-card extend-card">
            <div class="m-kicker">院线护肤服务</div>
            <div class="extend-title">{{ result.extensions.usageGuideTitle }}</div>
            <p class="extend-desc">{{ result.extensions.postCareHint }}</p>
          </section>

          <!-- 核价举报 -->
          <section class="m-card">
            <div class="report-head">
              <div>
                <div class="report-title">价格核验与举报</div>
                <div class="report-desc">发现低于 8.5 折零售或非授权渠道售卖，可匿名反馈总部</div>
              </div>
              <button class="report-toggle" type="button" @click="showReport = !showReport">
                {{ showReport ? '收起' : '去核价' }}
              </button>
            </div>

            <div v-if="showReport" class="report-body">
              <div class="m-field">
                <label class="m-label">实际购入单价（元）</label>
                <input v-model.number="reportForm.paidPrice" type="number" class="m-input" placeholder="如 520" />
              </div>
              <div class="m-field">
                <label class="m-label">购买门店 / 渠道</label>
                <input v-model="reportForm.storeName" class="m-input" placeholder="如：某美容会所 / 微商" />
              </div>
              <div class="m-field">
                <label class="m-label">补充说明</label>
                <input v-model="reportForm.remark" class="m-input" placeholder="选填" />
              </div>
              <button class="m-btn m-btn-primary" @click="submitPriceReport">提交品牌流向管控中心</button>
            </div>
            <div v-if="reportDoneMsg" class="report-done">{{ reportDoneMsg }}</div>
          </section>
        </template>
      </template>

      <div v-else class="m-card empty-card">
        <div class="empty-title">扫描包装上的防伪二维码</div>
        <p class="empty-desc">
          用微信扫一扫产品外盒的二维码即可验真，并看到供货服务商与授权机构。也可以在上方输入 16 位防伪码。
        </p>
      </div>

      <footer class="page-foot">
        <span class="mono">LUMINA · 一物一码</span>
        <span>本页由品牌方直连数据</span>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { mApi } from '../utils/api';

const route = useRoute();
const inputToken = ref((route.params.token as string) || '');
const simCity = ref('南昌市');
const loading = ref(false);
const result = ref<any>(null);

const showReport = ref(false);
const reportForm = ref({ paidPrice: 580, storeName: '', remark: '' });
const reportDoneMsg = ref('');

const verdictClass = computed(() => {
  if (!result.value) return '';
  if (!result.value.authentic || result.value.riskLevel === 'HIGH_FREQ_WARNING') return 'danger';
  if (result.value.riskLevel === 'REPEAT_OK') return 'warn';
  return 'authentic';
});

async function runVerify() {
  const token = inputToken.value.trim();
  if (!token) return;
  loading.value = true;
  reportDoneMsg.value = '';
  try {
    result.value = await mApi.get(`/public/verify/${encodeURIComponent(token)}`, {
      params: { city: simCity.value },
    });
  } finally {
    loading.value = false;
  }
}

async function submitPriceReport() {
  if (!result.value?.codeToken || !reportForm.value.paidPrice) return;
  const res = (await mApi.post('/public/verify/price-report', {
    codeToken: result.value.codeToken,
    paidPrice: reportForm.value.paidPrice,
    storeName: reportForm.value.storeName,
    city: simCity.value,
    remark: reportForm.value.remark,
  })) as any;
  reportDoneMsg.value = res.message;
  showReport.value = false;
}

onMounted(() => {
  if (inputToken.value) runVerify();
});
</script>

<style scoped>
.verify-topbar {
  background: #101c1a;
  color: #fff;
  padding: 16px 18px 15px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand-word {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: #eef4f1;
}
.brand-caption {
  font-size: 10.5px;
  color: #7f9a94;
  margin-top: 3px;
  letter-spacing: 0.02em;
}
.b2b-switch {
  font-size: 11.5px;
  color: #cfe3dc;
  text-decoration: none;
  border: 1px solid rgba(207, 227, 220, 0.24);
  padding: 5px 10px;
  border-radius: 4px;
}
.verify-body {
  padding: 14px 14px 30px;
  flex: 1;
}

/* 查码 */
.search-card {
  padding: 14px;
}
.search-row {
  display: flex;
  gap: 8px;
}
.search-btn {
  flex-shrink: 0;
  border: 1px solid var(--m-primary);
  background: var(--m-primary);
  color: #fff;
  border-radius: 7px;
  padding: 0 18px;
  font-size: 13.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}
.city-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  gap: 10px;
}
.city-label {
  font-size: 10.5px;
  color: var(--m-muted);
}
.city-select {
  border: 1px solid var(--m-line);
  border-radius: 5px;
  padding: 4px 6px;
  font-size: 11.5px;
  font-family: inherit;
  background: var(--m-surface-2);
  color: var(--m-sub);
}

.loading-card {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  color: var(--m-sub);
  padding: 28px 16px;
  justify-content: center;
}
.spin {
  width: 14px;
  height: 14px;
  border: 2px solid var(--m-primary-line);
  border-top-color: var(--m-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 结论 */
.verdict {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  border-radius: var(--m-radius);
  padding: 18px 16px;
  border: 1px solid var(--m-line);
  background: #fff;
  border-left-width: 3px;
  margin-top: 12px;
}
.verdict.authentic {
  border-left-color: var(--m-primary);
  background: linear-gradient(180deg, #f2f8f5 0%, #ffffff 70%);
}
.verdict.warn {
  border-left-color: var(--m-gold);
  background: linear-gradient(180deg, #fdf7ea 0%, #ffffff 70%);
}
.verdict.danger {
  border-left-color: var(--m-seal);
  background: linear-gradient(180deg, #fdf1ee 0%, #ffffff 70%);
}
.verdict-main {
  flex: 1;
  min-width: 0;
}
.verdict-line {
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--m-muted);
}
.verdict.authentic .verdict-line {
  color: var(--m-primary);
}
.verdict.danger .verdict-line {
  color: var(--m-seal);
}
.verdict-title {
  margin: 6px 0 5px;
  font-size: 19px;
  line-height: 1.35;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.verdict-sub {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--m-sub);
}
.verdict-seal {
  flex-shrink: 0;
  border: 1.5px solid currentColor;
  border-radius: 3px;
  padding: 2px;
  transform: rotate(-6deg);
  align-self: center;
}
.verdict-seal span {
  display: block;
  border: 1px solid currentColor;
  border-radius: 2px;
  padding: 4px 5px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
}
.verdict-seal.ok {
  color: var(--m-primary);
}
.verdict-seal.bad {
  color: var(--m-seal);
}
.verdict-meta {
  font-size: 10.5px;
  color: var(--m-muted);
  margin: 8px 2px 0;
  word-break: break-all;
}

/* 档案 */
.profile-card {
  margin-top: 12px;
}
.prod-name {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 2px 0 12px;
}
.kv-grid {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.kv-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
}
.kv-row span {
  color: var(--m-muted);
  flex-shrink: 0;
}
.kv-row strong {
  text-align: right;
  font-weight: 500;
  color: var(--m-ink);
  line-height: 1.5;
  min-width: 0;
  word-break: break-word;
}
.price-row {
  align-items: baseline;
  border-top: 1px solid var(--m-line);
  padding-top: 9px;
  margin-top: 2px;
}
.price {
  font-size: 20px;
  color: var(--m-ink);
  font-weight: 600;
}

/* 背书 */
.endorse-card {
  margin-top: 12px;
  background: #fbfaf6;
  border-color: #e6dfcd;
}
.endorse-kicker {
  color: var(--m-gold);
}
.dealer-title {
  font-size: 15px;
  font-weight: 650;
  color: var(--m-ink);
  margin-bottom: 8px;
}
.region-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 9px;
}
.region-chip {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 3px;
  border: 1px solid #dcc9a3;
  background: #fdf8ee;
  color: var(--m-gold);
}
.clinic-row {
  font-size: 12.5px;
  color: var(--m-sub);
  margin-bottom: 6px;
}
.clinic-row strong {
  color: var(--m-ink);
}
.muted {
  color: var(--m-muted);
}
.first-scan {
  font-size: 10.5px;
  color: var(--m-muted);
}

/* 延伸 */
.extend-card {
  margin-top: 12px;
  background: var(--m-primary-soft);
  border-color: var(--m-primary-line);
}
.extend-title {
  font-size: 14px;
  font-weight: 650;
  margin-bottom: 4px;
}
.extend-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.65;
  color: var(--m-primary-dark);
}

/* 核价 */
.report-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.report-title {
  font-size: 13.5px;
  font-weight: 600;
}
.report-desc {
  font-size: 11px;
  color: var(--m-muted);
  line-height: 1.55;
  margin-top: 3px;
}
.report-toggle {
  border: 1px solid var(--m-line-strong);
  background: #fff;
  border-radius: 5px;
  padding: 6px 11px;
  font-size: 12px;
  color: var(--m-sub);
  font-family: inherit;
  cursor: pointer;
  flex-shrink: 0;
}
.report-body {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--m-line);
}
.report-done {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--m-success);
  font-weight: 600;
}

/* 空态 */
.empty-card {
  margin-top: 12px;
  text-align: center;
  padding: 30px 20px;
}
.empty-title {
  font-size: 14.5px;
  font-weight: 650;
}
.empty-desc {
  font-size: 12px;
  color: var(--m-muted);
  line-height: 1.7;
  margin: 8px 0 0;
}
.page-foot {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--m-muted);
  padding: 18px 4px 0;
}
</style>
