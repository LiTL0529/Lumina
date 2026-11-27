<template>
  <!-- 浏览器打开 /m/workbench 时（非安卓 App 且非预览）仅展示极简 App 下载引导 -->
  <div v-if="!isAppRuntime" class="phone-frame canvas-white">
    <div class="app-gate">
      <div class="gate-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 8V6a2 2 0 0 1 2-2h2" /><path d="M16 4h2a2 2 0 0 1 2 2v2" />
          <path d="M20 16v2a2 2 0 0 1-2 2h-2" /><path d="M8 20H6a2 2 0 0 1-2-2v-2" />
          <path d="M9 9h6v6H9z" />
        </svg>
      </div>
      <div class="gate-brand">LUMINA</div>
      <h1 class="gate-title">请使用 Lumina 安卓 App</h1>
      <p class="gate-desc">
        移动扫码出入库、外勤拜访评分与订单作业仅在安卓扫码 App 内提供，支持原生高清连扫，手机端直接提交并与 PC 实时同步。
      </p>
      <a :href="apkDownloadUrl" download="lumina-scanner.apk" class="m-btn m-btn-primary gate-btn">
        下载 lumina-scanner.apk
      </a>
      <router-link to="/v" class="gate-verify-link">防伪查验请前往官方验真页 →</router-link>
    </div>
  </div>

  <!-- 安卓扫码 App 主体（真固定顶栏 + 独立滚动区 + 真固定底栏） -->
  <div v-else class="phone-frame" :class="{ 'canvas-white': !user && !scanOpen }">
    <!-- 固定顶栏 -->
    <header class="wb-header">
      <div class="wb-brand">
        <div class="wb-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 8V6a2 2 0 0 1 2-2h2" /><path d="M16 4h2a2 2 0 0 1 2 2v2" />
            <path d="M20 16v2a2 2 0 0 1-2 2h-2" /><path d="M8 20H6a2 2 0 0 1-2-2v-2" />
            <path d="M9 9h6v6H9z" />
          </svg>
        </div>
        <div class="wb-brand-copy">
          <div class="wb-word">LUMINA</div>
          <div class="wb-caption">{{ user ? user.orgName : '供销溯源与渠道执行' }}</div>
        </div>
      </div>
      <div class="wb-head-right">
        <button v-if="scanOpen" class="hdr-btn" type="button" @click="scanOpen = false">返回</button>
        <template v-else-if="user">
          <span class="hdr-user">{{ shortUserName }}</span>
          <button class="hdr-text-btn" type="button" @click="logout">退出</button>
        </template>
        <router-link v-else to="/v" class="hdr-text-btn">验真</router-link>
      </div>
    </header>

    <!-- 1. 全屏原生摄像头真扫码面板 -->
    <div v-if="scanOpen" class="wb-scroll">
      <MobileScanSheet
        :key="scanSheetKey"
        :user="user"
        :warehouses="warehouses"
        :products="products"
        :dealers="dealers"
        :orders="orders"
        :initial-mode="scanInitialMode"
        :initial-order-id="scanInitialOrderId"
        :auto-start="scanAutoStart"
        :focus-manual="!scanAutoStart"
        @close="scanOpen = false"
        @committed="loadData"
      />
    </div>

    <!-- 2. 极简登录页（纯白画布，一屏完整呈现，与桌面端一致） -->
    <div v-else-if="!user" class="wb-scroll login-scroll">

      <div class="login-wrap">
        <h1 class="login-heading">{{ authMode === 'register' ? '注册账号' : '登录工作台' }}</h1>
        <p class="login-sub">
          {{ authMode === 'register' ? '手机号验证后加入所属服务商' : '与 PC 端数据实时同步' }}
        </p>

        <div v-if="toastMsg" class="toast-bar" :class="toastType">{{ toastMsg }}</div>

        <div class="auth-tabs" role="tablist">
          <button type="button" :class="{ on: authMode === 'sms' }" @click="switchAuthMode('sms')">短信登录</button>
          <button type="button" :class="{ on: authMode === 'password' }" @click="switchAuthMode('password')">密码登录</button>
          <button type="button" :class="{ on: authMode === 'register' }" @click="switchAuthMode('register')">手机注册</button>
        </div>

        <template v-if="authMode === 'sms'">
          <div class="m-field">
            <label class="m-label">手机号</label>
            <input v-model="smsLoginForm.phone" maxlength="11" inputmode="tel" class="m-input" placeholder="请输入 11 位手机号" />
          </div>
          <div class="m-field">
            <label class="m-label">短信验证码</label>
            <div class="m-sms-row">
              <input v-model="smsLoginForm.code" maxlength="6" inputmode="numeric" class="m-input mono" placeholder="6 位验证码" />
              <button
                type="button"
                class="m-sms-btn"
                :disabled="smsSending || smsCooldown > 0"
                @click="sendMobileSms(smsLoginForm.phone, 'LOGIN')"
              >
                {{ smsCooldown > 0 ? `${smsCooldown}s` : smsSending ? '发送中' : '获取验证码' }}
              </button>
            </div>
          </div>
          <button type="button" class="m-btn m-btn-primary" @click="doSmsLogin">短信验证登录</button>
          <p class="m-sms-tip">未注册手机号验证通过后将自动注册并登录</p>
        </template>

        <template v-else-if="authMode === 'password'">
          <div class="m-field">
            <label class="m-label">账号 / 手机号</label>
            <input v-model="loginForm.username" class="m-input" placeholder="请输入账号或已注册手机号" />
          </div>
          <div class="m-field">
            <label class="m-label">密码</label>
            <input v-model="loginForm.password" type="password" class="m-input" placeholder="请输入登录密码" />
          </div>
          <button type="button" class="m-btn m-btn-primary" @click="doLogin">进入系统</button>
        </template>

        <template v-else>
          <div class="m-field">
            <label class="m-label">手机号</label>
            <input v-model="regForm.phone" maxlength="11" inputmode="tel" class="m-input" placeholder="11 位手机号" />
          </div>
          <div class="m-field">
            <label class="m-label">短信验证码</label>
            <div class="m-sms-row">
              <input v-model="regForm.code" maxlength="6" inputmode="numeric" class="m-input mono" placeholder="6 位验证码" />
              <button
                type="button"
                class="m-sms-btn"
                :disabled="smsSending || smsCooldown > 0"
                @click="sendMobileSms(regForm.phone, 'REGISTER')"
              >
                {{ smsCooldown > 0 ? `${smsCooldown}s` : smsSending ? '发送中' : '获取验证码' }}
              </button>
            </div>
          </div>
          <div class="two-col">
            <div class="m-field">
              <label class="m-label">真实姓名</label>
              <input v-model="regForm.realName" class="m-input" placeholder="姓名" />
            </div>
            <div class="m-field">
              <label class="m-label">登录密码</label>
              <input v-model="regForm.password" type="password" class="m-input" placeholder="至少 6 位" />
            </div>
          </div>
          <div class="m-field">
            <label class="m-label">所属服务商</label>
            <MobileSelect
              v-model="regForm.orgId"
              title="选择所属服务商"
              placeholder="请选择所属服务商"
              :options="publicDealerOptions"
            />
          </div>
          <div class="m-field">
            <label class="m-label">岗位角色</label>
            <MobileSelect
              v-model="regForm.roleCode"
              title="选择岗位角色"
              placeholder="请选择岗位角色"
              :options="registerRoleOptions"
            />
          </div>
          <button type="button" class="m-btn m-btn-primary" @click="doSmsRegister">校验短信并注册</button>
        </template>
      </div>
    </div>

    <!-- 3. 已登录主体（仅中间区滚动，底栏永远固定可见） -->
    <template v-else>
      <div class="wb-scroll">
        <div v-if="toastMsg" class="toast-bar" :class="toastType">{{ toastMsg }}</div>

        <!-- 首页：轻量化作业 Hub（新老客独立入口 + 一屏可见） -->
        <template v-if="tab === 'home'">
          <section class="hub-metrics">
            <button type="button" class="hm-cell" @click="tab = 'orders'">
              <span class="hm-label">待出库</span>
              <span class="hm-val num" :class="{ warn: pendingOrderCount > 0 }">{{ pendingOrderCount }}</span>
            </button>
            <button type="button" class="hm-cell" @click="tab = 'stock'">
              <span class="hm-label">当前在库</span>
              <span class="hm-val num">{{ totalStockQty }}</span>
            </button>
            <button type="button" class="hm-cell" @click="openCustomerMode('existing')">
              <span class="hm-label">新客 / 老客</span>
              <span class="hm-val num">
                {{ crmDash ? crmDash.kpis.completedCount : 0 }}<span class="hm-sep">/</span>{{ existingDash ? existingDash.kpis.totalExistingCount : 0 }}
              </span>
            </button>
          </section>

          <section class="hub-section">
            <div class="hub-sec-head">
              <span class="hub-sec-title">常用作业</span>
            </div>
            <div class="action-grid">
              <button type="button" class="act-tile" @click="openSheet('order')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
                <span class="act-name">新建供货单</span>
                <span class="act-sub">{{ isHQ ? '发服务商 / 推送出库' : '代客下单 / 推送出库' }}</span>
              </button>
              <button type="button" class="act-tile" @click="openCustomerMode('new')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect width="8" height="4" x="8" y="2" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="m9 14 2 2 4-4" />
                </svg>
                <span class="act-name">新客开发</span>
                <span class="act-sub">五维评分 · 20分纳新</span>
              </button>
              <button type="button" class="act-tile" @click="openCustomerMode('existing')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
                </svg>
                <span class="act-name">老客维护</span>
                <span class="act-sub">精简回访 · 复购健康</span>
              </button>
              <button type="button" class="act-tile" @click="openCustomerMode('customers')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span class="act-name">客户档案</span>
                <span class="act-sub">360° 查改 · 标为老客</span>
              </button>
              <button type="button" class="act-tile" @click="openSheet('report')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" /><path d="M12 8v8" /><path d="M8 12h8" />
                </svg>
                <span class="act-name">机构报备</span>
                <span class="act-sub">锁定 90 天保护期</span>
              </button>
              <router-link to="/v" class="act-tile">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                </svg>
                <span class="act-name">正品验真</span>
                <span class="act-sub">查单盒防伪档案</span>
              </router-link>
            </div>
          </section>

          <section class="hub-section">
            <div class="hub-sec-head">
              <span class="hub-sec-title">最近单据</span>
              <button type="button" class="hub-more" @click="tab = 'orders'">全部 →</button>
            </div>
            <div class="group-list">
              <div v-if="!recentOrders.length" class="m-empty">暂无订单记录</div>
              <button
                v-for="o in recentOrders"
                :key="o.id"
                type="button"
                class="gl-row"
                @click="jumpToOrder(o)"
              >
                <div class="gl-main">
                  <div class="gl-title">{{ o.clinic?.name || o.buyerOrg?.name || '—' }}</div>
                  <div class="gl-sub mono">{{ o.docNo }} · {{ orderQty(o) }} 盒</div>
                </div>
                <div class="gl-right">
                  <div class="gl-amt num">¥{{ Number(o.totalAmount).toFixed(2) }}</div>
                  <span class="order-status" :class="statusClass(o.status)">{{ statusLabel(o.status) }}</span>
                </div>
              </button>
            </div>
          </section>
        </template>

        <!-- 客户 Tab：新客开发 / 老客维护 / 360° 客户档案三视图彻底隔离 -->
        <template v-else-if="tab === 'visit'">
          <div class="crm-seg" role="tablist">
            <button type="button" :class="{ on: visitSub === 'new' }" @click="visitSub = 'new'">
              新客开发
            </button>
            <button type="button" :class="{ on: visitSub === 'existing' }" @click="visitSub = 'existing'">
              老客维护
            </button>
            <button type="button" :class="{ on: visitSub === 'customers' }" @click="visitSub = 'customers'">
              客户档案
            </button>
          </div>

          <!-- 子视图 1：新客开发（仅未成交潜客，已转老客自动隐藏防冗杂） -->
          <template v-if="visitSub === 'new'">
            <section class="visit-summary">
              <div>
                <div class="vs-label">本月新客拜访 / 目标</div>
                <div class="vs-val num">
                  {{ crmDash ? `${crmDash.kpis.completedCount} / ${crmDash.kpis.targetQuota}` : '0 / 100' }}
                  <span>家</span>
                </div>
              </div>
              <div class="vs-score">
                <div class="vs-label">纳新得分</div>
                <div class="vs-val num">{{ crmDash ? crmDash.kpis.performanceScore.toFixed(2) : '0.00' }}<span>/ 20分</span></div>
              </div>
            </section>

            <div class="visit-actions">
              <button type="button" class="m-btn m-btn-primary" @click="openSheet('visitScore')">+ 新客五维评分</button>
              <button type="button" class="m-btn m-btn-outline" @click="openSheet('visitLog')">+ 新客拜访跟进</button>
            </div>

            <section class="hub-section">
              <div class="hub-sec-head">
                <span class="hub-sec-title">开发中的新客（{{ crmTargetsTotal }}）</span>
                <span class="hub-sec-meta">点客户查改档案</span>
              </div>
              <div class="group-list">
                <div v-if="!crmTargets.length" class="m-empty">暂无开发中的新客，点击上方按钮录入</div>
                <button
                  v-for="t in crmTargets"
                  :key="t.id"
                  type="button"
                  class="gl-row"
                  @click="openTargetCustomer(t)"
                >
                  <div class="gl-main">
                    <div class="gl-title">{{ t.clinicName }}</div>
                    <div class="gl-sub">{{ t.cityRegion }} · {{ t.salesRepName }}</div>
                  </div>
                  <div class="gl-right">
                    <div class="gl-amt num">{{ t.totalScore }} 分</div>
                    <span class="m-chip" :class="t.storeGrade === '优秀门店' ? 'ok' : ''">{{ t.storeGrade || t.validationText }}</span>
                  </div>
                </button>
              </div>
              <div v-if="crmTargetsTotal > 0" class="m-pager-bar">
                <span class="m-pager-info">已显示 {{ crmTargets.length }} / {{ crmTargetsTotal }} 家</span>
                <button
                  v-if="crmTargets.length < crmTargetsTotal"
                  type="button"
                  class="m-load-more"
                  :disabled="loadingMore.targets"
                  @click="loadMoreTargets"
                >
                  {{ loadingMore.targets ? '加载中…' : '加载更多' }}
                </button>
              </div>
            </section>
          </template>

          <!-- 子视图 2：老客维护（已消费客户专属，精简回访 + 健康度 + 复购） -->
          <template v-else-if="visitSub === 'existing'">
            <section class="visit-summary">
              <div>
                <div class="vs-label">合作老客（活跃 / 沉睡预警）</div>
                <div class="vs-val num">
                  {{ existingDash ? existingDash.kpis.totalExistingCount : 0 }}
                  <span>家 · 活跃 {{ existingDash ? existingDash.kpis.activeCount : 0 }} / 预警 {{ existingDash ? existingDash.kpis.dormantCount : 0 }}</span>
                </div>
              </div>
              <div class="vs-score">
                <div class="vs-label">维护得分</div>
                <div class="vs-val num">{{ existingDash ? existingDash.kpis.maintenanceScore.toFixed(2) : '0.00' }}<span>/ 20分</span></div>
              </div>
            </section>

            <div class="existing-kpi-strip">
              <span>本月回访 <strong>{{ existingDash ? `${existingDash.kpis.visitedThisMonthCount}/${existingDash.kpis.totalExistingCount}` : '0/0' }}</strong> 家</span>
              <span>本月复购 <strong class="num">¥{{ existingDash ? Number(existingDash.kpis.monthRepurchaseAmount || 0).toFixed(0) : '0' }}</strong></span>
            </div>

            <div class="visit-actions">
              <button type="button" class="m-btn m-btn-primary" @click="openSheet('existingVisit')">+ 记录老客回访</button>
              <button type="button" class="m-btn m-btn-outline" @click="openSheet('order')">+ 复购供货单</button>
            </div>

            <section class="hub-section">
              <div class="hub-sec-head">
                <span class="hub-sec-title">合作老客清单（{{ existingClients.length }}）</span>
                <span class="hub-sec-meta">沉睡预警优先</span>
              </div>
              <div class="group-list">
                <div v-if="!existingClients.length" class="m-empty">暂无已成交老客，首单过审或客户档案标为老客后自动入池</div>
                <button
                  v-for="c in existingClients"
                  :key="c.id"
                  type="button"
                  class="gl-row"
                  @click="openCustomerDetail(c.id)"
                >
                  <div class="gl-main">
                    <div class="gl-title">{{ c.name }}</div>
                    <div class="gl-sub">
                      {{ c.city }} · {{ c.salesRepName }} · 累计 ¥{{ Number(c.totalOrderAmount || 0).toFixed(0) }}
                    </div>
                  </div>
                  <div class="gl-right">
                    <div class="gl-amt num">{{ c.healthScore }} 分</div>
                    <span class="c-badge" :class="healthBadgeClass(c.healthGrade)">{{ c.healthGrade }}</span>
                  </div>
                </button>
              </div>
            </section>
          </template>

          <!-- 子视图 3：客户 360° 档案中心（查全量信息 + 随时修改 + 标为老客） -->
          <template v-else>
            <div class="crm-search-bar">
              <input
                v-model="customerSearch"
                class="m-input"
                placeholder="搜门店、城市、联系人或电话…"
              />
            </div>
            <div class="stage-pills">
              <button type="button" :class="{ on: customerStageFilter === 'ALL' }" @click="customerStageFilter = 'ALL'">
                全部 ({{ allCustomers.length }})
              </button>
              <button type="button" :class="{ on: customerStageFilter === 'PROSPECT' }" @click="customerStageFilter = 'PROSPECT'">
                新客 ({{ prospectCount }})
              </button>
              <button type="button" :class="{ on: customerStageFilter === 'EXISTING' }" @click="customerStageFilter = 'EXISTING'">
                老客 ({{ existingCount }})
              </button>
              <button type="button" :class="{ on: customerStageFilter === 'DORMANT' }" @click="customerStageFilter = 'DORMANT'">
                沉睡预警 ({{ dormantCount }})
              </button>
            </div>

            <section class="hub-section" style="margin-top: 12px">
              <div class="group-list">
                <div v-if="!filteredCustomers.length" class="m-empty">没有匹配的客户档案</div>
                <button
                  v-for="c in filteredCustomers"
                  :key="c.id"
                  type="button"
                  class="gl-row"
                  @click="openCustomerDetail(c.id)"
                >
                  <div class="gl-main">
                    <div class="gl-title-row">
                      <span class="gl-title">{{ c.name }}</span>
                      <span class="c-badge" :class="stageBadgeClass(c.lifecycleStage)">{{ stageLabel(c.lifecycleStage) }}</span>
                    </div>
                    <div class="gl-sub">
                      {{ c.city }} · {{ c.contactName || '未填联系人' }} · {{ c.salesRepName }}
                    </div>
                  </div>
                  <div class="gl-right">
                    <template v-if="c.isExisting">
                      <div class="gl-amt num">健康 {{ c.healthScore ?? 0 }}分</div>
                      <span class="gl-sub num">¥{{ Number(c.totalOrderAmount || 0).toFixed(0) }}</span>
                    </template>
                    <template v-else>
                      <div class="gl-amt num">五维 {{ c.prospectScore ?? 0 }}分</div>
                      <span class="gl-sub">{{ c.storeGrade || '待完善' }}</span>
                    </template>
                  </div>
                </button>
              </div>
              <div v-if="customersTotal > 0" class="m-pager-bar">
                <span class="m-pager-info">已显示 {{ allCustomers.length }} / {{ customersTotal }} 家</span>
                <button
                  v-if="allCustomers.length < customersTotal"
                  type="button"
                  class="m-load-more"
                  :disabled="loadingMore.customers"
                  @click="loadMoreCustomers"
                >
                  {{ loadingMore.customers ? '加载中…' : '加载更多' }}
                </button>
              </div>
            </section>
          </template>
        </template>

        <!-- 库存 Tab -->
        <template v-else-if="tab === 'stock'">
          <div class="hub-sec-head" style="margin-top: 2px">
            <span class="hub-sec-title">实时在仓库存</span>
            <span class="hub-sec-meta num">合计 {{ totalStockQty }} 盒</span>
          </div>
          <div class="group-list">
            <div v-if="!balances.length" class="m-empty">当前没有库存记录</div>
            <div v-for="b in balances" :key="b.id" class="gl-row static">
              <div class="gl-main">
                <div class="gl-title">{{ b.product.name }}</div>
                <div class="gl-sub">{{ b.warehouse.name }} · <span class="mono">{{ b.product.skuCode }}</span></div>
              </div>
              <div class="stock-qty">
                <span class="num">{{ b.qty }}</span>
                <span class="stock-unit">{{ b.product.unitName }}</span>
              </div>
            </div>
          </div>
          <div v-if="balancesTotal > 0" class="m-pager-bar">
            <span class="m-pager-info">已显示 {{ balances.length }} / {{ balancesTotal }} 条 SKU</span>
            <button
              v-if="balances.length < balancesTotal"
              type="button"
              class="m-load-more"
              :disabled="loadingMore.balances"
              @click="loadMoreBalances"
            >
              {{ loadingMore.balances ? '加载中…' : '加载更多' }}
            </button>
          </div>
        </template>

        <!-- 订单 Tab -->
        <template v-else>
          <div class="hub-sec-head" style="margin-top: 2px">
            <span class="hub-sec-title">我的订单（{{ ordersTotal }}）</span>
            <button type="button" class="hub-more" @click="openSheet('order')">+ 新建供货单</button>
          </div>
          <div class="group-list">
            <div v-if="!orders.length" class="m-empty">还没有订单</div>
            <div
              v-for="o in orders"
              :key="o.id"
              class="order-row"
              @click="toggleOrderCodes(o)"
            >
              <div class="order-top">
                <span class="mono order-doc">{{ o.docNo }}</span>
                <span class="order-status" :class="statusClass(o.status)">{{ statusLabel(o.status) }}</span>
              </div>
              <div class="order-mid">
                <span>{{ o.clinic?.name || o.buyerOrg?.name }}</span>
                <span class="order-scene-tag">{{ o.orderScene === 'HQ_TO_DEALER' ? '总仓→服务商' : '服务商→机构' }}</span>
              </div>
              <div class="order-bot">
                <span class="muted">
                  {{ orderQty(o) }} 盒 · {{ expandedOrderId === o.id ? '收起码明细' : '查看归属码' }}
                </span>
                <span class="num order-amount">¥{{ Number(o.totalAmount).toFixed(2) }}</span>
              </div>
              <div
                v-if="isHQ && o.status === 'PENDING_APPROVAL'"
                class="order-actions single"
                @click.stop
              >
                <button
                  type="button"
                  class="m-btn m-btn-primary order-act-btn"
                  @click="approveMobileOrder(o)"
                >
                  总部特批放行
                </button>
              </div>
              <div
                v-if="canOutboundOrder(o)"
                class="order-actions"
                @click.stop
              >
                <button
                  type="button"
                  class="m-btn m-btn-outline order-act-btn"
                  @click="openScan('OUTBOUND', o.id, false)"
                >
                  手工录码
                </button>
                <button
                  type="button"
                  class="m-btn m-btn-primary order-act-btn"
                  @click="openScan('OUTBOUND', o.id, true)"
                >
                  扫码出库
                </button>
              </div>

              <div v-if="expandedOrderId === o.id" class="order-codes-box" @click.stop>
                <div v-if="orderCodesLoading" class="oc-empty">正在读取出库防伪码…</div>
                <template v-else-if="orderCodesCache[o.id]">
                  <div v-if="!orderCodesCache[o.id].codes.length" class="oc-empty">
                    该单暂未扫码出库，出库后可在此查看归属码。
                  </div>
                  <template v-else>
                    <div class="oc-summary">
                      共 {{ orderCodesCache[o.id].summary.totalCodes }} 码（外箱 {{ orderCodesCache[o.id].summary.cartonCodes }} · 单盒 {{ orderCodesCache[o.id].summary.unitCodes }}）
                    </div>
                    <div v-for="c in orderCodesCache[o.id].codes" :key="c.token" class="oc-item">
                      <div class="oc-item-top">
                        <span class="m-chip" :class="c.codeLevel === 'CARTON' ? 'warn' : ''">
                          {{ c.codeLevel === 'CARTON' ? '外箱' : '单盒' }}
                        </span>
                        <span class="mono oc-token" @click="copyCode(c.token)">{{ formatCodeGroups(c.token) }}</span>
                      </div>
                      <div class="oc-item-bot">
                        <span class="oc-prod">{{ c.productName }}</span>
                        <div class="oc-links">
                          <button type="button" class="oc-link" @click="copyCode(c.token)">复制</button>
                          <router-link :to="`/v/${c.token}`" class="oc-link primary">验真</router-link>
                        </div>
                      </div>
                    </div>
                  </template>
                </template>
              </div>
            </div>
          </div>
          <div v-if="ordersTotal > 0" class="m-pager-bar">
            <span class="m-pager-info">已显示 {{ orders.length }} / {{ ordersTotal }} 单</span>
            <button
              v-if="orders.length < ordersTotal"
              type="button"
              class="m-load-more"
              :disabled="loadingMore.orders"
              @click="loadMoreOrders"
            >
              {{ loadingMore.orders ? '加载中…' : '加载更多订单' }}
            </button>
          </div>
        </template>
      </div>

      <!-- 真固定底部导航栏（居中全局唯一炭黑主扫码钮，永远钉在视口底部） -->
      <nav class="m-nav" aria-label="主导航">
        <button type="button" :class="{ active: tab === 'home' && !scanOpen }" @click="goTab('home')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span>首页</span>
        </button>
        <button type="button" :class="{ active: tab === 'visit' && !scanOpen }" @click="goTab('visit')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span>客户</span>
        </button>
        <button type="button" class="nav-scan" @click="scanOpen ? (scanOpen = false) : openScan()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
            <line x1="7" y1="12" x2="17" y2="12" />
          </svg>
          <span>{{ scanOpen ? '完成' : '扫码' }}</span>
        </button>
        <button type="button" :class="{ active: tab === 'stock' && !scanOpen }" @click="goTab('stock')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m7.5 4.27 9 5.15" />
            <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
            <path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />
          </svg>
          <span>库存</span>
        </button>
        <button type="button" :class="{ active: tab === 'orders' && !scanOpen }" @click="goTab('orders')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span>订单</span>
        </button>
      </nav>
    </template>

    <!-- 二级独立表单与 360° 档案页 -->
    <div v-if="activeSheet" class="sheet-overlay">
      <header class="sheet-header">
        <button type="button" class="sheet-back" @click="closeSheet">← 返回</button>
        <span class="sheet-title">{{ sheetTitle }}</span>
        <span class="sheet-spacer" />
      </header>

      <div class="sheet-body">
        <div v-if="toastMsg" class="toast-bar" :class="toastType">{{ toastMsg }}</div>

        <!-- 新建供货单（总部支持总仓→服务商 / 服务商→机构；服务商与外勤支持发终端机构） -->
        <template v-if="activeSheet === 'order'">
          <div v-if="isHQ" class="scene-seg">
            <button
              type="button"
              :class="{ on: orderForm.orderScene === 'HQ_TO_DEALER' }"
              @click="switchOrderScene('HQ_TO_DEALER')"
            >
              总仓 → 服务商
            </button>
            <button
              type="button"
              :class="{ on: orderForm.orderScene === 'DEALER_TO_CLINIC' }"
              @click="switchOrderScene('DEALER_TO_CLINIC')"
            >
              服务商 → 机构
            </button>
          </div>

          <div v-if="orderForm.orderScene === 'HQ_TO_DEALER'" class="m-field">
            <label class="m-label">目标服务商</label>
            <MobileSelect
              v-model="orderForm.buyerOrgId"
              title="选择目标服务商"
              placeholder="请选择服务商"
              :options="dealerSelectOptions"
            />
          </div>
          <div v-else class="m-field">
            <label class="m-label">终端机构</label>
            <MobileSelect
              v-model="orderForm.clinicId"
              title="选择终端机构"
              placeholder="请选择终端机构"
              :options="clinicSelectOptions"
            />
          </div>
          <div class="m-field">
            <label class="m-label">出库仓库</label>
            <MobileSelect
              v-model="orderForm.warehouseId"
              title="选择出库仓库"
              placeholder="请选择出库仓库"
              :options="activeOrderWarehouseOptions"
            />
          </div>
          <div class="m-field">
            <label class="m-label">商品</label>
            <MobileSelect
              v-model="orderForm.productId"
              title="选择供货商品"
              placeholder="请选择商品"
              :options="productSelectOptions"
            />
          </div>
          <div class="two-col">
            <div class="m-field">
              <label class="m-label">数量（盒）</label>
              <input v-model.number="orderForm.qty" type="number" min="1" class="m-input" />
            </div>
            <div class="m-field">
              <label class="m-label">折扣（%）</label>
              <input v-model.number="orderForm.discountPercent" type="number" min="10" max="100" class="m-input" />
            </div>
          </div>

          <div class="quote" :class="{ blocked: belowRedline }">
            <div class="quote-row">
              <span>折算单价</span>
              <span class="num">¥{{ discountedUnit.toFixed(2) }}</span>
            </div>
            <div class="quote-row">
              <span>本单合计</span>
              <span class="num quote-total">¥{{ orderTotal.toFixed(2) }}</span>
            </div>
            <div class="quote-note">
              {{ belowRedline ? '低于 3.5 折供货红线，提交将进入总部特批' : '在供货红线之上，提交后实时推送仓库' }}
            </div>
          </div>

          <div class="m-field" style="margin-top: 14px">
            <label class="m-label">备注</label>
            <input v-model="orderForm.remark" class="m-input" placeholder="选填，如：今日顺丰加急" />
          </div>
          <button type="button" class="m-btn m-btn-primary" @click="submitMobileOrder">
            {{ belowRedline ? '提交总部特批' : '提交供货单' }}
          </button>
        </template>

        <!-- 机构报备 -->
        <template v-else-if="activeSheet === 'report'">
          <p class="m-section-desc">提交即锁定服务端时间戳与 90 天保护期。</p>
          <div class="m-field">
            <label class="m-label">机构全称</label>
            <input v-model="reportForm.name" class="m-input" placeholder="如：南昌悦颜皮肤管理中心" />
          </div>
          <div class="two-col">
            <div class="m-field">
              <label class="m-label">所在城市</label>
              <input v-model="reportForm.city" class="m-input" />
            </div>
            <div class="m-field">
              <label class="m-label">负责人手机</label>
              <input v-model="reportForm.contactPhone" class="m-input" />
            </div>
          </div>
          <div class="m-field">
            <label class="m-label">负责人姓名</label>
            <input v-model="reportForm.contactName" class="m-input" />
          </div>
          <button type="button" class="m-btn m-btn-primary" @click="submitMobileReport">确认报备</button>
        </template>

        <!-- 门店五维评分 -->
        <template v-else-if="activeSheet === 'visitScore'">
          <div class="score-live" :class="{ ok: mobileScoreEval.isCompleted }">
            <div class="sl-top">
              <span class="sl-num num">{{ mobileScoreEval.totalScore }} / 100 分</span>
              <span class="sl-grade">{{ mobileScoreEval.storeGrade || mobileScoreEval.validationText }}</span>
            </div>
            <div class="sl-advice">{{ mobileScoreEval.actionAdvice || '选满五维后自动判定等级与跟进动作' }}</div>
          </div>

          <div class="two-col">
            <div class="m-field">
              <label class="m-label">机构名称</label>
              <input v-model="visitForm.clinicName" class="m-input" placeholder="如：尔湾" />
            </div>
            <div class="m-field">
              <label class="m-label">城市 / 区域</label>
              <input v-model="visitForm.cityRegion" class="m-input" placeholder="如：南昌市红谷滩区" />
            </div>
          </div>
          <div class="two-col">
            <div class="m-field">
              <label class="m-label">业务员姓名</label>
              <input v-model="visitForm.salesRepName" class="m-input" placeholder="姓名" />
            </div>
            <div class="m-field">
              <label class="m-label">线索来源</label>
              <MobileSelect
                v-model="visitForm.leadSource"
                title="选择线索来源"
                placeholder="请选择线索来源"
                :options="leadSourceSelectOptions"
              />
            </div>
          </div>
          <div v-for="dim in scoringDimensions" :key="dim.key" class="m-field">
            <label class="m-label">{{ dim.label }}</label>
            <MobileSelect
              v-model="(visitForm as any)[dim.key]"
              :title="`选择${dim.shortLabel}`"
              :placeholder="`请选择${dim.shortLabel}`"
              clearable
              :options="dim.options.map((opt) => ({ value: opt.value, label: opt.value, badge: `${opt.score}分` }))"
            />
          </div>
          <button type="button" class="m-btn m-btn-primary" @click="submitMobileVisitTarget">保存门店评分</button>
        </template>

        <!-- 拜访跟进记录 -->
        <template v-else-if="activeSheet === 'visitLog'">
          <div class="m-field">
            <label class="m-label">客户名称</label>
            <input v-model="followForm.customerName" list="m-crm-targets" class="m-input" placeholder="输入或选择计划内门店" />
            <datalist id="m-crm-targets">
              <option v-for="t in crmTargets" :key="t.id" :value="t.clinicName" />
            </datalist>
          </div>
          <div class="two-col">
            <div class="m-field">
              <label class="m-label">联系人</label>
              <input v-model="followForm.contactName" class="m-input" placeholder="姓名" />
            </div>
            <div class="m-field">
              <label class="m-label">角色</label>
              <MobileSelect
                v-model="followForm.contactRole"
                title="选择联系人角色"
                placeholder="选择角色"
                clearable
                :options="contactRoleSelectOptions"
              />
            </div>
          </div>
          <div class="two-col">
            <div class="m-field">
              <label class="m-label">电话</label>
              <input v-model="followForm.contactPhone" class="m-input" placeholder="手机号" />
            </div>
            <div class="m-field">
              <label class="m-label">是否成交</label>
              <MobileSelect
                v-model="followForm.dealStatus"
                title="选择成交状态"
                placeholder="选择状态"
                clearable
                :options="dealStatusSelectOptions"
              />
            </div>
          </div>
          <div class="m-field">
            <label class="m-label">城市会参与</label>
            <MobileSelect
              v-model="followForm.cityMeetingStatus"
              title="选择城市会参与状态"
              placeholder="选择状态"
              clearable
              :options="cityMeetingSelectOptions"
            />
          </div>
          <div class="m-field">
            <label class="m-label">拜访情况</label>
            <input v-model="followForm.visitSummary" class="m-input" placeholder="现场沟通情况与意向" />
          </div>
          <div class="m-field">
            <label class="m-label">客户需求</label>
            <input v-model="followForm.customerNeed" class="m-input" placeholder="如：试用装 / 政策咨询" />
          </div>
          <button type="button" class="m-btn m-btn-primary" @click="submitMobileFollowUp">提交新客拜访跟进</button>
        </template>

        <!-- 记录老客维护回访（极简 5 项，不重复填新客五维） -->
        <template v-else-if="activeSheet === 'existingVisit'">
          <p class="m-section-desc">老客专属精简表单，提交后实时计入本月 20 分维护考核并刷新客户健康度。</p>
          <div class="m-field">
            <label class="m-label">合作老客门店</label>
            <MobileSelect
              v-model="existingVisitForm.clinicId"
              title="选择合作老客"
              placeholder="请选择老客门店"
              :options="existingClientSelectOptions"
            />
          </div>
          <div class="two-col">
            <div class="m-field">
              <label class="m-label">回访方式</label>
              <MobileSelect
                v-model="existingVisitForm.visitType"
                title="选择回访方式"
                placeholder="请选择方式"
                :options="existingVisitTypeSelectOptions"
              />
            </div>
            <div class="m-field">
              <label class="m-label">门店余量（盒）</label>
              <input
                v-model.number="existingVisitForm.stockRemainBoxes"
                type="number"
                min="0"
                class="m-input"
                placeholder="如：8"
              />
            </div>
          </div>
          <div class="m-field">
            <label class="m-label">本月复购意向</label>
            <MobileSelect
              v-model="existingVisitForm.repurchaseIntent"
              title="选择本月复购意向"
              placeholder="请选择复购意向"
              :options="repurchaseIntentSelectOptions"
            />
          </div>
          <div class="m-field">
            <label class="m-label">本次维护纪要</label>
            <input
              v-model="existingVisitForm.visitSummary"
              class="m-input"
              placeholder="如：主推项目消耗快，下周预计补货 10 盒"
            />
          </div>
          <div class="m-field">
            <label class="m-label">客户需求 / 支持事项</label>
            <input
              v-model="existingVisitForm.customerNeed"
              class="m-input"
              placeholder="如：需要新品带教 / 物料陈列支持"
            />
          </div>
          <button type="button" class="m-btn m-btn-primary" @click="submitMobileExistingVisit">保存老客回访</button>
        </template>

        <!-- 客户 360° 全景档案（查所有文字/数字/自动计算分 + 随时修改 + 转老客） -->
        <template v-else-if="activeSheet === 'customerDetail'">
          <div v-if="customerDetailLoading" class="m-empty">正在读取客户 360° 档案…</div>
          <template v-else-if="activeCustomer">
            <div class="c-hero">
              <div class="c-hero-top">
                <div class="c-hero-name">{{ activeCustomer.clinic.name }}</div>
                <span class="c-badge" :class="stageBadgeClass(activeCustomer.clinic.lifecycleStage)">
                  {{ stageLabel(activeCustomer.clinic.lifecycleStage) }}
                </span>
              </div>
              <div class="c-hero-sub">
                {{ activeCustomer.orgName }} · {{ activeCustomer.clinic.city || '未填城市' }}
              </div>

              <!-- 自动计算评分卡：老客显示健康度+复购，新客显示五维得分 -->
              <div v-if="activeCustomer.isExisting" class="c-score-band">
                <div class="csb-item">
                  <span class="csb-label">老客健康度</span>
                  <span class="csb-val num">{{ activeCustomer.healthEval?.healthScore ?? 0 }}<small>/100</small></span>
                </div>
                <div class="csb-item">
                  <span class="csb-label">累计供货</span>
                  <span class="csb-val num">¥{{ Number(activeCustomer.orderSummary?.totalOrderAmount || 0).toFixed(0) }}</span>
                </div>
                <div class="csb-item">
                  <span class="csb-label">距上次下单</span>
                  <span class="csb-val num">{{ activeCustomer.orderSummary?.daysSinceLastOrder ?? '—' }}<small v-if="activeCustomer.orderSummary?.daysSinceLastOrder !== null">天</small></span>
                </div>
              </div>
              <div v-else class="c-score-band two">
                <div class="csb-item">
                  <span class="csb-label">新客五维评分</span>
                  <span class="csb-val num">{{ activeCustomer.prospectEval?.totalScore ?? 0 }}<small>/100</small></span>
                </div>
                <div class="csb-item">
                  <span class="csb-label">门店评级</span>
                  <span class="csb-val">{{ activeCustomer.prospectEval?.storeGrade || '待完善' }}</span>
                </div>
              </div>
            </div>

            <div class="visit-actions" style="margin-top: 12px">
              <button type="button" class="m-btn m-btn-primary" @click="openCustomerEdit">编辑档案</button>
              <button
                v-if="!activeCustomer.isExisting"
                type="button"
                class="m-btn m-btn-outline"
                @click="markActiveCustomerExisting"
              >
                标为老客
              </button>
              <button
                v-else
                type="button"
                class="m-btn m-btn-outline"
                @click="openExistingVisitFor(activeCustomer.clinic.id)"
              >
                + 记老客回访
              </button>
            </div>

            <!-- 完整建档信息（业务员填写的全部文字/数字均可查） -->
            <div class="c-section">
              <div class="c-sec-title">基本档案与联系信息</div>
              <div class="c-kv-grid">
                <div class="c-kv"><span>联系人</span><strong>{{ activeCustomer.clinic.contactName || '—' }} {{ activeCustomer.clinic.contactRole ? `(${activeCustomer.clinic.contactRole})` : '' }}</strong></div>
                <div class="c-kv"><span>联系电话</span><strong class="mono">{{ activeCustomer.clinic.contactPhone || '—' }}</strong></div>
                <div class="c-kv"><span>微信号</span><strong class="mono">{{ activeCustomer.clinic.wechatId || '—' }}</strong></div>
                <div class="c-kv"><span>负责业务员</span><strong>{{ activeCustomer.clinic.salesRepName || '—' }}</strong></div>
                <div class="c-kv"><span>线索来源</span><strong>{{ activeCustomer.clinic.leadSource || '—' }}</strong></div>
                <div class="c-kv"><span>城市 / 区域</span><strong>{{ activeCustomer.clinic.city || '—' }}</strong></div>
                <div class="c-kv full"><span>详细地址</span><strong>{{ activeCustomer.clinic.address || '—' }}</strong></div>
                <div class="c-kv full"><span>客情备注</span><strong>{{ activeCustomer.clinic.remark || '—' }}</strong></div>
              </div>
            </div>

            <!-- 若为新客：展示五维评分明细 + 新客跟进记录 -->
            <template v-if="!activeCustomer.isExisting">
              <div class="c-section">
                <div class="c-sec-title">新客五维评分明细</div>
                <div class="c-dim-list">
                  <div class="c-dim-row"><span>门店类型</span><span>{{ activeCustomer.clinic.storeType || '未填' }}</span><strong class="num">{{ activeCustomer.prospectEval?.storeTypeScore ?? 0 }}分</strong></div>
                  <div class="c-dim-row"><span>引流价格</span><span>{{ activeCustomer.clinic.trafficPrice || '未填' }}</span><strong class="num">{{ activeCustomer.prospectEval?.trafficPriceScore ?? 0 }}分</strong></div>
                  <div class="c-dim-row"><span>门店面积</span><span>{{ activeCustomer.clinic.storeArea || '未填' }}</span><strong class="num">{{ activeCustomer.prospectEval?.storeAreaScore ?? 0 }}分</strong></div>
                  <div class="c-dim-row"><span>美容师数</span><span>{{ activeCustomer.clinic.beauticianCount || '未填' }}</span><strong class="num">{{ activeCustomer.prospectEval?.beauticianScore ?? 0 }}分</strong></div>
                  <div class="c-dim-row"><span>门店规模</span><span>{{ activeCustomer.clinic.storeScale || '未填' }}</span><strong class="num">{{ activeCustomer.prospectEval?.storeScaleScore ?? 0 }}分</strong></div>
                </div>
              </div>

              <div class="c-section">
                <div class="c-sec-title">新客拜访跟进（{{ activeCustomer.prospectVisits?.length || 0 }}）</div>
                <div v-if="!activeCustomer.prospectVisits?.length" class="c-empty-box">暂无新客跟进记录</div>
                <div v-for="f in activeCustomer.prospectVisits || []" :key="f.id" class="c-log-card">
                  <div class="c-log-top">
                    <span class="mono">{{ formatShortDate(f.visitDate) }}</span>
                    <span>{{ f.salesRepName }}</span>
                  </div>
                  <div class="c-log-text">{{ f.visitSummary || '无沟通纪要' }}</div>
                  <div v-if="f.customerNeed || f.dealStatus" class="c-log-meta">
                    <span v-if="f.dealStatus">状态：{{ f.dealStatus }}</span>
                    <span v-if="f.customerNeed">需求：{{ f.customerNeed }}</span>
                  </div>
                </div>
              </div>
            </template>

            <!-- 若为老客：展示老客维护记录 + 历史供货 + 默认折叠的新客评分历史快照 -->
            <template v-else>
              <div class="c-section">
                <div class="c-sec-title">老客维护回访（{{ activeCustomer.existingVisits?.length || 0 }}）</div>
                <div v-if="!activeCustomer.existingVisits?.length" class="c-empty-box">暂无老客回访记录，点击上方「+ 记老客回访」录入</div>
                <div v-for="v in activeCustomer.existingVisits || []" :key="v.id" class="c-log-card">
                  <div class="c-log-top">
                    <span class="mono">{{ formatShortDate(v.visitDate) }} · {{ v.visitType || '日常维护' }}</span>
                    <span class="c-badge">{{ v.repurchaseIntent || '未选意向' }}</span>
                  </div>
                  <div class="c-log-text">{{ v.visitSummary || '无维护纪要' }}</div>
                  <div class="c-log-meta">
                    <span v-if="v.stockRemainBoxes !== null && v.stockRemainBoxes !== undefined">余量：{{ v.stockRemainBoxes }} 盒</span>
                    <span v-if="v.customerNeed">需求：{{ v.customerNeed }}</span>
                  </div>
                </div>
              </div>

              <div class="c-section">
                <div class="c-sec-title">近期供货订单（{{ activeCustomer.recentOrders?.length || 0 }}）</div>
                <div v-if="!activeCustomer.recentOrders?.length" class="c-empty-box">暂无系统内订单（可能为历史导入老客）</div>
                <div v-for="o in activeCustomer.recentOrders || []" :key="o.id" class="c-log-card">
                  <div class="c-log-top">
                    <span class="mono">{{ o.docNo }}</span>
                    <strong class="num">¥{{ Number(o.totalAmount || 0).toFixed(2) }}</strong>
                  </div>
                  <div class="c-log-meta">
                    <span>{{ formatShortDate(o.bizDate) }}</span>
                    <span>{{ statusLabel(o.status) }}</span>
                  </div>
                </div>
              </div>

              <!-- 剔除冗杂：新客开发期五维评分快照默认折叠，仅在查档需要时展开 -->
              <div v-if="activeCustomer.initialScoreSnapshot" class="c-section">
                <button
                  type="button"
                  class="c-collapse-btn"
                  @click="showHistorySnapshot = !showHistorySnapshot"
                >
                  <span>新客期初始五维评分快照（{{ activeCustomer.initialScoreSnapshot.totalScore }} 分 · 已归档）</span>
                  <span>{{ showHistorySnapshot ? '收起 ▲' : '展开 ▼' }}</span>
                </button>
                <div v-if="showHistorySnapshot" class="c-dim-list" style="margin-top: 8px">
                  <div class="c-dim-row"><span>门店类型</span><span>{{ activeCustomer.initialScoreSnapshot.storeType || '—' }}</span><strong class="num">{{ activeCustomer.initialScoreSnapshot.storeTypeScore ?? 0 }}分</strong></div>
                  <div class="c-dim-row"><span>引流价格</span><span>{{ activeCustomer.initialScoreSnapshot.trafficPrice || '—' }}</span><strong class="num">{{ activeCustomer.initialScoreSnapshot.trafficPriceScore ?? 0 }}分</strong></div>
                  <div class="c-dim-row"><span>门店面积</span><span>{{ activeCustomer.initialScoreSnapshot.storeArea || '—' }}</span><strong class="num">{{ activeCustomer.initialScoreSnapshot.storeAreaScore ?? 0 }}分</strong></div>
                  <div class="c-dim-row"><span>美容师数</span><span>{{ activeCustomer.initialScoreSnapshot.beauticianCount || '—' }}</span><strong class="num">{{ activeCustomer.initialScoreSnapshot.beauticianScore ?? 0 }}分</strong></div>
                  <div class="c-dim-row"><span>门店规模</span><span>{{ activeCustomer.initialScoreSnapshot.storeScale || '—' }}</span><strong class="num">{{ activeCustomer.initialScoreSnapshot.storeScaleScore ?? 0 }}分</strong></div>
                </div>
              </div>
            </template>

            <!-- 修改审计留痕 -->
            <div v-if="activeCustomer.editHistory?.length" class="c-section">
              <div class="c-sec-title">档案变更留痕</div>
              <div v-for="log in activeCustomer.editHistory.slice(0, 5)" :key="log.id" class="c-audit-row">
                <div class="c-audit-sum">{{ log.summary }}</div>
                <div class="c-audit-meta">{{ log.operatorName }} · {{ formatDateTime(log.createdAt, true) }}</div>
              </div>
            </div>
          </template>
        </template>

        <!-- 编辑客户档案（业务员可随时修改并自动留痕） -->
        <template v-else-if="activeSheet === 'customerEdit'">
          <p class="m-section-desc">修改后与 PC 端实时同步，并自动写入修改前/后审计留痕。</p>
          <div class="m-field">
            <label class="m-label">机构全称</label>
            <input v-model="customerEditForm.name" class="m-input" placeholder="必填" />
          </div>
          <div class="two-col">
            <div class="m-field">
              <label class="m-label">城市 / 区域</label>
              <input v-model="customerEditForm.city" class="m-input" placeholder="必填" />
            </div>
            <div class="m-field">
              <label class="m-label">负责业务员</label>
              <input v-model="customerEditForm.salesRepName" class="m-input" placeholder="姓名" />
            </div>
          </div>
          <div class="m-field">
            <label class="m-label">详细地址</label>
            <input v-model="customerEditForm.address" class="m-input" placeholder="街道/门牌号" />
          </div>
          <div class="two-col">
            <div class="m-field">
              <label class="m-label">联系人</label>
              <input v-model="customerEditForm.contactName" class="m-input" placeholder="姓名" />
            </div>
            <div class="m-field">
              <label class="m-label">职位角色</label>
              <MobileSelect
                v-model="customerEditForm.contactRole"
                title="选择职位角色"
                placeholder="选择角色"
                clearable
                :options="contactRoleSelectOptions"
              />
            </div>
          </div>
          <div class="two-col">
            <div class="m-field">
              <label class="m-label">联系电话</label>
              <input v-model="customerEditForm.contactPhone" class="m-input" placeholder="手机号/座机" />
            </div>
            <div class="m-field">
              <label class="m-label">微信号</label>
              <input v-model="customerEditForm.wechatId" class="m-input" placeholder="微信号" />
            </div>
          </div>
          <div class="m-field">
            <label class="m-label">线索来源</label>
            <MobileSelect
              v-model="customerEditForm.leadSource"
              title="选择线索来源"
              placeholder="选择线索来源"
              clearable
              :options="leadSourceSelectOptions"
            />
          </div>
          <div class="m-field">
            <label class="m-label">客情备注</label>
            <input v-model="customerEditForm.remark" class="m-input" placeholder="记录核心客情、偏好或注意事项" />
          </div>

          <!-- 仅新客在编辑页开放五维评分修改（老客已冻结归档，保持表单清爽） -->
          <template v-if="activeCustomer && !activeCustomer.isExisting">
            <div class="score-live" :class="{ ok: editScoreEval.isCompleted }" style="margin-top: 12px">
              <div class="sl-top">
                <span class="sl-num num">{{ editScoreEval.totalScore }} / 100 分</span>
                <span class="sl-grade">{{ editScoreEval.storeGrade || editScoreEval.validationText }}</span>
              </div>
              <div class="sl-advice">修改五维维度后，新客评分与计划看板将自动重算</div>
            </div>
            <div v-for="dim in scoringDimensions" :key="dim.key" class="m-field">
              <label class="m-label">{{ dim.label }}</label>
              <MobileSelect
                v-model="(customerEditForm as any)[dim.key]"
                :title="`选择${dim.shortLabel}`"
                :placeholder="`请选择${dim.shortLabel}`"
                clearable
                :options="dim.options.map((opt) => ({ value: opt.value, label: opt.value, badge: `${opt.score}分` }))"
              />
            </div>
          </template>

          <button type="button" class="m-btn m-btn-primary" :disabled="customerEditSaving" @click="saveCustomerEdit">
            {{ customerEditSaving ? '保存中…' : '保存客户档案' }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  CITY_MEETING_OPTIONS,
  CONTACT_ROLE_OPTIONS,
  DEAL_STATUS_OPTIONS,
  evaluateStoreVisitTarget,
  EXISTING_VISIT_TYPE_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  REPURCHASE_INTENT_OPTIONS,
  STORE_SCORING_DIMENSIONS,
} from '@lumina/shared-types';
import { getAppBase, mApi } from '../utils/api';
import { formatDateTime } from '../utils/format';
import MobileScanSheet from '../components/MobileScanSheet.vue';
import MobileSelect, { type MobileSelectOption } from '../components/MobileSelect.vue';

const route = useRoute();
const isNativeApp =
  typeof window !== 'undefined' && Boolean((window as any).Capacitor?.isNativePlatform?.());
const apkDownloadUrl = `${getAppBase()}/downloads/lumina-scanner.apk`;
const isAppPreview = computed(() => route.query.preview === 'app');
const isAppRuntime = computed(() => isNativeApp || isAppPreview.value);
const scanOpen = ref(false);
const scanInitialMode = ref<'INBOUND' | 'OUTBOUND' | 'TRACE' | ''>('');
const scanInitialOrderId = ref('');
const scanAutoStart = ref(true);
const scanSheetKey = ref(0);

function openScan(mode: 'INBOUND' | 'OUTBOUND' | 'TRACE' | '' = '', orderId = '', autoStart = true) {
  scanInitialMode.value = mode;
  scanInitialOrderId.value = orderId;
  scanAutoStart.value = autoStart;
  scanSheetKey.value += 1;
  scanOpen.value = true;
}

const user = ref<any>(
  (() => {
    try {
      const s = localStorage.getItem('lumina_mobile_user');
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  })(),
);

const isHQ = computed(() => user.value?.orgType === 'HQ');
const shortUserName = computed(() => (user.value?.realName || '').replace(/（.*?）/g, '').trim());

const tab = ref<'home' | 'visit' | 'stock' | 'orders'>('home');
const visitSub = ref<'new' | 'existing' | 'customers'>('new');
const activeSheet = ref<
  null | 'order' | 'report' | 'visitScore' | 'visitLog' | 'existingVisit' | 'customerDetail' | 'customerEdit'
>(null);
const returnToCustomerDetail = ref(false);

const sheetTitle = computed(() => {
  const map: Record<string, string> = {
    order: '新建供货单',
    report: '机构报备',
    visitScore: '新客五维评分',
    visitLog: '记录新客跟进',
    existingVisit: '记录老客回访',
    customerDetail: '客户 360° 档案',
    customerEdit: '编辑客户档案',
  };
  return activeSheet.value ? map[activeSheet.value] : '';
});

function goTab(next: 'home' | 'visit' | 'stock' | 'orders') {
  scanOpen.value = false;
  tab.value = next;
}

function openCustomerMode(sub: 'new' | 'existing' | 'customers') {
  scanOpen.value = false;
  tab.value = 'visit';
  visitSub.value = sub;
}

function closeSheet() {
  if (activeSheet.value === 'customerEdit') {
    activeSheet.value = 'customerDetail';
    return;
  }
  if (activeSheet.value === 'existingVisit' && returnToCustomerDetail.value) {
    returnToCustomerDetail.value = false;
    activeSheet.value = 'customerDetail';
    return;
  }
  activeSheet.value = null;
}

function initOrderDefaults(scene: 'HQ_TO_DEALER' | 'DEALER_TO_CLINIC') {
  orderForm.value.orderScene = scene;
  if (scene === 'HQ_TO_DEALER') {
    const validDealer = dealers.value.find((d) => !d.supplyFrozen) || dealers.value[0];
    if (!orderForm.value.buyerOrgId || !dealers.value.some((d) => d.id === orderForm.value.buyerOrgId)) {
      orderForm.value.buyerOrgId = validDealer?.id || '';
    }
    const hqWh = hqWarehouses.value[0] || warehouses.value[0];
    if (hqWh) orderForm.value.warehouseId = hqWh.id;
    orderForm.value.discountPercent = 40;
  } else {
    if (!orderForm.value.clinicId || !clinics.value.some((c) => c.id === orderForm.value.clinicId)) {
      orderForm.value.clinicId = clinics.value[0]?.id || '';
    }
    const wh = warehouses.value[0];
    if (wh) orderForm.value.warehouseId = wh.id;
    orderForm.value.discountPercent = 55;
  }
  if (!orderForm.value.productId && products.value.length) {
    orderForm.value.productId = products.value[0].id;
  }
}

function switchOrderScene(scene: 'HQ_TO_DEALER' | 'DEALER_TO_CLINIC') {
  initOrderDefaults(scene);
}

function openSheet(name: 'order' | 'report' | 'visitScore' | 'visitLog' | 'existingVisit') {
  toastMsg.value = '';
  returnToCustomerDetail.value = false;
  if (name === 'order') {
    initOrderDefaults(isHQ.value ? 'HQ_TO_DEALER' : 'DEALER_TO_CLINIC');
  }
  if (name === 'existingVisit') {
    if (!existingVisitForm.value.clinicId && existingClients.value.length) {
      existingVisitForm.value.clinicId = existingClients.value[0].id;
    }
  }
  activeSheet.value = name;
}

const scoringDimensions = STORE_SCORING_DIMENSIONS;
const leadSources = LEAD_SOURCE_OPTIONS;
const contactRoles = CONTACT_ROLE_OPTIONS;
const cityMeetingOptions = CITY_MEETING_OPTIONS;
const dealStatusOptions = DEAL_STATUS_OPTIONS;

const registerRoleOptions: MobileSelectOption[] = [
  { value: 'SALES_REP', label: '外勤销售 / 渠道业务员' },
  { value: 'DEALER_WAREHOUSE', label: '服务商库管' },
];
const leadSourceSelectOptions: MobileSelectOption[] = leadSources.map((s) => ({ value: s, label: s }));
const contactRoleSelectOptions: MobileSelectOption[] = contactRoles.map((r) => ({ value: r, label: r }));
const dealStatusSelectOptions: MobileSelectOption[] = dealStatusOptions.map((d) => ({ value: d, label: d }));
const cityMeetingSelectOptions: MobileSelectOption[] = cityMeetingOptions.map((c) => ({ value: c, label: c }));
const existingVisitTypeSelectOptions: MobileSelectOption[] = EXISTING_VISIT_TYPE_OPTIONS.map((v) => ({
  value: v,
  label: v,
}));
const repurchaseIntentSelectOptions: MobileSelectOption[] = REPURCHASE_INTENT_OPTIONS.map((v) => ({
  value: v,
  label: v,
}));
const publicDealerOptions = computed<MobileSelectOption[]>(() =>
  publicDealers.value.map((d) => ({ value: d.id, label: d.name })),
);
const clinicSelectOptions = computed<MobileSelectOption[]>(() =>
  clinics.value.map((c) => ({ value: c.id, label: c.name, sub: c.city || '' })),
);
const dealerSelectOptions = computed<MobileSelectOption[]>(() =>
  dealers.value.map((d) => ({
    value: d.id,
    label: d.name,
    sub: d.supplyFrozen ? '已停供冻结（禁止开单）' : d.region || '区域服务商',
    badge: d.supplyFrozen ? '已停供' : undefined,
  })),
);
const hqWarehouses = computed(() => {
  const hq = warehouses.value.filter((w) => w.org?.type === 'HQ');
  return hq.length ? hq : warehouses.value;
});
const activeOrderWarehouseOptions = computed<MobileSelectOption[]>(() => {
  const list = orderForm.value.orderScene === 'HQ_TO_DEALER' ? hqWarehouses.value : warehouses.value;
  return list.map((w) => ({ value: w.id, label: w.name }));
});
const productSelectOptions = computed<MobileSelectOption[]>(() =>
  products.value.map((p) => ({ value: p.id, label: p.name, sub: p.skuCode || '', badge: `¥${p.retailPrice}` })),
);
const crmDash = ref<any>(null);
const crmTargets = ref<any[]>([]);
const existingDash = ref<any>(null);
const allCustomers = ref<any[]>([]);
const customerSearch = ref('');
const customerStageFilter = ref<'ALL' | 'PROSPECT' | 'EXISTING' | 'DORMANT'>('ALL');
const activeCustomer = ref<any>(null);
const customerDetailLoading = ref(false);
const showHistorySnapshot = ref(false);
const customerEditSaving = ref(false);

const existingClients = computed<any[]>(() => existingDash.value?.clients || []);
const existingClientSelectOptions = computed<MobileSelectOption[]>(() =>
  existingClients.value.map((c) => ({
    value: c.id,
    label: c.name,
    sub: `${c.city || ''} · ${c.salesRepName || ''}`,
    badge: `${c.healthScore}分`,
  })),
);
const prospectCount = computed(() => allCustomers.value.filter((c) => !c.isExisting).length);
const existingCount = computed(() => allCustomers.value.filter((c) => c.isExisting).length);
const dormantCount = computed(
  () => allCustomers.value.filter((c) => c.lifecycleStage === 'EXISTING_DORMANT').length,
);
const filteredCustomers = computed(() => {
  const kw = customerSearch.value.trim().toLowerCase();
  return allCustomers.value.filter((c) => {
    if (customerStageFilter.value === 'PROSPECT' && c.isExisting) return false;
    if (customerStageFilter.value === 'EXISTING' && !c.isExisting) return false;
    if (customerStageFilter.value === 'DORMANT' && c.lifecycleStage !== 'EXISTING_DORMANT') return false;
    if (!kw) return true;
    return (
      String(c.name || '').toLowerCase().includes(kw) ||
      String(c.city || '').toLowerCase().includes(kw) ||
      String(c.contactName || '').toLowerCase().includes(kw) ||
      String(c.contactPhone || '').toLowerCase().includes(kw) ||
      String(c.salesRepName || '').toLowerCase().includes(kw) ||
      String(c.remark || '').toLowerCase().includes(kw)
    );
  });
});

const existingVisitForm = ref({
  clinicId: '',
  visitType: '到店回访',
  stockRemainBoxes: null as number | null,
  repurchaseIntent: '明确补货',
  visitSummary: '',
  customerNeed: '',
});

const customerEditForm = ref({
  name: '',
  city: '',
  address: '',
  contactName: '',
  contactRole: '',
  contactPhone: '',
  wechatId: '',
  salesRepName: '',
  leadSource: '',
  remark: '',
  storeType: '',
  trafficPrice: '',
  storeArea: '',
  beauticianCount: '',
  storeScale: '',
});

const editScoreEval = computed(() =>
  evaluateStoreVisitTarget({
    clinicName: customerEditForm.value.name,
    cityRegion: customerEditForm.value.city,
    storeType: customerEditForm.value.storeType,
    trafficPrice: customerEditForm.value.trafficPrice,
    storeArea: customerEditForm.value.storeArea,
    beauticianCount: customerEditForm.value.beauticianCount,
    storeScale: customerEditForm.value.storeScale,
  }),
);

const visitForm = ref({
  salesRepName: user.value?.realName?.replace(/（.*?）/g, '') || '',
  clinicName: '',
  cityRegion: '南昌市红谷滩区',
  leadSource: '大众美团',
  storeType: '',
  trafficPrice: '',
  storeArea: '',
  beauticianCount: '',
  storeScale: '',
});

const mobileScoreEval = computed(() => evaluateStoreVisitTarget(visitForm.value));

const followForm = ref({
  customerName: '',
  contactName: '',
  contactRole: '',
  contactPhone: '',
  cityMeetingStatus: '',
  dealStatus: '',
  visitSummary: '',
  customerNeed: '',
});

const authMode = ref<'sms' | 'password' | 'register'>('sms');
const loginForm = ref({ username: '', password: '' });
const smsLoginForm = ref({ phone: '', code: '' });
const regForm = ref({
  phone: '',
  code: '',
  realName: '',
  password: '',
  orgId: '',
  roleCode: 'SALES_REP',
});
const publicDealers = ref<any[]>([]);
const smsSending = ref(false);
const smsCooldown = ref(0);
let smsTimer: ReturnType<typeof setInterval> | null = null;
const toastMsg = ref('');
const toastType = ref<'ok' | 'err'>('ok');

const clinics = ref<any[]>([]);
const warehouses = ref<any[]>([]);
const dealers = ref<any[]>([]);
const products = ref<any[]>([]);
const balances = ref<any[]>([]);
const orders = ref<any[]>([]);
const expandedOrderId = ref<string | null>(null);
const orderCodesLoading = ref(false);
const orderCodesCache = ref<Record<string, any>>({});

const totalStockQty = computed(() => balances.value.reduce((s, b) => s + Number(b.qty || 0), 0));
const pendingOrderCount = computed(
  () => orders.value.filter((o) => ['PENDING_OUTBOUND', 'PARTIAL_OUTBOUND', 'PENDING_APPROVAL'].includes(o.status)).length,
);
const recentOrders = computed(() => orders.value.slice(0, 3));

function orderQty(o: any) {
  return (o.items || []).reduce((s: number, i: any) => s + Number(i.qty || 0), 0);
}

function jumpToOrder(o: any) {
  tab.value = 'orders';
  toggleOrderCodes(o);
}

function formatCodeGroups(token?: string | null) {
  if (!token) return '—';
  const clean = token.trim();
  return clean.length === 16 ? clean.replace(/(.{4})(?=.)/g, '$1 ') : clean;
}

function copyCode(token: string) {
  navigator.clipboard?.writeText(token);
  showToast(`已复制防伪码：${token}`, 'ok');
}

async function toggleOrderCodes(order: any) {
  if (expandedOrderId.value === order.id) {
    expandedOrderId.value = null;
    return;
  }
  expandedOrderId.value = order.id;
  if (orderCodesCache.value[order.id]) return;
  orderCodesLoading.value = true;
  try {
    orderCodesCache.value[order.id] = await mApi.get(`/sales-orders/${order.id}/codes`);
  } catch (err: any) {
    showToast(err.response?.data?.message || '读取码明细失败', 'err');
  } finally {
    orderCodesLoading.value = false;
  }
}

const orderForm = ref({
  orderScene: 'DEALER_TO_CLINIC' as 'HQ_TO_DEALER' | 'DEALER_TO_CLINIC',
  buyerOrgId: '',
  clinicId: '',
  warehouseId: '',
  productId: '',
  qty: 2,
  discountPercent: 55,
  remark: '',
});

const reportForm = ref({
  name: '',
  city: '南昌市',
  contactName: '',
  contactPhone: '',
});

const currentProduct = computed(() => products.value.find((p) => p.id === orderForm.value.productId));
const discountedUnit = computed(() => {
  const price = Number(currentProduct.value?.retailPrice || 0);
  return (price * orderForm.value.discountPercent) / 100;
});
const orderTotal = computed(() => discountedUnit.value * Number(orderForm.value.qty || 0));
const belowRedline = computed(() => Number(orderForm.value.discountPercent) < 35);

function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
  toastMsg.value = msg;
  toastType.value = type;
  setTimeout(() => {
    if (toastMsg.value === msg) toastMsg.value = '';
  }, 4200);
}

async function loadPublicRegisterOptions() {
  try {
    const opts = (await mApi.get('/auth/register-options')) as any;
    publicDealers.value = opts.dealers || [];
    if (publicDealers.value.length && !regForm.value.orgId) {
      regForm.value.orgId = publicDealers.value[0].id;
    }
  } catch {
    // ignore
  }
}

function startSmsCooldown(sec = 60) {
  if (smsTimer) clearInterval(smsTimer);
  smsCooldown.value = sec;
  smsTimer = setInterval(() => {
    smsCooldown.value -= 1;
    if (smsCooldown.value <= 0 && smsTimer) {
      clearInterval(smsTimer);
      smsTimer = null;
    }
  }, 1000);
}

async function sendMobileSms(phone: string, scene: 'LOGIN' | 'REGISTER') {
  const clean = phone.trim();
  if (!/^1[3-9]\d{9}$/.test(clean)) {
    return showToast('请输入有效的 11 位手机号', 'err');
  }
  smsSending.value = true;
  try {
    const res = (await mApi.post('/auth/sms/send', { phone: clean, scene })) as any;
    startSmsCooldown(res.cooldownSeconds || 60);
    showToast(res.message || '短信验证码已发送', 'ok');
  } catch (err: any) {
    showToast(err.response?.data?.message || '发送验证码失败', 'err');
  } finally {
    smsSending.value = false;
  }
}

function switchAuthMode(next: 'sms' | 'password' | 'register') {
  authMode.value = next;
  toastMsg.value = '';
}

async function doLogin() {
  try {
    const res = (await mApi.post('/auth/login', loginForm.value)) as any;
    localStorage.setItem('lumina_mobile_token', res.accessToken);
    localStorage.setItem('lumina_mobile_user', JSON.stringify(res.user));
    user.value = res.user;
    toastMsg.value = '';
    await loadData();
  } catch (err: any) {
    showToast(err.response?.data?.message || '登录失败', 'err');
  }
}

async function doSmsLogin() {
  try {
    const res = (await mApi.post('/auth/login-sms', {
      phone: smsLoginForm.value.phone.trim(),
      code: smsLoginForm.value.code.trim(),
    })) as any;
    localStorage.setItem('lumina_mobile_token', res.accessToken);
    localStorage.setItem('lumina_mobile_user', JSON.stringify(res.user));
    user.value = res.user;
    smsLoginForm.value.code = '';
    toastMsg.value = '';
    await loadData();
    if (res.isNewUser) {
      showToast('首次短信验证，已自动注册并登录', 'ok');
    }
  } catch (err: any) {
    showToast(err.response?.data?.message || '短信验证登录失败', 'err');
  }
}

async function doSmsRegister() {
  try {
    const res = (await mApi.post('/auth/register', {
      phone: regForm.value.phone.trim(),
      code: regForm.value.code.trim(),
      realName: regForm.value.realName.trim(),
      password: regForm.value.password,
      orgId: regForm.value.orgId || undefined,
      roleCode: regForm.value.roleCode,
    })) as any;
    localStorage.setItem('lumina_mobile_token', res.accessToken);
    localStorage.setItem('lumina_mobile_user', JSON.stringify(res.user));
    user.value = res.user;
    regForm.value.code = '';
    regForm.value.password = '';
    toastMsg.value = '';
    await loadData();
  } catch (err: any) {
    showToast(err.response?.data?.message || '注册失败', 'err');
  }
}

function logout() {
  localStorage.removeItem('lumina_mobile_token');
  localStorage.removeItem('lumina_mobile_user');
  user.value = null;
  activeSheet.value = null;
  scanOpen.value = false;
  toastMsg.value = '';
}

const MOBILE_PAGE_SIZE = 20;
const ordersPage = ref(1);
const ordersTotal = ref(0);
const balancesPage = ref(1);
const balancesTotal = ref(0);
const crmTargetsPage = ref(1);
const crmTargetsTotal = ref(0);
const customersPage = ref(1);
const customersTotal = ref(0);
const loadingMore = ref({ orders: false, balances: false, targets: false, customers: false });

function unpackPage(res: any): { items: any[]; total: number } {
  if (Array.isArray(res)) return { items: res, total: res.length };
  return { items: res?.items || [], total: Number(res?.total ?? (res?.items?.length || 0)) };
}

function canOutboundOrder(o: any): boolean {
  if (!user.value) return false;
  if (!['PENDING_OUTBOUND', 'PARTIAL_OUTBOUND'].includes(o.status)) return false;
  if (isHQ.value) return true;
  return o.sellerOrgId === user.value.orgId;
}

async function loadMoreOrders() {
  if (loadingMore.value.orders || orders.value.length >= ordersTotal.value) return;
  loadingMore.value.orders = true;
  try {
    const next = ordersPage.value + 1;
    const res = unpackPage(await mApi.get('/sales-orders', { params: { page: next, pageSize: MOBILE_PAGE_SIZE } }));
    orders.value = [...orders.value, ...res.items];
    ordersTotal.value = res.total;
    ordersPage.value = next;
  } finally {
    loadingMore.value.orders = false;
  }
}

async function loadMoreBalances() {
  if (loadingMore.value.balances || balances.value.length >= balancesTotal.value) return;
  loadingMore.value.balances = true;
  try {
    const next = balancesPage.value + 1;
    const res = unpackPage(await mApi.get('/stock/balances', { params: { page: next, pageSize: MOBILE_PAGE_SIZE } }));
    balances.value = [...balances.value, ...res.items];
    balancesTotal.value = res.total;
    balancesPage.value = next;
  } finally {
    loadingMore.value.balances = false;
  }
}

async function loadMoreTargets() {
  if (loadingMore.value.targets || crmTargets.value.length >= crmTargetsTotal.value) return;
  loadingMore.value.targets = true;
  try {
    const next = crmTargetsPage.value + 1;
    const res = unpackPage(await mApi.get('/crm/targets', { params: { page: next, pageSize: MOBILE_PAGE_SIZE } }));
    crmTargets.value = [...crmTargets.value, ...res.items];
    crmTargetsTotal.value = res.total;
    crmTargetsPage.value = next;
  } finally {
    loadingMore.value.targets = false;
  }
}

async function loadMoreCustomers() {
  if (loadingMore.value.customers || allCustomers.value.length >= customersTotal.value) return;
  loadingMore.value.customers = true;
  try {
    const next = customersPage.value + 1;
    const res = unpackPage(await mApi.get('/crm/customers', { params: { page: next, pageSize: MOBILE_PAGE_SIZE } }));
    allCustomers.value = [...allCustomers.value, ...res.items];
    customersTotal.value = res.total;
    customersPage.value = next;
  } finally {
    loadingMore.value.customers = false;
  }
}

async function loadData() {
  if (!user.value) return;
  ordersPage.value = 1;
  balancesPage.value = 1;
  crmTargetsPage.value = 1;
  customersPage.value = 1;
  const [c, w, p, b, o, cd, ct, orgs, ed, cust] = await Promise.all([
    mApi.get('/clinics').catch(() => []),
    mApi.get('/warehouses').catch(() => []),
    mApi.get('/products').catch(() => []),
    mApi.get('/stock/balances', { params: { page: 1, pageSize: MOBILE_PAGE_SIZE } }).catch(() => ({ items: [], total: 0 })),
    mApi.get('/sales-orders', { params: { page: 1, pageSize: MOBILE_PAGE_SIZE } }).catch(() => ({ items: [], total: 0 })),
    mApi.get('/crm/dashboard').catch(() => null),
    mApi.get('/crm/targets', { params: { page: 1, pageSize: MOBILE_PAGE_SIZE } }).catch(() => ({ items: [], total: 0 })),
    mApi.get('/orgs').catch(() => []),
    mApi.get('/crm/existing/dashboard').catch(() => null),
    mApi.get('/crm/customers', { params: { page: 1, pageSize: MOBILE_PAGE_SIZE } }).catch(() => ({ items: [], total: 0 })),
  ]);
  clinics.value = (c as unknown as any[]).filter((x) => x.bindStatus !== 'PUBLIC_POOL');
  warehouses.value = w as unknown as any[];
  dealers.value = (orgs as unknown as any[]).filter((x) => x.type === 'DEALER');
  products.value = p as unknown as any[];
  const bPage = unpackPage(b);
  balances.value = bPage.items;
  balancesTotal.value = bPage.total;
  const oPage = unpackPage(o);
  orders.value = oPage.items;
  ordersTotal.value = oPage.total;
  crmDash.value = cd;
  const tPage = unpackPage(ct);
  crmTargets.value = tPage.items;
  crmTargetsTotal.value = tPage.total;
  existingDash.value = ed;
  const custPage = unpackPage(cust);
  allCustomers.value = custPage.items;
  customersTotal.value = custPage.total;

  if (!visitForm.value.salesRepName && user.value?.realName) {
    visitForm.value.salesRepName = user.value.realName.replace(/（.*?）/g, '');
  }
  initOrderDefaults(isHQ.value ? 'HQ_TO_DEALER' : 'DEALER_TO_CLINIC');
}

async function submitMobileVisitTarget() {
  if (!visitForm.value.clinicName.trim()) return showToast('请填写机构名称', 'err');
  try {
    const res = (await mApi.post('/crm/targets', visitForm.value)) as any;
    visitForm.value.clinicName = '';
    activeSheet.value = null;
    tab.value = 'visit';
    visitSub.value = 'new';
    await loadData();
    showToast(`已保存「${res.clinicName}」· ${res.totalScore} 分（${res.storeGrade || res.validationText}）`, 'ok');
  } catch (err: any) {
    showToast(err.response?.data?.message || '保存失败', 'err');
  }
}

async function submitMobileFollowUp() {
  if (!followForm.value.customerName.trim()) return showToast('请输入或选择客户名称', 'err');
  try {
    await mApi.post('/crm/followups', {
      ...followForm.value,
      visitScene: 'NEW_PROSPECT',
      salesRepName: visitForm.value.salesRepName || user.value?.realName?.replace(/（.*?）/g, ''),
    });
    const name = followForm.value.customerName;
    followForm.value.visitSummary = '';
    followForm.value.customerNeed = '';
    activeSheet.value = null;
    tab.value = 'visit';
    visitSub.value = 'new';
    await loadData();
    showToast(`已记录「${name}」新客拜访跟进`, 'ok');
  } catch (err: any) {
    showToast(err.response?.data?.message || '提交失败', 'err');
  }
}

async function submitMobileExistingVisit() {
  if (!existingVisitForm.value.clinicId) return showToast('请选择合作老客门店', 'err');
  const client = existingClients.value.find((c) => c.id === existingVisitForm.value.clinicId);
  try {
    await mApi.post('/crm/existing/visits', {
      clinicId: existingVisitForm.value.clinicId,
      customerName: client?.name || activeCustomer.value?.clinic?.name || undefined,
      visitType: existingVisitForm.value.visitType,
      stockRemainBoxes:
        existingVisitForm.value.stockRemainBoxes === null ||
        existingVisitForm.value.stockRemainBoxes === ('' as any)
          ? null
          : Number(existingVisitForm.value.stockRemainBoxes),
      repurchaseIntent: existingVisitForm.value.repurchaseIntent,
      visitSummary: existingVisitForm.value.visitSummary,
      customerNeed: existingVisitForm.value.customerNeed,
      salesRepName: visitForm.value.salesRepName || user.value?.realName?.replace(/（.*?）/g, ''),
    });
    existingVisitForm.value.visitSummary = '';
    existingVisitForm.value.customerNeed = '';
    existingVisitForm.value.stockRemainBoxes = null;
    await loadData();
    if (returnToCustomerDetail.value && activeCustomer.value?.clinic?.id) {
      returnToCustomerDetail.value = false;
      await openCustomerDetail(activeCustomer.value.clinic.id);
    } else {
      activeSheet.value = null;
      tab.value = 'visit';
      visitSub.value = 'existing';
    }
    showToast(`已记录「${client?.name || '老客'}」维护回访`, 'ok');
  } catch (err: any) {
    showToast(err.response?.data?.message || '保存老客回访失败', 'err');
  }
}

function openTargetCustomer(target: any) {
  if (target?.linkedClinicId) {
    openCustomerDetail(target.linkedClinicId);
    return;
  }
  const match = allCustomers.value.find(
    (c) => String(c.name || '').trim().toLowerCase() === String(target?.clinicName || '').trim().toLowerCase(),
  );
  if (match) {
    openCustomerDetail(match.id);
  } else {
    showToast('暂未匹配到客户主档，请刷新重试', 'err');
  }
}

async function openCustomerDetail(id: string) {
  toastMsg.value = '';
  showHistorySnapshot.value = false;
  activeSheet.value = 'customerDetail';
  customerDetailLoading.value = true;
  try {
    activeCustomer.value = (await mApi.get(`/crm/customers/${id}`)) as any;
  } catch (err: any) {
    activeCustomer.value = null;
    showToast(err.response?.data?.message || '读取客户档案失败', 'err');
  } finally {
    customerDetailLoading.value = false;
  }
}

function openCustomerEdit() {
  if (!activeCustomer.value?.clinic) return;
  const c = activeCustomer.value.clinic;
  customerEditForm.value = {
    name: c.name || '',
    city: c.city || '',
    address: c.address || '',
    contactName: c.contactName || '',
    contactRole: c.contactRole || '',
    contactPhone: c.contactPhone || '',
    wechatId: c.wechatId || '',
    salesRepName: c.salesRepName || '',
    leadSource: c.leadSource || '',
    remark: c.remark || '',
    storeType: c.storeType || '',
    trafficPrice: c.trafficPrice || '',
    storeArea: c.storeArea || '',
    beauticianCount: c.beauticianCount || '',
    storeScale: c.storeScale || '',
  };
  activeSheet.value = 'customerEdit';
}

async function saveCustomerEdit() {
  if (!activeCustomer.value?.clinic?.id) return;
  if (!customerEditForm.value.name.trim()) return showToast('机构名称不能为空', 'err');
  if (!customerEditForm.value.city.trim()) return showToast('城市/区域不能为空', 'err');
  customerEditSaving.value = true;
  try {
    const res = (await mApi.patch(
      `/crm/customers/${activeCustomer.value.clinic.id}`,
      customerEditForm.value,
    )) as any;
    activeCustomer.value = res;
    activeSheet.value = 'customerDetail';
    await loadData();
    showToast('客户档案已更新并自动记录修改留痕', 'ok');
  } catch (err: any) {
    showToast(err.response?.data?.message || '保存失败', 'err');
  } finally {
    customerEditSaving.value = false;
  }
}

async function markActiveCustomerExisting() {
  if (!activeCustomer.value?.clinic?.id) return;
  try {
    const res = (await mApi.post(`/crm/customers/${activeCustomer.value.clinic.id}/mark-existing`, {
      remark: 'App 端手动标为合作老客',
    })) as any;
    activeCustomer.value = res;
    await loadData();
    showToast('已转为合作老客，原五维评分已归档折叠，进入老客维护池', 'ok');
  } catch (err: any) {
    showToast(err.response?.data?.message || '转老客失败', 'err');
  }
}

function openExistingVisitFor(clinicId: string) {
  existingVisitForm.value.clinicId = clinicId;
  returnToCustomerDetail.value = true;
  activeSheet.value = 'existingVisit';
}

function stageLabel(stage?: string) {
  if (stage === 'EXISTING_ACTIVE') return '活跃老客';
  if (stage === 'EXISTING_DORMANT') return '沉睡预警';
  return '新客开发';
}

function stageBadgeClass(stage?: string) {
  if (stage === 'EXISTING_ACTIVE') return 'ok';
  if (stage === 'EXISTING_DORMANT') return 'bad';
  return 'info';
}

function healthBadgeClass(grade?: string | null) {
  if (grade === '健康活跃') return 'ok';
  if (grade === '沉睡预警') return 'bad';
  return '';
}

function formatShortDate(d?: string | null) {
  if (!d) return '—';
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

async function submitMobileOrder() {
  const prod = products.value.find((p) => p.id === orderForm.value.productId);
  if (!prod) return showToast('请选择供货商品', 'err');
  if (!orderForm.value.warehouseId) return showToast('请选择出库仓库', 'err');
  if (orderForm.value.orderScene === 'HQ_TO_DEALER') {
    if (!orderForm.value.buyerOrgId) return showToast('请选择目标服务商', 'err');
    const targetDealer = dealers.value.find((d) => d.id === orderForm.value.buyerOrgId);
    if (targetDealer?.supplyFrozen) {
      return showToast(`服务商【${targetDealer.name}】处于停供冻结状态，无法开单`, 'err');
    }
  } else if (!orderForm.value.clinicId) {
    return showToast('请选择终端机构', 'err');
  }
  try {
    const payload: Record<string, any> = {
      orderScene: orderForm.value.orderScene,
      warehouseId: orderForm.value.warehouseId,
      requestSpecialApproval: belowRedline.value,
      remark: orderForm.value.remark || 'App 端提交',
      items: [
        {
          productId: prod.id,
          qty: orderForm.value.qty,
          unitPrice: Number(prod.retailPrice),
          discountPercent: orderForm.value.discountPercent,
        },
      ],
    };
    if (orderForm.value.orderScene === 'HQ_TO_DEALER') {
      payload.buyerOrgId = orderForm.value.buyerOrgId;
    } else {
      payload.clinicId = orderForm.value.clinicId;
    }
    const res = (await mApi.post('/sales-orders', payload)) as any;
    orderForm.value.remark = '';
    activeSheet.value = null;
    tab.value = 'orders';
    await loadData();
    if (res.order?.status === 'PENDING_APPROVAL') {
      showToast(`已提交总部特批（${res.order.docNo}），审批通过后可扫码出库`, 'ok');
    } else {
      showToast(`供货单已创建（${res.order.docNo}），可立即扫码出库`, 'ok');
    }
  } catch (err: any) {
    showToast(err.response?.data?.message || '下单失败，请核对价格与权限', 'err');
  }
}

async function approveMobileOrder(order: any) {
  try {
    await mApi.post(`/sales-orders/${order.id}/special-approve`, { approve: true });
    await loadData();
    showToast(`已特批放行（${order.docNo}），仓库可立即扫码出库`, 'ok');
  } catch (err: any) {
    showToast(err.response?.data?.message || '特批放行失败', 'err');
  }
}

async function submitMobileReport() {
  if (!reportForm.value.name.trim()) return showToast('请输入机构名称', 'err');
  try {
    const res = (await mApi.post('/clinics/report', reportForm.value)) as any;
    reportForm.value.name = '';
    activeSheet.value = null;
    await loadData();
    showToast(`${res.message}（${formatDateTime(res.serverTimestamp, true)}）`, 'ok');
  } catch (err: any) {
    showToast(err.response?.data?.message || '报备冲突', 'err');
  }
}

function statusLabel(s: string) {
  const m: Record<string, string> = {
    DRAFT: '草稿',
    PENDING_APPROVAL: '待特批',
    PENDING_OUTBOUND: '待出库',
    PARTIAL_OUTBOUND: '部分出库',
    COMPLETED: '已出库',
    CANCELLED: '已撤销',
  };
  return m[s] || s;
}

function statusClass(s: string) {
  if (s === 'COMPLETED') return 'done';
  if (s === 'PENDING_APPROVAL') return 'bad';
  return 'open';
}

onMounted(() => {
  if (isAppRuntime.value) {
    loadPublicRegisterOptions();
    loadData();
  }
});

onUnmounted(() => {
  if (smsTimer) clearInterval(smsTimer);
});
</script>

<style scoped>
/* 浏览器访问 /m/workbench 时的极简 App 下载引导 */
.app-gate {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 36px 28px;
  text-align: center;
}
.gate-mark {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: #111827;
  color: #ffffff;
  display: grid;
  place-items: center;
}
.gate-mark svg {
  width: 24px;
  height: 24px;
}
.gate-brand {
  margin-top: 12px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--m-muted);
}
.gate-title {
  margin: 18px 0 8px;
  font-size: 20px;
  font-weight: 600;
  color: var(--m-ink);
}
.gate-desc {
  margin: 0 0 28px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--m-muted);
  max-width: 300px;
}
.gate-btn {
  text-decoration: none;
  max-width: 280px;
}
.gate-verify-link {
  margin-top: 18px;
  font-size: 13px;
  color: var(--m-sub);
  text-decoration: none;
}

/* 固定顶栏 */
.wb-header {
  flex-shrink: 0;
  z-index: 20;
  background: #ffffff;
  border-bottom: 1px solid var(--m-line);
  padding: calc(10px + env(safe-area-inset-top)) 16px 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.wb-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.wb-mark {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: #111827;
  color: #ffffff;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.wb-mark svg {
  width: 16px;
  height: 16px;
}
.wb-brand-copy {
  min-width: 0;
}
.wb-word {
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--m-ink);
  line-height: 1.15;
}
.wb-caption {
  font-size: 11px;
  color: var(--m-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 170px;
}
.wb-head-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.hdr-user {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--m-ink);
}
.hdr-text-btn {
  border: 0;
  background: transparent;
  min-height: 36px;
  min-width: 40px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  font-size: 13px;
  color: var(--m-muted);
  text-decoration: none;
  cursor: pointer;
}
.hdr-btn {
  border: 1px solid var(--m-line-strong);
  background: #ffffff;
  color: var(--m-ink);
  border-radius: 6px;
  min-height: 36px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
}

/* 独立滚动内容区 */
.wb-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 16px 16px 24px;
}

/* 极简纯白登录页 */
.login-scroll {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 20px 22px 28px;
}
.login-wrap {
  width: 100%;
}
.login-heading {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 600;
  color: var(--m-ink);
}
.login-sub {
  margin: 0 0 22px;
  font-size: 13px;
  color: var(--m-muted);
}
.auth-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-bottom: 1px solid var(--m-line);
  margin-bottom: 20px;
}
.auth-tabs button {
  border: 0;
  background: transparent;
  padding: 9px 4px 10px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--m-muted);
  cursor: pointer;
  font-family: inherit;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.auth-tabs button.on {
  color: #111827;
  font-weight: 600;
  border-bottom-color: #111827;
}
.m-sms-row {
  display: flex;
  gap: 8px;
}
.m-sms-row .m-input {
  flex: 1;
  min-width: 0;
}
.m-sms-btn {
  flex-shrink: 0;
  min-width: 100px;
  min-height: 42px;
  border: 1px solid var(--m-line-strong);
  background: #ffffff;
  color: var(--m-ink);
  border-radius: 6px;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.m-sms-btn:disabled {
  color: var(--m-muted);
  cursor: not-allowed;
}
.m-sms-tip {
  margin: 12px 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--m-muted);
}
.pair-banner {
  margin-bottom: 22px;
  padding: 14px;
  border-radius: 10px;
  border: 1px solid var(--m-line);
  background: var(--m-surface-2);
}
.pb-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--m-ink);
}
.pb-desc {
  margin: 4px 0 12px;
  font-size: 12.5px;
  color: var(--m-muted);
}

/* 提示条 */
.toast-bar {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 500;
  margin-bottom: 14px;
  line-height: 1.5;
}
.toast-bar.ok {
  background: var(--m-success-soft);
  color: var(--m-success);
  border: 1px solid var(--m-success-line);
}
.toast-bar.err {
  background: var(--m-seal-soft);
  color: var(--m-seal);
  border: 1px solid var(--m-seal-line);
}

/* 首页 Hub：指标带 */
.hub-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: #ffffff;
  border-radius: 10px;
  border: 1px solid var(--m-line);
  padding: 14px 4px;
}
.hm-cell {
  border: 0;
  border-left: 1px solid var(--m-line);
  background: transparent;
  padding: 2px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  font-family: inherit;
}
.hm-cell:first-child {
  border-left: 0;
}
.hm-label {
  font-size: 11.5px;
  color: var(--m-muted);
}
.hm-val {
  font-size: 22px;
  font-weight: 600;
  color: var(--m-ink);
  line-height: 1.1;
}
.hm-val.warn {
  color: var(--m-warn);
}

/* 首页分区 */
.hub-section {
  margin-top: 20px;
}
.hub-sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
  padding: 0 2px;
}
.hub-sec-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--m-sub);
}
.hub-sec-meta {
  font-size: 12px;
  color: var(--m-muted);
}
.hub-more {
  border: 0;
  background: transparent;
  min-height: 36px;
  padding: 0 8px;
  margin: -6px -8px -6px 0;
  display: inline-flex;
  align-items: center;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--m-sub);
  cursor: pointer;
}

/* 2x2 快捷作业瓷砖 */
.action-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.act-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 14px;
  background: #ffffff;
  border: 1px solid var(--m-line);
  border-radius: 10px;
  text-decoration: none;
  color: var(--m-ink);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.act-tile:active {
  background: var(--m-surface-2);
}
.act-tile svg {
  width: 20px;
  height: 20px;
  color: var(--m-ink);
  margin-bottom: 10px;
}
.act-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--m-ink);
}
.act-sub {
  font-size: 11.5px;
  color: var(--m-muted);
  margin-top: 3px;
}

/* 去框套框分组列表 */
.group-list {
  background: #ffffff;
  border: 1px solid var(--m-line);
  border-radius: 10px;
  overflow: hidden;
}
.gl-row {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--m-line);
  background: transparent;
  padding: 13px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
}
.gl-row.static {
  cursor: default;
}
.gl-row:last-child {
  border-bottom: 0;
}
.gl-main {
  min-width: 0;
  flex: 1;
}
.gl-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--m-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gl-sub {
  font-size: 11.5px;
  color: var(--m-muted);
  margin-top: 3px;
}
.gl-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}
.gl-amt {
  font-size: 14px;
  font-weight: 600;
  color: var(--m-ink);
}

/* 拜访页 */
.visit-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #ffffff;
  border: 1px solid var(--m-line);
  border-radius: 10px;
  padding: 15px 16px;
}
.vs-score {
  text-align: right;
}
.vs-label {
  font-size: 11.5px;
  color: var(--m-muted);
}
.vs-val {
  font-size: 20px;
  font-weight: 600;
  color: var(--m-ink);
  margin-top: 4px;
}
.vs-val span {
  font-size: 12px;
  font-weight: 400;
  color: var(--m-muted);
  margin-left: 2px;
}
.visit-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 12px;
}

/* 库存与订单 */
.stock-qty {
  display: flex;
  align-items: baseline;
  gap: 3px;
  flex-shrink: 0;
}
.stock-qty .num {
  font-size: 18px;
  font-weight: 600;
  color: var(--m-ink);
}
.stock-unit {
  font-size: 11px;
  color: var(--m-muted);
}

.order-row {
  padding: 13px 14px;
  border-bottom: 1px solid var(--m-line);
  cursor: pointer;
}
.order-row:last-child {
  border-bottom: 0;
}
.order-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.order-doc {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--m-ink);
}
.order-status {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 4px;
  border: 1px solid transparent;
}
.order-status.open {
  background: var(--m-gold-soft);
  border-color: var(--m-gold-line);
  color: var(--m-gold);
}
.order-status.done {
  background: var(--m-success-soft);
  border-color: var(--m-success-line);
  color: var(--m-success);
}
.order-status.bad {
  background: var(--m-seal-soft);
  border-color: var(--m-seal-line);
  color: var(--m-seal);
}
.order-mid {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--m-ink);
  margin-top: 5px;
}
.order-scene-tag {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  color: var(--m-sub);
  background: var(--m-surface-2);
  border: 1px solid var(--m-line);
  border-radius: 5px;
  padding: 2px 6px;
}
.order-bot {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: 4px;
}
.order-amount {
  font-size: 14.5px;
  font-weight: 600;
}
.order-actions {
  margin-top: 10px;
  display: grid;
  grid-template-columns: 1fr 1.25fr;
  gap: 8px;
}
.order-actions.single {
  grid-template-columns: 1fr;
}
.scene-seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 3px;
  background: var(--m-surface-3, #f3f4f6);
  border-radius: 8px;
  margin-bottom: 14px;
}
.scene-seg button {
  border: 0;
  background: transparent;
  padding: 8px 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--m-sub);
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
}
.scene-seg button.on {
  background: #ffffff;
  color: #111827;
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--m-line);
}
.order-act-btn {
  min-height: 38px;
  padding: 8px 10px;
  font-size: 13px;
}
.muted {
  font-size: 11.5px;
  color: var(--m-muted);
}
.m-empty {
  padding: 28px 12px;
  text-align: center;
  font-size: 12.5px;
  color: var(--m-muted);
}

.order-codes-box {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--m-surface-2);
  border: 1px solid var(--m-line);
}
.oc-summary {
  font-size: 11.5px;
  color: var(--m-sub);
  margin-bottom: 8px;
}
.oc-empty {
  font-size: 12px;
  color: var(--m-muted);
  text-align: center;
  padding: 6px 0;
}
.oc-item {
  padding: 8px 0;
  border-top: 1px solid var(--m-line);
}
.oc-item:first-of-type {
  border-top: 0;
  padding-top: 2px;
}
.oc-item-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.oc-token {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--m-ink);
  word-break: break-all;
}
.oc-item-bot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.oc-prod {
  font-size: 11.5px;
  color: var(--m-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.oc-links {
  display: inline-flex;
  gap: 10px;
  flex-shrink: 0;
}
.oc-link {
  border: 1px solid var(--m-line);
  background: #ffffff;
  border-radius: 6px;
  min-height: 36px;
  min-width: 48px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--m-sub);
  text-decoration: none;
  cursor: pointer;
  font-family: inherit;
}
.oc-link.primary {
  color: var(--m-ink);
  font-weight: 600;
}

/* 二级独立表单页 */
.sheet-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: #ffffff;
  display: flex;
  flex-direction: column;
}
.sheet-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(11px + env(safe-area-inset-top)) 16px 11px;
  border-bottom: 1px solid var(--m-line);
}
.sheet-back {
  border: 0;
  background: transparent;
  min-height: 36px;
  padding: 0 8px 0 0;
  display: inline-flex;
  align-items: center;
  font-family: inherit;
  font-size: 13.5px;
  color: var(--m-ink);
  cursor: pointer;
  min-width: 64px;
  text-align: left;
}
.sheet-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--m-ink);
}
.sheet-spacer {
  min-width: 56px;
}
.sheet-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 18px 18px calc(24px + env(safe-area-inset-bottom));
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.quote {
  background: var(--m-surface-2);
  border: 1px solid var(--m-line);
  border-radius: 8px;
  padding: 12px 14px;
}
.quote.blocked {
  background: var(--m-seal-soft);
  border-color: var(--m-seal-line);
}
.quote-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 13px;
  color: var(--m-sub);
  padding: 2px 0;
}
.quote-total {
  font-size: 19px;
  color: var(--m-ink);
  font-weight: 600;
}
.quote-note {
  font-size: 11.5px;
  color: var(--m-muted);
  margin-top: 8px;
  border-top: 1px solid var(--m-line);
  padding-top: 7px;
}
.quote.blocked .quote-note {
  color: var(--m-seal);
  border-top-color: var(--m-seal-line);
}
.score-live {
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid var(--m-line);
  background: var(--m-surface-2);
  margin-bottom: 14px;
}
.score-live.ok {
  background: var(--m-success-soft);
  border-color: var(--m-success-line);
}
.sl-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.sl-num {
  font-size: 18px;
  font-weight: 600;
  color: var(--m-ink);
}
.sl-grade {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--m-ink);
}
.sl-advice {
  font-size: 12px;
  color: var(--m-sub);
  margin-top: 4px;
  line-height: 1.5;
}

/* v1.3.0 新老客独立分流 & 客户 360° 档案样式 */
.hm-sep {
  margin: 0 2px;
  font-size: 14px;
  font-weight: 400;
  color: var(--m-muted);
}
.crm-seg {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 3px;
  background: var(--m-surface-3, #f3f4f6);
  border-radius: 9px;
  margin-bottom: 12px;
}
.crm-seg button {
  border: 0;
  background: transparent;
  padding: 8px 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--m-sub);
  border-radius: 7px;
  cursor: pointer;
  font-family: inherit;
}
.crm-seg button.on {
  background: #ffffff;
  color: #111827;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.08);
}
.existing-kpi-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  background: var(--m-surface-2);
  border: 1px solid var(--m-line);
  font-size: 12.5px;
  color: var(--m-sub);
}
.existing-kpi-strip strong {
  color: var(--m-ink);
  font-weight: 600;
}
.crm-search-bar {
  margin-bottom: 10px;
}
.stage-pills {
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  gap: 6px;
  padding-bottom: 2px;
}
.stage-pills::-webkit-scrollbar {
  display: none;
}
.stage-pills button {
  border: 1px solid var(--m-line);
  background: #ffffff;
  color: var(--m-sub);
  border-radius: 999px;
  min-height: 36px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.m-pager-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 4px 2px;
}
.m-pager-info {
  font-size: 12px;
  color: var(--m-muted);
}
.m-load-more {
  border: 1px solid var(--m-line-strong);
  background: #ffffff;
  color: var(--m-ink);
  border-radius: 6px;
  min-height: 36px;
  padding: 0 14px;
  font-size: 12.5px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
}
.m-load-more:disabled {
  opacity: 0.55;
}
.stage-pills button.on {
  background: #111827;
  border-color: #111827;
  color: #ffffff;
}
.gl-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.c-badge {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--m-surface-2);
  color: var(--m-sub);
  border: 1px solid var(--m-line);
}
.c-badge.ok {
  background: var(--m-success-soft);
  color: var(--m-success);
  border-color: var(--m-success-line);
}
.c-badge.bad {
  background: var(--m-seal-soft);
  color: var(--m-seal);
  border-color: var(--m-seal-line);
}
.c-badge.info {
  background: #f3f4f6;
  color: #111827;
  border-color: #e5e7eb;
}
.c-hero {
  background: var(--m-surface-2);
  border: 1px solid var(--m-line);
  border-radius: 10px;
  padding: 14px;
}
.c-hero-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.c-hero-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--m-ink);
  word-break: break-word;
}
.c-hero-sub {
  font-size: 12px;
  color: var(--m-muted);
  margin-top: 4px;
}
.c-score-band {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--m-line);
}
.c-score-band.two {
  grid-template-columns: repeat(2, 1fr);
}
.csb-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.csb-label {
  font-size: 11px;
  color: var(--m-muted);
}
.csb-val {
  font-size: 16px;
  font-weight: 600;
  color: var(--m-ink);
}
.csb-val small {
  font-size: 11px;
  font-weight: 400;
  color: var(--m-muted);
  margin-left: 1px;
}
.c-section {
  margin-top: 16px;
}
.c-sec-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--m-sub);
  margin-bottom: 8px;
}
.c-kv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  background: #ffffff;
  border: 1px solid var(--m-line);
  border-radius: 10px;
  padding: 12px;
}
.c-kv {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.c-kv.full {
  grid-column: 1 / -1;
}
.c-kv span {
  font-size: 11px;
  color: var(--m-muted);
}
.c-kv strong {
  font-size: 13px;
  font-weight: 500;
  color: var(--m-ink);
  word-break: break-word;
}
.c-dim-list {
  background: #ffffff;
  border: 1px solid var(--m-line);
  border-radius: 10px;
  overflow: hidden;
}
.c-dim-row {
  display: grid;
  grid-template-columns: 74px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--m-line);
  font-size: 12.5px;
  color: var(--m-sub);
}
.c-dim-row:last-child {
  border-bottom: 0;
}
.c-dim-row strong {
  color: var(--m-ink);
}
.c-log-card {
  background: #ffffff;
  border: 1px solid var(--m-line);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
}
.c-log-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--m-muted);
}
.c-log-text {
  margin-top: 5px;
  font-size: 13px;
  color: var(--m-ink);
  line-height: 1.5;
}
.c-log-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--m-muted);
}
.c-empty-box {
  background: var(--m-surface-2);
  border: 1px dashed var(--m-line-strong);
  border-radius: 8px;
  padding: 14px 12px;
  text-align: center;
  font-size: 12px;
  color: var(--m-muted);
}
.c-collapse-btn {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 11px 12px;
  border-radius: 8px;
  border: 1px solid var(--m-line);
  background: var(--m-surface-2);
  color: var(--m-sub);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.c-audit-row {
  padding: 8px 0;
  border-bottom: 1px solid var(--m-line);
}
.c-audit-row:last-child {
  border-bottom: 0;
}
.c-audit-sum {
  font-size: 12.5px;
  color: var(--m-ink);
}
.c-audit-meta {
  font-size: 11px;
  color: var(--m-muted);
  margin-top: 2px;
}
</style>
