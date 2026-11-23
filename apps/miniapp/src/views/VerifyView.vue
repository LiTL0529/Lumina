<template>
  <div class="phone-frame">
    <header class="verify-topbar">
      <div>
        <div class="brand-word">LUMINA</div>
        <div class="brand-caption">官方一物一码防伪溯源认证</div>
      </div>
      <router-link to="/m/workbench" class="b2b-switch">销售工作台</router-link>
    </header>

    <div class="verify-body">
      <!-- Optional Manual Code / Demo City Bar -->
      <div class="m-card" style="margin-bottom: 14px; padding: 12px 14px">
        <div style="display: flex; gap: 8px; margin-bottom: 8px">
          <input
            v-model="inputToken"
            class="m-input mono"
            placeholder="输入或粘贴 16 位防伪码查验"
            @keyup.enter="runVerify()"
          />
          <button class="m-btn m-btn-primary" style="width: 84px; flex-shrink: 0" @click="runVerify()">
            查验
          </button>
        </div>
        <div class="city-sim-row">
          <span>定位城市（演示跨区窜货检测）：</span>
          <select v-model="simCity" class="city-select" @change="runVerify()">
            <option value="南昌市">南昌市（授权区内）</option>
            <option value="宜春市">宜春市（授权区内）</option>
            <option value="杭州市">杭州市（跨区触发预警）</option>
            <option value="北京市">北京市（跨区触发预警）</option>
          </select>
        </div>
      </div>

      <div v-if="loading" class="m-card" style="text-align: center; padding: 40px 16px; color: var(--m-muted)">
        正在进行 HMAC 数字签名与链上流向核验...
      </div>

      <template v-else-if="result">
        <!-- Verdict Hero Banner -->
        <div class="verdict-hero" :class="verdictClass">
          <div class="verdict-badge">{{ result.authentic ? '✓ OFFICIAL AUTHENTIC' : '✕ VERIFICATION FAILED' }}</div>
          <h1 class="verdict-title">{{ result.headline }}</h1>
          <p class="verdict-sub">{{ result.subMessage || result.message }}</p>
          <div v-if="result.authentic" class="verdict-meta mono">
            防伪码：{{ result.codeToken }} · 第 {{ result.verifySeq }} 次查验
          </div>
        </div>

        <template v-if="result.authentic">
          <!-- Product Specification Card -->
          <div class="m-card" style="margin-top: 14px">
            <div class="card-kicker">产品身份档案</div>
            <div class="prod-name">{{ result.product.name }}</div>
            <div class="kv-grid">
              <div class="kv-row"><span>品牌</span><strong>{{ result.product.brandName }}</strong></div>
              <div class="kv-row"><span>货号 / 规格</span><strong class="mono">{{ result.product.skuCode }} · {{ result.product.spec }}</strong></div>
              <div class="kv-row"><span>生产批号</span><strong class="mono">{{ result.batch.batchNo }}</strong></div>
              <div class="kv-row"><span>生产 / 有效期</span><strong class="mono">{{ result.batch.mfgDate }} 至 {{ result.batch.expDate }}</strong></div>
              <div class="kv-row">
                <span>官方建议零售价</span>
                <strong class="mono" style="color: var(--m-gold); font-size: 16px">¥{{ result.product.retailPrice.toFixed(2) }}</strong>
              </div>
              <div class="kv-row">
                <span>合规零售区间</span>
                <strong class="mono">≥ ¥{{ result.product.minCompliantRetail.toFixed(2) }}（{{ result.product.retailRedlineFold }}折红线）</strong>
              </div>
            </div>
          </div>

          <!-- Dealer Endorsement Card -->
          <div class="m-card endorsement-card" style="margin-top: 12px">
            <div class="card-kicker" style="color: var(--m-gold)">官方授权渠道背书</div>
            <div class="dealer-title">{{ result.channelEndorsement.dealerName }}</div>
            <div class="region-chips" v-if="result.channelEndorsement.authorizedRegions?.length">
              <span v-for="r in result.channelEndorsement.authorizedRegions" :key="r" class="r-chip">{{ r }}</span>
            </div>
            <div v-if="result.channelEndorsement.clinicName" class="clinic-row">
              授权终端机构：<strong>{{ result.channelEndorsement.clinicName }}</strong>
              <span v-if="result.channelEndorsement.clinicCity">（{{ result.channelEndorsement.clinicCity }}）</span>
            </div>
            <div class="first-scan-row mono">
              首次验证：{{ result.firstVerifyAt?.replace('T', ' ').slice(0, 16) }}（{{ result.firstVerifyCity }}）
            </div>
          </div>

          <!-- Future Requirement 2 Extension Card (NFC Anime & Post-Care) -->
          <div class="m-card" style="margin-top: 12px; background: var(--m-primary-soft); border-color: #bfe0dc">
            <div class="card-kicker" style="color: var(--m-primary)">院线护肤延伸服务（需求二预留入口）</div>
            <div style="font-size: 14px; font-weight: 700; margin-bottom: 4px">{{ result.extensions.usageGuideTitle }}</div>
            <div style="font-size: 12.5px; color: var(--m-sub); line-height: 1.55">
              {{ result.extensions.postCareHint }}
            </div>
          </div>

          <!-- 8.5折 Retail Price Redline Feedback -->
          <div class="m-card" style="margin-top: 12px">
            <div style="display: flex; justify-content: space-between; align-items: center">
              <div>
                <div style="font-size: 13.5px; font-weight: 600">8.5 折零售价格核验与举报</div>
                <div style="font-size: 11.5px; color: var(--m-muted)">如发现异常低价乱价或非授权渠道，可匿名反馈给总部</div>
              </div>
              <button class="m-btn m-btn-outline" style="width: auto; padding: 7px 12px; font-size: 12.5px" @click="showReport = !showReport">
                {{ showReport ? '收起' : '去核价' }}
              </button>
            </div>

            <div v-if="showReport" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--m-border)">
              <div class="m-field">
                <label class="m-label">实际购入单价（元）</label>
                <input v-model.number="reportForm.paidPrice" type="number" class="m-input" placeholder="如 520" />
              </div>
              <div class="m-field">
                <label class="m-label">购买门店 / 渠道名称</label>
                <input v-model="reportForm.storeName" class="m-input" placeholder="如：某美容会所或线上微商" />
              </div>
              <div class="m-field">
                <label class="m-label">补充说明</label>
                <input v-model="reportForm.remark" class="m-input" placeholder="选填" />
              </div>
              <button class="m-btn m-btn-primary" @click="submitPriceReport">提交品牌流向管控中心</button>
            </div>
            <div v-if="reportDoneMsg" style="margin-top: 10px; font-size: 12.5px; color: var(--m-success); font-weight: 600">
              {{ reportDoneMsg }}
            </div>
          </div>
        </template>
      </template>

      <div v-else class="m-card" style="text-align: center; padding: 34px 18px">
        <div style="font-size: 15px; font-weight: 700; margin-bottom: 6px">请扫描产品包装上的 Lumina 防伪二维码</div>
        <div style="font-size: 12.5px; color: var(--m-muted); line-height: 1.6">
          您也可以在上方输入框粘贴 16 位防伪码，或从 PC 后台「一物一码溯源 → 查看码与二维码」直接点开体验。
        </div>
      </div>
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
  background: #102321;
  color: #fff;
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand-word {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.18em;
  color: #e8cd97;
}
.brand-caption {
  font-size: 11px;
  color: #9cb9b4;
  margin-top: 2px;
}
.b2b-switch {
  font-size: 12px;
  color: #e8cd97;
  text-decoration: none;
  border: 1px solid rgba(232, 205, 151, 0.4);
  padding: 5px 10px;
  border-radius: 99px;
}
.verify-body {
  padding: 14px 14px 32px;
  flex: 1;
}
.city-sim-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--m-muted);
}
.city-select {
  border: 1px solid var(--m-border);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  background: #fff;
}
.verdict-hero {
  border-radius: 16px;
  padding: 22px 18px;
  color: #fff;
}
.verdict-hero.authentic {
  background: linear-gradient(145deg, #0c5851 0%, #148379 100%);
}
.verdict-hero.warn {
  background: linear-gradient(145deg, #92400e 0%, #c27803 100%);
}
.verdict-hero.danger {
  background: linear-gradient(145deg, #991b1b 0%, #dc2626 100%);
}
.verdict-badge {
  font-size: 11px;
  letter-spacing: 0.14em;
  font-weight: 700;
  opacity: 0.88;
}
.verdict-title {
  margin: 8px 0 6px;
  font-size: 20px;
  line-height: 1.3;
  font-weight: 700;
}
.verdict-sub {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
  opacity: 0.94;
}
.verdict-meta {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  font-size: 11.5px;
}
.card-kicker {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--m-muted);
  margin-bottom: 6px;
}
.prod-name {
  font-size: 17px;
  font-weight: 700;
  margin-bottom: 12px;
}
.kv-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.kv-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  gap: 10px;
}
.kv-row span {
  color: var(--m-muted);
}
.endorsement-card {
  background: linear-gradient(180deg, #fffdf9 0%, #ffffff 100%);
  border-color: #e6d8be;
}
.dealer-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--m-text);
  margin-bottom: 8px;
}
.region-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.r-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 99px;
  background: var(--m-gold-soft);
  color: #8c6018;
  font-weight: 600;
}
.clinic-row {
  font-size: 13px;
  margin-bottom: 6px;
}
.first-scan-row {
  font-size: 11.5px;
  color: var(--m-muted);
}
</style>
