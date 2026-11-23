<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-left">
        <div class="login-logo">LUMINA</div>
        <h1>品牌供销溯源与渠道规则执行系统</h1>
        <p class="login-desc">
          将 90 天机构报备保护、270 天自动解绑、3.5 折供货红线、一物一码箱盒关联与老式针式联单套打融为一体。
        </p>
        <ul class="feature-list">
          <li><strong>一物一码防窜货</strong>：HMAC-SHA256 防伪加密 + 箱码整箱出入库 + 拆零自动联动</li>
          <li><strong>合同规则自动化</strong>：服务端时间戳抢单防扯皮 + 含赠品综合折率红线拦截</li>
          <li><strong>PC + 小程序双端打通</strong>：外勤手机下单即时推仓库，老式针式机精准静默打单</li>
        </ul>
      </div>

      <div class="login-right">
        <h2>登录工作台</h2>
        <el-form :model="form" label-position="top" @submit.prevent="submit">
          <el-form-item label="账号">
            <el-input v-model="form.username" placeholder="请输入账号" size="large" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input
              v-model="form.password"
              type="password"
              show-password
              placeholder="默认演示密码 123456"
              size="large"
              @keyup.enter="submit"
            />
          </el-form-item>
          <el-button
            type="primary"
            size="large"
            :loading="loading"
            style="width: 100%; margin-top: 6px"
            @click="submit"
          >
            立即进入系统
          </el-button>
        </el-form>

        <div class="demo-accounts">
          <div class="demo-title">一键体验多主体隔离视角（密码均为 123456）</div>
          <div class="demo-grid">
            <button
              v-for="acc in demoAccounts"
              :key="acc.username"
              type="button"
              class="demo-btn"
              @click="quickLogin(acc.username)"
            >
              <span class="demo-name">{{ acc.realName }}</span>
              <span class="demo-org">{{ acc.orgName }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();

const form = ref({ username: 'admin', password: '123456' });
const loading = ref(false);
const demoAccounts = ref<Array<{ username: string; realName: string; orgName: string }>>([]);

onMounted(async () => {
  try {
    demoAccounts.value = (await api.get('/auth/demo-accounts')) as unknown as typeof demoAccounts.value;
  } catch {
    // ignore
  }
});

async function submit() {
  loading.value = true;
  try {
    await auth.login(form.value.username, form.value.password);
    ElMessage.success('登录成功');
    router.push('/');
  } finally {
    loading.value = false;
  }
}

async function quickLogin(username: string) {
  form.value.username = username;
  form.value.password = '123456';
  await submit();
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  background: linear-gradient(145deg, #eaf2f0 0%, #f7f9f8 55%, #efe9de 100%);
  display: grid;
  place-items: center;
  padding: 24px;
}
.login-card {
  width: 920px;
  max-width: 100%;
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  box-shadow: 0 20px 50px rgba(16, 35, 33, 0.1);
  border: 1px solid var(--border-subtle);
}
.login-left {
  background: linear-gradient(160deg, #0d2422 0%, #10423d 100%);
  color: #edf5f4;
  padding: 44px 38px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.login-logo {
  display: inline-block;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.24em;
  color: #e4c58c;
  margin-bottom: 14px;
}
.login-left h1 {
  margin: 0 0 14px;
  font-size: 25px;
  line-height: 1.35;
  font-weight: 700;
  color: #fff;
}
.login-desc {
  margin: 0 0 26px;
  font-size: 13.5px;
  line-height: 1.7;
  color: #b7d2ce;
}
.feature-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 12.5px;
  line-height: 1.6;
  color: #d6e7e4;
}
.feature-list li {
  padding-left: 14px;
  border-left: 2px solid #2ea69b;
}
.login-right {
  padding: 40px 38px;
}
.login-right h2 {
  margin: 0 0 20px;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}
.demo-accounts {
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid var(--border-subtle);
}
.demo-title {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 10px;
}
.demo-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.demo-btn {
  text-align: left;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bg-canvas);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.demo-btn:hover {
  border-color: var(--brand-primary);
  background: var(--brand-primary-soft);
}
.demo-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
}
.demo-org {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
