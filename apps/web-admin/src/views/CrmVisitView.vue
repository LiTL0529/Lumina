<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">新客开发看板</h1>
        <p class="page-subtitle">面向未消费新客 · 五维 100 分评分与 20 分纳新业绩（首单通过自动转老客并归档）</p>
      </div>
      <div class="page-actions">
        <el-button @click="router.push('/crm-existing')">切换老客维护 →</el-button>
        <el-button @click="sopDrawer = true">评分标准 SOP</el-button>
        <el-button @click="openFollowUpModal()">记录新客跟进</el-button>
        <el-button type="primary" @click="openTargetModal()">新增目标门店</el-button>
      </div>
    </div>

    <!-- 全局维度筛选栏（按代理商 / 业务员 / 月份联动所有子表） -->
    <div class="surface-card scope-bar">
      <div class="scope-fields">
        <el-select
          v-if="auth.isHQ"
          v-model="scope.orgId"
          clearable
          placeholder="全部代理商（服务商）"
          class="sc-select"
          @change="reloadScope"
        >
          <el-option v-for="d in meta.dealers" :key="d.id" :label="d.name" :value="d.id" />
        </el-select>
        <el-select
          v-model="scope.salesRepName"
          clearable
          filterable
          placeholder="全部业务员"
          class="sc-select-sm"
          @change="reloadScope"
        >
          <el-option v-for="rep in meta.salesReps" :key="rep" :label="rep" :value="rep" />
        </el-select>
        <el-select
          v-model="scope.planMonth"
          clearable
          placeholder="全部月份"
          class="sc-select-sm"
          @change="reloadScope"
        >
          <el-option v-for="m in meta.months" :key="m" :label="m" :value="m" />
        </el-select>
      </div>
      <div class="scope-actions">
        <el-button size="small" @click="reloadScope">刷新汇总</el-button>
        <el-button size="small" plain @click="exportPlanCsv">导出拜访表 CSV</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="plain-tabs">
      <!-- ==================== 1. 月拜访统计看板 ==================== -->
      <el-tab-pane label="月拜访统计看板" name="dashboard">
        <template v-if="dashboard">
          <div class="kpi-grid">
            <div class="kpi-cell accent">
              <div class="kpi-label">已拜访完成 / 目标</div>
              <div class="kpi-value">
                {{ dashboard.kpis.completedCount }}
                <span class="unit">/ {{ dashboard.kpis.targetQuota }} 家</span>
              </div>
              <div class="kpi-meta">
                完成率 {{ (dashboard.kpis.completionRate * 100).toFixed(1) }}% · 计划收录 {{ dashboard.kpis.plannedCount }} 家
              </div>
            </div>
            <div class="kpi-cell accent">
              <div class="kpi-label">新机构拓展本月得分</div>
              <div class="kpi-value">
                {{ dashboard.kpis.performanceScore.toFixed(2) }}
                <span class="unit">/ 20 分</span>
              </div>
              <div class="kpi-meta">实际 ÷ 目标 × 100% × 20 分权重</div>
            </div>
            <div class="kpi-cell">
              <div class="kpi-label">已覆盖城市 / 区域</div>
              <div class="kpi-value">
                {{ dashboard.kpis.coveredRegionsCount }}
                <span class="unit">个</span>
              </div>
              <div class="kpi-meta">统计口径：「✓ 已拜访完成」去重区域数</div>
            </div>
            <div class="kpi-cell">
              <div class="kpi-label">跟进次数 / 已成交</div>
              <div class="kpi-value">
                {{ dashboard.kpis.followUpsCount }}
                <span class="unit">次 · {{ dashboard.kpis.dealsCount }} 成交</span>
              </div>
              <div class="kpi-meta">与手机端外勤拜访实时同步</div>
            </div>
          </div>

          <!-- 三、业绩 · 新机构拓展（按代理商-业务员汇总） -->
          <section class="surface-card">
            <div class="section-header">
              <div>
                <h2 class="section-title">业绩 · 新机构拓展（本月 20 分权重核算）</h2>
                <span class="section-note">按不同地区代理商及每位业务员自动汇总，点击目标家数可调整当月指标</span>
              </div>
            </div>
            <div v-if="!isMobile" class="table-wrap">
              <el-table :data="dashboard.repLeaderboard" size="small" style="width: 100%" empty-text="当前筛选下暂无业务员记录">
                <el-table-column label="代理商（服务商）" min-width="150">
                  <template #default="{ row }"><span class="cell-strong">{{ row.orgName }}</span></template>
                </el-table-column>
                <el-table-column prop="salesRepName" label="业务员" width="84" />
                <el-table-column label="目标家数" width="90" align="right">
                  <template #default="{ row }">
                    <button type="button" class="goal-link mono" title="点击修改月度目标" @click="openGoalEdit(row)">
                      {{ row.targetQuota }} 家
                    </button>
                  </template>
                </el-table-column>
                <el-table-column label="已拜访完成" width="102" align="right">
                  <template #default="{ row }"><strong class="mono">{{ row.completed }}</strong></template>
                </el-table-column>
                <el-table-column label="优秀门店" width="90" align="right">
                  <template #default="{ row }"><span class="mono ok-text">{{ row.excellent }}</span></template>
                </el-table-column>
                <el-table-column label="已成交" width="76" align="right">
                  <template #default="{ row }"><span class="mono">{{ row.deals }}</span></template>
                </el-table-column>
                <el-table-column label="完成率" width="80" align="right">
                  <template #default="{ row }"><span class="mono">{{ (row.completionRate * 100).toFixed(1) }}%</span></template>
                </el-table-column>
                <el-table-column label="本月得分(20)" width="114" align="right">
                  <template #default="{ row }">
                    <span class="score-badge num">{{ row.performanceScore.toFixed(2) }} 分</span>
                  </template>
                </el-table-column>
                <el-table-column prop="formulaNote" label="计分口径" min-width="145" show-overflow-tooltip />
              </el-table>
            </div>
            <div v-else class="mobile-list">
              <div v-if="!dashboard.repLeaderboard.length" class="empty-line">当前筛选下暂无业务员记录</div>
              <article v-for="row in dashboard.repLeaderboard" :key="`${row.orgId}-${row.salesRepName}`" class="m-rep-card">
                <div class="mcc-top">
                  <div>
                    <div class="cell-strong">{{ row.salesRepName }}</div>
                    <div class="cell-sub">{{ row.orgName }}</div>
                  </div>
                  <span class="score-badge num">{{ row.performanceScore.toFixed(2) }} 分</span>
                </div>
                <div class="m-rep-stats">
                  <span>完成 <strong>{{ row.completed }}</strong> / <button type="button" class="goal-link mono" @click="openGoalEdit(row)">{{ row.targetQuota }} 家</button></span>
                  <span>完成率 {{ (row.completionRate * 100).toFixed(1) }}%</span>
                  <span>优秀 {{ row.excellent }} · 成交 {{ row.deals }}</span>
                </div>
              </article>
            </div>
          </section>

          <div class="dash-two-col">
            <!-- 一、各城市/区域分布 -->
            <section class="surface-card">
              <div class="section-header">
                <div>
                  <h2 class="section-title">一、各城市 / 区域已拜访家数与等级分布</h2>
                  <span class="section-note">计划家数 = 区域占位记录数；已拜访 = 7 项必填完整</span>
                </div>
              </div>
              <div class="table-wrap">
                <el-table
                  :data="regionRowsWithTotal"
                  size="small"
                  style="width: 100%"
                  :row-class-name="({ row }: any) => (row.isTotal ? 'total-row' : '')"
                >
                  <el-table-column prop="cityRegion" label="城市 / 区域" min-width="120" />
                  <el-table-column prop="plannedCount" label="计划" width="58" align="right" />
                  <el-table-column prop="completedCount" label="已拜访" width="66" align="right" />
                  <el-table-column prop="excellentCount" label="优秀" width="56" align="right" />
                  <el-table-column prop="precisionCount" label="精准" width="56" align="right" />
                  <el-table-column prop="validCount" label="有效" width="56" align="right" />
                  <el-table-column prop="mismatchCount" label="暂不匹配" width="76" align="right" />
                </el-table>
              </div>
            </section>

            <!-- 二、门店等级分布 -->
            <section class="surface-card">
              <div class="section-header">
                <div>
                  <h2 class="section-title">二、门店等级分布（已拜访完成）</h2>
                  <span class="section-note">按 100 分制自动归档并输出跟进动作</span>
                </div>
              </div>
              <div class="grade-list">
                <div v-for="g in dashboard.gradeStats" :key="g.grade" class="grade-item">
                  <div class="gi-top">
                    <span class="grade-pill" :class="gradeClass(g.grade)">{{ g.grade }}</span>
                    <span class="gi-range mono">{{ g.rangeLabel }}</span>
                    <span class="gi-count num">
                      {{ g.count }} 家 <span class="gi-pct">({{ (g.ratio * 100).toFixed(0) }}%)</span>
                    </span>
                  </div>
                  <div class="gi-bar">
                    <span :class="gradeClass(g.grade)" :style="{ width: `${Math.round(g.ratio * 100)}%` }" />
                  </div>
                  <div class="gi-advice">{{ g.actionAdvice }}</div>
                </div>
              </div>
              <div class="caliber-note">
                口径说明：①「已拜访完成」需 7 个必填项（机构名称、城市/区域及五维评分）全部填写；② 各区域、各等级与 20 分业绩均由明细实时汇总，无需手工维护公式。
              </div>
            </section>
          </div>
        </template>
      </el-tab-pane>

      <!-- ==================== 2. 月计划拜访表（五维评分） ==================== -->
      <el-tab-pane label="月计划拜访表" name="targets">
        <div class="surface-card tool-card">
          <div class="tool-left">
            <el-input
              v-model="targetFilter.keyword"
              clearable
              placeholder="搜索机构名称 / 区域 / 业务员"
              class="tf-input"
              @keyup.enter="loadTargets(1)"
            />
            <el-select v-model="targetFilter.grade" clearable placeholder="全部门店等级" class="tf-select" @change="loadTargets(1)">
              <el-option v-for="r in meta.gradeRules" :key="r.grade" :label="`${r.grade}（${r.rangeLabel}）`" :value="r.grade" />
            </el-select>
            <el-checkbox v-model="targetFilter.onlyCompleted" @change="loadTargets(1)">仅看已拜访完成</el-checkbox>
            <el-checkbox v-model="targetFilter.includeConverted" @change="loadTargets(1)">显示已转老客历史</el-checkbox>
          </div>
          <div class="tool-right">
            <el-button size="small" @click="importDialog = true">批量粘贴导入</el-button>
            <el-button size="small" type="primary" @click="openTargetModal()">+ 新增目标门店</el-button>
          </div>
        </div>

        <div v-if="!isMobile" class="surface-card flush">
          <el-table :data="targets" size="small" style="width: 100%" empty-text="还没有计划拜访门店，点击右上角新增或批量导入">
            <el-table-column type="index" label="#" width="44" />
            <el-table-column label="机构名称 / 区域" min-width="136" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="cell-strong">{{ row.clinicName }}</div>
                <div class="cell-sub">{{ row.cityRegion || '未填区域' }} · {{ row.leadSource || '未填来源' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="代理商 / 业务员" min-width="116" show-overflow-tooltip>
              <template #default="{ row }">
                <div>{{ row.salesRepName }} <span class="mono cell-sub">{{ row.planMonth }}</span></div>
                <div class="cell-sub">{{ row.orgName }}</div>
              </template>
            </el-table-column>
            <el-table-column label="五维评分（类/价/面/人/规）" min-width="162">
              <template #default="{ row }">
                <div class="dim-summary">
                  <span class="dim-chip" :title="row.storeType">{{ row.storeTypeScore }}</span>
                  <span class="dim-chip" :title="row.trafficPrice">{{ row.trafficPriceScore }}</span>
                  <span class="dim-chip" :title="row.storeArea">{{ row.storeAreaScore }}</span>
                  <span class="dim-chip" :title="row.beauticianCount">{{ row.beauticianScore }}</span>
                  <span class="dim-chip" :title="row.storeScale">{{ row.storeScaleScore }}</span>
                </div>
                <div class="cell-sub dim-text">
                  {{ [row.storeType, row.storeArea, row.storeScale].filter(Boolean).join(' · ') || '待评分' }}
                </div>
              </template>
            </el-table-column>
            <el-table-column label="总分 / 等级" width="98">
              <template #default="{ row }">
                <div class="score-line">
                  <strong class="num">{{ row.totalScore }}</strong>
                  <span v-if="row.storeGrade" class="grade-pill sm" :class="gradeClass(row.storeGrade)">{{ row.storeGrade }}</span>
                </div>
                <div class="cell-sub">{{ row.followUpCount || 0 }} 次跟进</div>
              </template>
            </el-table-column>
            <el-table-column label="校验 / 建议" min-width="124" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="valid-pill" :class="row.isCompleted ? 'ok' : 'warn'">{{ row.validationText }}</div>
                <div class="cell-sub">{{ row.actionAdvice || '补齐五维后自动生成建议' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="186" align="right">
              <template #default="{ row }">
                <div class="table-actions">
                  <el-button size="small" link type="primary" @click="jumpCustomerProfile(row)">档案</el-button>
                  <el-button
                    v-if="row.linkedClinicId && row.conversionStatus !== 'CONVERTED'"
                    size="small"
                    link
                    type="success"
                    @click="markTargetExisting(row)"
                  >
                    转老客
                  </el-button>
                  <el-button size="small" link @click="openFollowUpModal(row)">跟进</el-button>
                  <el-button size="small" link @click="openTargetModal(row)">编辑</el-button>
                  <el-button size="small" link type="danger" @click="removeTarget(row)">删</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="targetTotal"
              :page-size="targetPageSize"
              :current-page="targetPage"
              @current-change="(p: number) => loadTargets(p)"
            />
          </div>
        </div>

        <div v-else class="mobile-list">
          <div v-if="!targets.length" class="surface-card empty-line">还没有计划拜访门店</div>
          <article v-for="row in targets" :key="row.id" class="surface-card m-crm-card">
            <div class="mcc-top">
              <div>
                <div class="cell-strong">{{ row.clinicName }}</div>
                <div class="cell-sub">{{ row.cityRegion || '未填区域' }} · {{ row.salesRepName }} · {{ row.planMonth }}</div>
              </div>
              <span v-if="row.storeGrade" class="grade-pill" :class="gradeClass(row.storeGrade)">
                {{ row.totalScore }}分 · {{ row.storeGrade }}
              </span>
              <span v-else class="valid-pill warn">{{ row.validationText }}</span>
            </div>
            <div class="mcc-dims">
              {{ [row.storeType, row.trafficPrice, row.storeArea, row.beauticianCount, row.storeScale].filter(Boolean).join(' / ') || '待填写五维评分' }}
            </div>
            <div v-if="row.actionAdvice" class="mcc-advice">{{ row.actionAdvice }}</div>
            <div class="mcc-actions">
              <el-button size="small" plain type="primary" @click="jumpCustomerProfile(row)">档案</el-button>
              <el-button size="small" plain @click="openFollowUpModal(row)">记跟进</el-button>
              <el-button size="small" plain @click="openTargetModal(row)">编辑</el-button>
            </div>
          </article>
        </div>
      </el-tab-pane>

      <!-- ==================== 3. 拜访跟进记录 ==================== -->
      <el-tab-pane label="拜访跟进记录" name="followups">
        <div class="surface-card tool-card">
          <div class="tool-left">
            <el-input
              v-model="followFilter.keyword"
              clearable
              placeholder="搜索客户 / 联系人 / 电话 / 需求"
              class="tf-input"
              @keyup.enter="loadFollowUps(1)"
            />
            <el-select v-model="followFilter.cityMeetingStatus" clearable placeholder="城市会参与" class="tf-select-sm" @change="loadFollowUps(1)">
              <el-option v-for="o in meta.cityMeetingOptions" :key="o" :label="o" :value="o" />
            </el-select>
            <el-select v-model="followFilter.dealStatus" clearable placeholder="是否成交" class="tf-select-sm" @change="loadFollowUps(1)">
              <el-option v-for="o in meta.dealStatusOptions" :key="o" :label="o" :value="o" />
            </el-select>
          </div>
          <div class="tool-right">
            <el-button size="small" type="primary" @click="openFollowUpModal()">+ 新增跟进记录</el-button>
          </div>
        </div>

        <div v-if="!isMobile" class="surface-card flush">
          <el-table :data="followUps" size="small" style="width: 100%" empty-text="还没有拜访跟进记录">
            <el-table-column label="客户名称 / 区域" min-width="132" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="cell-strong">{{ row.customerName }}</div>
                <div class="cell-sub">
                  <span :class="{ 'unmatched-tag': row.cityRegion === '未匹配' }">{{ row.cityRegion }}</span>
                  <span v-if="row.storeArea"> · {{ row.storeArea }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="拜访时间" width="102">
              <template #default="{ row }"><span class="mono cell-sub">{{ row.visitDate }}</span></template>
            </el-table-column>
            <el-table-column label="联系人 / 电话" min-width="126" show-overflow-tooltip>
              <template #default="{ row }">
                <div>{{ row.contactName || '—' }} <span v-if="row.contactRole" class="cell-sub">{{ row.contactRole }}</span></div>
                <div class="mono cell-sub">{{ row.contactPhone || row.wechatId || '—' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="拜访情况 & 客户需求" min-width="168" show-overflow-tooltip>
              <template #default="{ row }">
                <div>{{ row.visitSummary || '—' }}</div>
                <div v-if="row.customerNeed" class="need-line">需求：{{ row.customerNeed }}</div>
              </template>
            </el-table-column>
            <el-table-column label="城市会 / 成交" width="132">
              <template #default="{ row }">
                <div class="cell-sub">城市会：{{ row.cityMeetingStatus || '未填' }}</div>
                <div class="cell-sub">
                  成交：<span :class="row.dealStatus === '已成交' ? 'ok-text' : ''">{{ row.dealStatus || '未填' }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="110" align="right">
              <template #default="{ row }">
                <div class="table-actions">
                  <el-button size="small" link type="primary" @click="lookupCustomerByName(row.customerName)">档案</el-button>
                  <el-button size="small" link type="danger" @click="removeFollowUp(row)">删</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="followTotal"
              :page-size="followPageSize"
              :current-page="followPage"
              @current-change="(p: number) => loadFollowUps(p)"
            />
          </div>
        </div>

        <div v-else class="mobile-list">
          <div v-if="!followUps.length" class="surface-card empty-line">还没有拜访跟进记录</div>
          <article v-for="row in followUps" :key="row.id" class="surface-card m-crm-card">
            <div class="mcc-top">
              <div class="cell-strong">{{ row.customerName }}</div>
              <span class="mono cell-sub">{{ row.visitDate }}</span>
            </div>
            <div class="cell-sub">
              {{ row.cityRegion }} <span v-if="row.storeArea">· {{ row.storeArea }}</span> · {{ row.salesRepName }}
            </div>
            <div v-if="row.contactName || row.contactPhone" class="mcc-dims">
              联系人：{{ row.contactName || '—' }} {{ row.contactRole || '' }} {{ row.contactPhone || '' }}
            </div>
            <div v-if="row.visitSummary" class="mcc-advice">情况：{{ row.visitSummary }}</div>
            <div v-if="row.customerNeed" class="need-line">需求：{{ row.customerNeed }}</div>
            <div class="mcc-actions">
              <el-button size="small" plain type="primary" @click="lookupCustomerByName(row.customerName)">查看档案</el-button>
              <el-button size="small" plain type="danger" @click="removeFollowUp(row)">删除</el-button>
            </div>
          </article>
        </div>
      </el-tab-pane>

      <!-- ==================== 4. 客户档案查询（360° 聚合） ==================== -->
      <el-tab-pane label="客户档案查询" name="lookup">
        <div class="surface-card lookup-bar">
          <el-select
            v-model="selectedCustomerName"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入客户名称查询档案"
            class="lk-select"
            @change="loadCustomerProfile"
          >
            <el-option v-for="name in allCustomerNames" :key="name" :label="name" :value="name" />
          </el-select>
          <el-button type="primary" :loading="profileLoading" @click="loadCustomerProfile">查询档案</el-button>
          <el-button v-if="customerProfile" plain @click="openFollowUpModal(customerProfile.target || { clinicName: customerProfile.customerName })">
            追加本次跟进
          </el-button>
          <el-button
            v-if="customerProfile?.target"
            type="success"
            plain
            @click="promoteToClinic(customerProfile)"
          >
            一键转 90 天机构报备
          </el-button>
        </div>

        <template v-if="customerProfile">
          <section class="surface-card profile-card">
            <div class="pf-head">
              <div>
                <div class="pf-title-row">
                  <h2 class="pf-name">{{ customerProfile.customerName }}</h2>
                  <span
                    v-if="customerProfile.profile.storeGrade && customerProfile.profile.storeGrade !== '未评级'"
                    class="grade-pill"
                    :class="gradeClass(customerProfile.profile.storeGrade)"
                  >
                    {{ customerProfile.profile.storeGrade }}
                  </span>
                </div>
                <div class="cell-sub">
                  {{ customerProfile.orgName }} · 负责业务员：{{ customerProfile.profile.salesRepName }}
                </div>
              </div>
              <div class="pf-score-box">
                <div class="pf-score-label">五维总分</div>
                <div class="pf-score-val num">{{ customerProfile.profile.totalScore ?? '—' }}<span>/100</span></div>
              </div>
            </div>

            <div class="pf-advice">{{ customerProfile.profile.actionAdvice }}</div>

            <div class="pf-grid">
              <div class="pf-kv"><span>城市 / 区域</span><strong>{{ customerProfile.profile.cityRegion }}</strong></div>
              <div class="pf-kv"><span>跟进次数</span><strong class="num">{{ customerProfile.profile.followUpCount }} 次</strong></div>
              <div class="pf-kv"><span>门店类型</span><strong>{{ customerProfile.profile.storeType }}</strong></div>
              <div class="pf-kv"><span>最近拜访</span><strong class="mono">{{ customerProfile.profile.latestVisitDate }}</strong></div>
              <div class="pf-kv"><span>门店面积</span><strong>{{ customerProfile.profile.storeArea }}</strong></div>
              <div class="pf-kv"><span>是否成交</span><strong>{{ customerProfile.profile.dealStatus }}</strong></div>
              <div class="pf-kv"><span>美容师人数</span><strong>{{ customerProfile.profile.beauticianCount }}</strong></div>
              <div class="pf-kv"><span>城市会参与</span><strong>{{ customerProfile.profile.cityMeetingStatus }}</strong></div>
              <div class="pf-kv"><span>门店规模</span><strong>{{ customerProfile.profile.storeScale }}</strong></div>
              <div class="pf-kv"><span>线索来源</span><strong>{{ customerProfile.profile.leadSource }}</strong></div>
              <div class="pf-kv">
                <span>联系人</span>
                <strong>{{ customerProfile.profile.contactName }} {{ customerProfile.profile.contactRole }}</strong>
              </div>
              <div class="pf-kv"><span>联系电话</span><strong class="mono">{{ customerProfile.profile.contactPhone }}</strong></div>
            </div>
          </section>

          <section class="surface-card">
            <div class="section-header">
              <h3 class="section-title">历史跟进记录（{{ customerProfile.followUps.length }} 条）</h3>
              <span class="section-note">按跟进日期倒序排列</span>
            </div>
            <div v-if="!isMobile" class="table-wrap">
              <el-table :data="customerProfile.followUps" size="small" style="width: 100%" empty-text="该客户暂无跟进记录，点上方「追加本次跟进」录入">
                <el-table-column type="index" label="序号" width="54" />
                <el-table-column prop="visitDate" label="跟进日期" width="106" />
                <el-table-column label="联系人" width="130">
                  <template #default="{ row }">{{ row.contactName || '—' }} {{ row.contactRole || '' }}</template>
                </el-table-column>
                <el-table-column prop="visitSummary" label="拜访情况" min-width="200" />
                <el-table-column prop="customerNeed" label="客户需求" min-width="180" />
                <el-table-column prop="cityMeetingStatus" label="城市会" width="96" />
                <el-table-column prop="dealStatus" label="是否成交" width="96" />
              </el-table>
            </div>
            <div v-else class="mobile-list">
              <div v-if="!customerProfile.followUps.length" class="empty-line">该客户暂无跟进记录</div>
              <article v-for="row in customerProfile.followUps" :key="row.id" class="m-rep-card">
                <div class="mcc-top">
                  <span class="cell-strong">{{ row.contactName || '未填联系人' }} {{ row.contactRole || '' }}</span>
                  <span class="mono cell-sub">{{ row.visitDate }}</span>
                </div>
                <div v-if="row.visitSummary" class="mcc-advice">{{ row.visitSummary }}</div>
                <div v-if="row.customerNeed" class="need-line">需求：{{ row.customerNeed }}</div>
                <div class="cell-sub" style="margin-top: 4px">
                  城市会：{{ row.cityMeetingStatus || '未填' }} · 成交：{{ row.dealStatus || '未填' }}
                </div>
              </article>
            </div>
          </section>
        </template>
        <div v-else class="surface-card empty-line">在上方选择任意客户名称，即可一屏查看其五维评分、跟进次数与历史拜访记录。</div>
      </el-tab-pane>
    </el-tabs>

    <!-- ==================== 新增 / 编辑目标门店（实时 100 分评分） ==================== -->
    <el-dialog
      v-model="targetDialog"
      :title="editingTargetId ? '编辑目标门店评分' : '新增目标门店（五维自动评分）'"
      width="min(720px, 94vw)"
      align-center
      destroy-on-close
    >
      <div class="live-score-banner" :class="liveEval.isCompleted ? 'ok' : 'pending'">
        <div class="lsb-left">
          <div class="lsb-score num">{{ liveEval.totalScore }}<span>/100 分</span></div>
          <span v-if="liveEval.storeGrade" class="grade-pill" :class="gradeClass(liveEval.storeGrade)">
            {{ liveEval.storeGrade }}
          </span>
          <span class="valid-pill" :class="liveEval.isCompleted ? 'ok' : 'warn'">{{ liveEval.validationText }}</span>
        </div>
        <div class="lsb-advice">{{ liveEval.actionAdvice || '完整选择五个维度后自动判定门店等级与跟进动作' }}</div>
      </div>

      <el-form :model="targetForm" :label-width="isMobile ? 'auto' : '102px'" :label-position="isMobile ? 'top' : 'right'">
        <div class="form-grid-2">
          <el-form-item v-if="auth.isHQ" label="所属代理商">
            <el-select v-model="targetForm.orgId" style="width: 100%">
              <el-option v-for="d in meta.dealers" :key="d.id" :label="d.name" :value="d.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="业务员姓名" required>
            <el-input v-model="targetForm.salesRepName" placeholder="如：林晨亮" />
          </el-form-item>
          <el-form-item label="计划月份" required>
            <el-input v-model="targetForm.planMonth" placeholder="YYYY-MM 如 2026-11" />
          </el-form-item>
          <el-form-item label="机构名称" required>
            <el-input v-model="targetForm.clinicName" placeholder="如：尔湾" />
          </el-form-item>
          <el-form-item label="城市 / 区域" required>
            <el-select
              v-model="targetForm.cityRegion"
              filterable
              allow-create
              default-first-option
              style="width: 100%"
              placeholder="选择或输入区县，如南昌市红谷滩区"
            >
              <el-option v-for="r in meta.nanchangDistricts" :key="r" :label="r" :value="r" />
            </el-select>
          </el-form-item>
          <el-form-item label="线索来源">
            <el-select v-model="targetForm.leadSource" filterable allow-create default-first-option clearable style="width: 100%">
              <el-option v-for="s in meta.leadSources" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
          <el-form-item label="计划拜访日期">
            <el-date-picker
              v-model="targetForm.plannedVisitDate"
              type="date"
              value-format="YYYY-MM-DD"
              style="width: 100%"
              placeholder="选择日期"
            />
          </el-form-item>
        </div>

        <div class="dim-divider">五维评分项（下拉选择自动计分）</div>

        <div class="form-grid-2">
          <el-form-item
            v-for="dim in meta.scoringDimensions"
            :key="dim.key"
            :label="dim.label"
            required
          >
            <el-select v-model="(targetForm as any)[dim.key]" clearable style="width: 100%" :placeholder="`选择${dim.shortLabel}`">
              <el-option
                v-for="opt in dim.options"
                :key="opt.value"
                :label="`${opt.value}（${opt.score} 分）`"
                :value="opt.value"
              />
            </el-select>
          </el-form-item>
        </div>
      </el-form>

      <template #footer>
        <el-button @click="targetDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingTarget" @click="saveTarget">保存并自动计分</el-button>
      </template>
    </el-dialog>

    <!-- ==================== 新增拜访跟进弹窗 ==================== -->
    <el-dialog v-model="followDialog" title="登记客户拜访跟进" width="min(680px, 94vw)" align-center destroy-on-close>
      <div v-if="followForm.targetId" class="follow-match-bar">
        已自动匹配月拜访计划：
        <strong>{{ followForm.cityRegion || '—' }}</strong>
        <span v-if="followForm.storeType"> · {{ followForm.storeType }}</span>
        <span v-if="followForm.storeArea"> · {{ followForm.storeArea }}</span>
      </div>
      <el-form :model="followForm" :label-width="isMobile ? 'auto' : '96px'" :label-position="isMobile ? 'top' : 'right'">
        <div class="form-grid-2">
          <el-form-item label="客户名称" required>
            <el-select
              v-model="followForm.customerName"
              filterable
              allow-create
              default-first-option
              style="width: 100%"
              placeholder="选择计划内门店或输入新客户"
              @change="onPickFollowCustomer"
            >
              <el-option v-for="t in targets" :key="t.id" :label="`${t.clinicName}（${t.cityRegion}）`" :value="t.clinicName" />
            </el-select>
          </el-form-item>
          <el-form-item label="拜访日期" required>
            <el-date-picker
              v-model="followForm.visitDate"
              type="date"
              value-format="YYYY-MM-DD"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="城市 / 区域">
            <el-input v-model="followForm.cityRegion" placeholder="命中计划自动带出，否则为未匹配" />
          </el-form-item>
          <el-form-item label="业务员">
            <el-input v-model="followForm.salesRepName" placeholder="业务员姓名" />
          </el-form-item>
          <el-form-item label="联系人">
            <el-input v-model="followForm.contactName" placeholder="姓名/称呼" />
          </el-form-item>
          <el-form-item label="联系人角色">
            <el-select v-model="followForm.contactRole" clearable filterable allow-create style="width: 100%">
              <el-option v-for="r in meta.contactRoles" :key="r" :label="r" :value="r" />
            </el-select>
          </el-form-item>
          <el-form-item label="联系电话">
            <el-input v-model="followForm.contactPhone" placeholder="手机/座机" />
          </el-form-item>
          <el-form-item label="微信号">
            <el-input v-model="followForm.wechatId" placeholder="微信号（选填）" />
          </el-form-item>
          <el-form-item label="城市会参与">
            <el-select v-model="followForm.cityMeetingStatus" clearable style="width: 100%">
              <el-option v-for="o in meta.cityMeetingOptions" :key="o" :label="o" :value="o" />
            </el-select>
          </el-form-item>
          <el-form-item label="是否成交">
            <el-select v-model="followForm.dealStatus" clearable style="width: 100%">
              <el-option v-for="o in meta.dealStatusOptions" :key="o" :label="o" :value="o" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="拜访情况">
          <el-input v-model="followForm.visitSummary" type="textarea" :rows="2" placeholder="记录现场沟通过程与意向反馈" />
        </el-form-item>
        <el-form-item label="客户需求">
          <el-input v-model="followForm.customerNeed" placeholder="如：买一送一 / 试用装 / 到店演示方案" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="followDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingFollow" @click="saveFollowUp">保存跟进记录</el-button>
      </template>
    </el-dialog>

    <!-- ==================== 批量粘贴导入弹窗 ==================== -->
    <el-dialog v-model="importDialog" title="从 Excel / CSV 批量导入月拜访计划" width="min(680px, 94vw)" align-center>
      <p class="dialog-note">
        每行一条，逗号或制表符分隔：<code class="mono">机构名称,城市区域,线索来源,计划日期,门店类型,引流价格,门店面积,美容师人数,门店规模</code>，系统自动完成五维计分与分级。
      </p>
      <el-input
        v-model="importText"
        type="textarea"
        :rows="7"
        placeholder="尔湾,南昌市红谷滩区,大众美团,2026-11-25,C.皮肤科双美,C.100-200元内,B.100-500平,C.4-6人,B.多店"
      />
      <template #footer>
        <el-button @click="importDialog = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="runImport">开始导入并自动评分</el-button>
      </template>
    </el-dialog>

    <!-- ==================== 评分与分级 SOP 抽屉 ==================== -->
    <el-drawer v-model="sopDrawer" :size="isMobile ? '100%' : '580px'" :with-header="false">
      <div class="drawer-inner">
        <div class="drawer-head">
          <div>
            <div class="drawer-kicker">纳新 & 复购 SOP · 三板斧：筛查 — 判断 — 转化</div>
            <div class="drawer-title">目标门店评分与分级标准（100 分制）</div>
          </div>
          <button class="drawer-close" type="button" @click="sopDrawer = false">×</button>
        </div>

        <p class="sop-intro">
          五大维度合计 100 分，下拉选择后系统自动计分、自动分级并生成跟进动作建议。「寡妇店」指店内仅老板 1 人、无美容师的小店。
        </p>

        <div v-for="dim in meta.scoringDimensions" :key="dim.key" class="sop-block">
          <div class="sop-dim-title">{{ dim.label }}</div>
          <div v-for="opt in dim.options" :key="opt.value" class="sop-opt-row">
            <span class="sop-opt-val">{{ opt.value }}</span>
            <span class="sop-opt-score num">{{ opt.score }} 分</span>
            <span class="sop-opt-note">{{ opt.note }}</span>
          </div>
        </div>

        <div class="sop-block">
          <div class="sop-dim-title">门店等级判定（按总分自动生成）</div>
          <div v-for="g in meta.gradeRules" :key="g.grade" class="sop-grade-row">
            <span class="grade-pill" :class="gradeClass(g.grade)">{{ g.grade }}</span>
            <span class="mono sop-range">{{ g.rangeLabel }}</span>
            <div class="sop-grade-desc">
              <div>{{ g.actionAdvice }}</div>
              <div class="cell-sub">{{ g.description }}</div>
            </div>
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  CITY_MEETING_OPTIONS,
  CONTACT_ROLE_OPTIONS,
  DEAL_STATUS_OPTIONS,
  evaluateStoreVisitTarget,
  LEAD_SOURCE_OPTIONS,
  NANCHANG_DISTRICTS,
  STORE_GRADE_RULES,
  STORE_SCORING_DIMENSIONS,
} from '@lumina/shared-types';
import { api, API_BASE } from '../utils/api';
import { useAuthStore } from '../stores/auth';
import { useViewport } from '../utils/format';

const auth = useAuthStore();
const router = useRouter();
const { width } = useViewport();
const isMobile = computed(() => width.value <= 720);

const activeTab = ref('dashboard');
const sopDrawer = ref(false);

const meta = ref<any>({
  dealers: [],
  salesReps: [],
  months: [],
  currentMonth: new Date().toISOString().slice(0, 7),
  scoringDimensions: STORE_SCORING_DIMENSIONS,
  gradeRules: STORE_GRADE_RULES,
  leadSources: LEAD_SOURCE_OPTIONS,
  contactRoles: CONTACT_ROLE_OPTIONS,
  cityMeetingOptions: CITY_MEETING_OPTIONS,
  dealStatusOptions: DEAL_STATUS_OPTIONS,
  nanchangDistricts: NANCHANG_DISTRICTS,
});

const scope = ref({
  orgId: '',
  salesRepName: '',
  planMonth: '',
});

const dashboard = ref<any>(null);
const targets = ref<any[]>([]);
const followUps = ref<any[]>([]);

const targetFilter = ref({ keyword: '', grade: '', onlyCompleted: false, includeConverted: false });
const followFilter = ref({ keyword: '', cityMeetingStatus: '', dealStatus: '' });

const selectedCustomerName = ref('');
const profileLoading = ref(false);
const customerProfile = ref<any>(null);

const targetDialog = ref(false);
const editingTargetId = ref<string | null>(null);
const savingTarget = ref(false);
const targetForm = ref({
  orgId: '',
  salesRepName: '',
  planMonth: '',
  clinicName: '',
  cityRegion: '南昌市红谷滩区',
  leadSource: '大众美团',
  plannedVisitDate: new Date().toISOString().slice(0, 10),
  storeType: '',
  trafficPrice: '',
  storeArea: '',
  beauticianCount: '',
  storeScale: '',
});

const liveEval = computed(() => evaluateStoreVisitTarget(targetForm.value));

const followDialog = ref(false);
const savingFollow = ref(false);
const followForm = ref({
  orgId: '',
  targetId: '',
  salesRepName: '',
  customerName: '',
  cityRegion: '',
  visitDate: new Date().toISOString().slice(0, 10),
  storeType: '',
  storeArea: '',
  contactName: '',
  contactRole: '',
  contactPhone: '',
  wechatId: '',
  channelSource: '',
  visitSummary: '',
  customerNeed: '',
  cityMeetingStatus: '',
  dealStatus: '',
});

const importDialog = ref(false);
const importText = ref('');
const importing = ref(false);

const regionRowsWithTotal = computed(() => {
  const rows: any[] = dashboard.value?.regionStats || [];
  if (!rows.length) return [];
  const total = rows.reduce(
    (acc, r) => ({
      cityRegion: '合计',
      plannedCount: acc.plannedCount + r.plannedCount,
      completedCount: acc.completedCount + r.completedCount,
      excellentCount: acc.excellentCount + r.excellentCount,
      precisionCount: acc.precisionCount + r.precisionCount,
      validCount: acc.validCount + r.validCount,
      mismatchCount: acc.mismatchCount + r.mismatchCount,
      isTotal: true,
    }),
    {
      cityRegion: '合计',
      plannedCount: 0,
      completedCount: 0,
      excellentCount: 0,
      precisionCount: 0,
      validCount: 0,
      mismatchCount: 0,
      isTotal: true,
    },
  );
  return [...rows, total];
});

const allCustomerNames = computed(() => {
  const set = new Set<string>();
  for (const t of targets.value) if (t.clinicName) set.add(t.clinicName);
  for (const f of followUps.value) if (f.customerName) set.add(f.customerName);
  return Array.from(set);
});

async function loadMeta() {
  meta.value = (await api.get('/crm/meta')) as any;
  if (!scope.value.planMonth && meta.value.currentMonth) {
    scope.value.planMonth = meta.value.currentMonth;
  }
}

async function loadDashboard() {
  dashboard.value = await api.get('/crm/dashboard', {
    params: {
      orgId: scope.value.orgId || undefined,
      salesRepName: scope.value.salesRepName || undefined,
      planMonth: scope.value.planMonth || undefined,
    },
  });
}

const targetPage = ref(1);
const targetPageSize = 20;
const targetTotal = ref(0);
const followPage = ref(1);
const followPageSize = 20;
const followTotal = ref(0);

async function loadTargets(p = 1) {
  targetPage.value = p;
  const res = (await api.get('/crm/targets', {
    params: {
      orgId: scope.value.orgId || undefined,
      salesRepName: scope.value.salesRepName || undefined,
      planMonth: scope.value.planMonth || undefined,
      grade: targetFilter.value.grade || undefined,
      keyword: targetFilter.value.keyword.trim() || undefined,
      onlyCompleted: targetFilter.value.onlyCompleted ? 'true' : undefined,
      includeConverted: targetFilter.value.includeConverted ? 'true' : undefined,
      page: p,
      pageSize: targetPageSize,
    },
  })) as any;
  targets.value = Array.isArray(res) ? res : res.items || [];
  targetTotal.value = Array.isArray(res) ? res.length : Number(res.total || 0);
}

async function loadFollowUps(p = 1) {
  followPage.value = p;
  const res = (await api.get('/crm/followups', {
    params: {
      orgId: scope.value.orgId || undefined,
      salesRepName: scope.value.salesRepName || undefined,
      visitScene: 'NEW_PROSPECT',
      cityMeetingStatus: followFilter.value.cityMeetingStatus || undefined,
      dealStatus: followFilter.value.dealStatus || undefined,
      keyword: followFilter.value.keyword.trim() || undefined,
      page: p,
      pageSize: followPageSize,
    },
  })) as any;
  followUps.value = Array.isArray(res) ? res : res.items || [];
  followTotal.value = Array.isArray(res) ? res.length : Number(res.total || 0);
}

async function reloadScope() {
  await Promise.all([loadDashboard(), loadTargets(), loadFollowUps()]);
  if (!selectedCustomerName.value && allCustomerNames.value.length) {
    selectedCustomerName.value = allCustomerNames.value[0];
    await loadCustomerProfile();
  }
}

onMounted(async () => {
  await loadMeta();
  await reloadScope();
});

function openTargetModal(row?: any) {
  if (row) {
    editingTargetId.value = row.id;
    targetForm.value = {
      orgId: row.orgId || '',
      salesRepName: row.salesRepName || '',
      planMonth: row.planMonth || scope.value.planMonth || meta.value.currentMonth,
      clinicName: row.clinicName || '',
      cityRegion: row.cityRegion || '',
      leadSource: row.leadSource || '',
      plannedVisitDate: row.plannedVisitDate || '',
      storeType: row.storeType || '',
      trafficPrice: row.trafficPrice || '',
      storeArea: row.storeArea || '',
      beauticianCount: row.beauticianCount || '',
      storeScale: row.storeScale || '',
    };
  } else {
    editingTargetId.value = null;
    targetForm.value = {
      orgId: scope.value.orgId || meta.value.dealers?.[0]?.id || '',
      salesRepName: scope.value.salesRepName || auth.user?.realName?.replace(/（.*?）/g, '') || '',
      planMonth: scope.value.planMonth || meta.value.currentMonth,
      clinicName: '',
      cityRegion: '南昌市红谷滩区',
      leadSource: '大众美团',
      plannedVisitDate: new Date().toISOString().slice(0, 10),
      storeType: '',
      trafficPrice: '',
      storeArea: '',
      beauticianCount: '',
      storeScale: '',
    };
  }
  targetDialog.value = true;
}

async function saveTarget() {
  if (!targetForm.value.clinicName.trim()) {
    return ElMessage.warning('请填写机构名称');
  }
  savingTarget.value = true;
  try {
    if (editingTargetId.value) {
      await api.patch(`/crm/targets/${editingTargetId.value}`, targetForm.value);
      ElMessage.success('目标门店评分已更新');
    } else {
      await api.post('/crm/targets', targetForm.value);
      ElMessage.success('目标门店已录入并自动计分');
    }
    targetDialog.value = false;
    await loadMeta();
    await reloadScope();
  } finally {
    savingTarget.value = false;
  }
}

async function removeTarget(row: any) {
  const ok = await ElMessageBox.confirm(`确认删除目标门店「${row.clinicName}」吗？`, '删除确认', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  }).catch(() => false);
  if (!ok) return;
  await api.delete(`/crm/targets/${row.id}`);
  ElMessage.success('已删除');
  await reloadScope();
}

function openFollowUpModal(target?: any) {
  followForm.value = {
    orgId: target?.orgId || scope.value.orgId || meta.value.dealers?.[0]?.id || '',
    targetId: target?.id || '',
    salesRepName: target?.salesRepName || scope.value.salesRepName || auth.user?.realName?.replace(/（.*?）/g, '') || '',
    customerName: target?.clinicName || '',
    cityRegion: target?.cityRegion || '',
    visitDate: new Date().toISOString().slice(0, 10),
    storeType: target?.storeType || '',
    storeArea: target?.storeArea ? target.storeArea.replace(/^[A-D]\./, '') : '',
    contactName: '',
    contactRole: '',
    contactPhone: '',
    wechatId: '',
    channelSource: target?.leadSource || '',
    visitSummary: '',
    customerNeed: '',
    cityMeetingStatus: '',
    dealStatus: '',
  };
  followDialog.value = true;
}

function onPickFollowCustomer(name: string) {
  const found = targets.value.find((t) => t.clinicName === name);
  if (found) {
    followForm.value.targetId = found.id;
    followForm.value.orgId = found.orgId;
    followForm.value.cityRegion = found.cityRegion || '';
    followForm.value.storeType = found.storeType || '';
    followForm.value.storeArea = (found.storeArea || '').replace(/^[A-D]\./, '');
    followForm.value.channelSource = found.leadSource || '';
    if (!followForm.value.salesRepName) followForm.value.salesRepName = found.salesRepName;
  } else {
    followForm.value.targetId = '';
    if (!followForm.value.cityRegion) followForm.value.cityRegion = '未匹配';
  }
}

async function saveFollowUp() {
  if (!followForm.value.customerName.trim()) {
    return ElMessage.warning('请填写或选择客户名称');
  }
  savingFollow.value = true;
  try {
    await api.post('/crm/followups', { ...followForm.value, visitScene: 'NEW_PROSPECT' });
    ElMessage.success('新客拜访跟进已记录');
    followDialog.value = false;
    await reloadScope();
    if (selectedCustomerName.value === followForm.value.customerName) {
      await loadCustomerProfile();
    }
  } finally {
    savingFollow.value = false;
  }
}

async function markTargetExisting(row: any) {
  if (!row.linkedClinicId) return;
  const ok = await ElMessageBox.confirm(
    `确认将「${row.clinicName}」手动标记为合作老客吗？标记后将自动归档其开发期五维评分，并移入「老客维护看板」（本月 20 分纳新业绩分仍完整保留）。`,
    '转为合作老客',
    { confirmButtonText: '确认转老客', cancelButtonText: '取消', type: 'info' },
  ).catch(() => false);
  if (!ok) return;
  await api.post(`/crm/customers/${row.linkedClinicId}/mark-existing`, { remark: '从新客开发看板手动标为老客' });
  ElMessage.success(`「${row.clinicName}」已转为老客并移入老客维护看板`);
  await reloadScope();
}

async function removeFollowUp(row: any) {
  await api.delete(`/crm/followups/${row.id}`);
  ElMessage.success('已删除该条跟进记录');
  await reloadScope();
}

async function loadCustomerProfile() {
  const name = selectedCustomerName.value?.trim();
  if (!name) return;
  profileLoading.value = true;
  try {
    customerProfile.value = await api.get('/crm/customer-profile', {
      params: {
        customerName: name,
        orgId: scope.value.orgId || undefined,
      },
    });
  } finally {
    profileLoading.value = false;
  }
}

async function jumpCustomerProfile(row: any) {
  if (row.linkedClinicId) {
    router.push({ path: '/customers', query: { id: row.linkedClinicId } });
    return;
  }
  activeTab.value = 'lookup';
  selectedCustomerName.value = row.clinicName;
  await loadCustomerProfile();
}

async function lookupCustomerByName(name: string) {
  activeTab.value = 'lookup';
  selectedCustomerName.value = name;
  await loadCustomerProfile();
}

async function promoteToClinic(prof: any) {
  const region = prof.profile.cityRegion || '南昌市';
  const cityMatch = region.match(/^(.+?市)/);
  const city = cityMatch ? cityMatch[1] : region;
  const res = (await api.post('/clinics/report', {
    name: prof.customerName,
    city,
    address: region,
    contactName: prof.profile.contactName !== '未填写' ? prof.profile.contactName : '',
    contactPhone: prof.profile.contactPhone !== '未填写' ? prof.profile.contactPhone : '',
    targetOrgId: prof.target?.orgId || undefined,
  })) as any;
  ElMessage.success(res.message || '已成功转为 90 天保护报备机构');
}

async function openGoalEdit(row: any) {
  const result = await ElMessageBox.prompt(
    `调整业务员「${row.salesRepName}」在 ${scope.value.planMonth || meta.value.currentMonth} 的月度目标拜访家数`,
    '设置月度目标',
    {
      confirmButtonText: '保存目标',
      cancelButtonText: '取消',
      inputValue: String(row.targetQuota || 100),
      inputPattern: /^\d+$/,
      inputErrorMessage: '请输入正整数',
    },
  ).catch(() => null);
  if (!result) return;
  await api.put('/crm/monthly-goal', {
    orgId: row.orgId,
    salesRepName: row.salesRepName,
    planMonth: scope.value.planMonth || meta.value.currentMonth,
    targetQuota: Number(result.value),
  });
  ElMessage.success('月度目标已更新，业绩得分已重算');
  await loadDashboard();
}

async function runImport() {
  const lines = importText.value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return ElMessage.warning('请粘贴至少一行数据');
  importing.value = true;
  try {
    const rows = lines.map((line) => {
      const cols = line.split(/[\t,，]/).map((c) => c?.trim() || '');
      return {
        clinicName: cols[0],
        cityRegion: cols[1],
        leadSource: cols[2],
        plannedVisitDate: cols[3],
        storeType: cols[4],
        trafficPrice: cols[5],
        storeArea: cols[6],
        beauticianCount: cols[7],
        storeScale: cols[8],
      };
    });
    const res = (await api.post('/crm/targets/import', {
      orgId: scope.value.orgId || meta.value.dealers?.[0]?.id || undefined,
      salesRepName: scope.value.salesRepName || auth.user?.realName?.replace(/（.*?）/g, ''),
      planMonth: scope.value.planMonth || meta.value.currentMonth,
      rows,
    })) as any;
    ElMessage.success(`已导入 ${res.created} 家目标门店并完成自动评分`);
    importDialog.value = false;
    importText.value = '';
    await loadMeta();
    await reloadScope();
  } finally {
    importing.value = false;
  }
}

async function exportPlanCsv() {
  const token = localStorage.getItem('lumina_token');
  const params = new URLSearchParams();
  if (scope.value.orgId) params.set('orgId', scope.value.orgId);
  if (scope.value.salesRepName) params.set('salesRepName', scope.value.salesRepName);
  if (scope.value.planMonth) params.set('planMonth', scope.value.planMonth);
  const resp = await fetch(`${API_BASE}/crm/targets/export?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `visit_plan_${scope.value.planMonth || 'all'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function gradeClass(g: string) {
  if (g === '优秀门店') return 'excellent';
  if (g === '精准门店') return 'precision';
  if (g === '有效门店') return 'valid';
  return 'mismatch';
}
</script>

<style scoped>
.scope-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px 14px;
  flex-wrap: wrap;
  padding: 12px 16px;
  margin-bottom: 14px;
}
.scope-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.sc-select {
  width: 205px;
}
.sc-select-sm {
  width: 145px;
}
.scope-actions {
  display: inline-flex;
  gap: 8px;
  flex-wrap: wrap;
}
.plain-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}
.table-wrap {
  overflow-x: auto;
}
.cell-strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.cell-sub {
  font-size: 11.5px;
  color: var(--ink-3);
  margin-top: 1px;
}
.ok-text {
  color: var(--jade);
  font-weight: 600;
}

/* 看板 */
.dash-two-col {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, 1fr);
  gap: 14px;
  margin-top: 14px;
  align-items: stretch;
}
.dash-two-col > .surface-card {
  margin-top: 0;
}
.goal-link {
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--brand);
  font-size: 12.5px;
  cursor: pointer;
  text-decoration: underline dashed;
}
.score-badge {
  font-size: 13px;
  font-weight: 600;
  color: var(--brand-ink);
  background: var(--brand-tint);
  border: 1px solid var(--brand-line);
  padding: 2px 7px;
  border-radius: 4px;
  white-space: nowrap;
}
:deep(.total-row td) {
  font-weight: 600;
  background: var(--surface-2) !important;
}

.grade-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.grade-item {
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.grade-item:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.gi-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.gi-range {
  font-size: 11.5px;
  color: var(--ink-3);
}
.gi-count {
  margin-left: auto;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.gi-pct {
  font-weight: 400;
  color: var(--ink-3);
}
.gi-bar {
  height: 5px;
  background: var(--surface-3);
  border-radius: 99px;
  margin: 7px 0 5px;
  overflow: hidden;
}
.gi-bar span {
  display: block;
  height: 100%;
  border-radius: 99px;
}
.gi-bar span.excellent {
  background: var(--brand);
}
.gi-bar span.precision {
  background: var(--jade);
}
.gi-bar span.valid {
  background: var(--ochre);
}
.gi-bar span.mismatch {
  background: var(--ink-3);
}
.gi-advice {
  font-size: 12px;
  color: var(--ink-2);
}
.caliber-note {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--ink-3);
}

/* 等级与校验标签 */
.grade-pill {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid transparent;
  white-space: nowrap;
}
.grade-pill.sm {
  font-size: 10.5px;
  padding: 1px 5px;
}
.grade-pill.excellent {
  background: var(--brand-tint);
  border-color: var(--brand-line);
  color: var(--brand-ink);
}
.grade-pill.precision {
  background: var(--jade-tint);
  border-color: #cfe0d3;
  color: var(--jade);
}
.grade-pill.valid {
  background: var(--ochre-tint);
  border-color: #e6d5ae;
  color: var(--ochre);
}
.grade-pill.mismatch {
  background: var(--surface-3);
  border-color: var(--line);
  color: var(--ink-3);
}
.valid-pill {
  display: inline-block;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  white-space: nowrap;
}
.valid-pill.ok {
  background: var(--jade-tint);
  color: var(--jade);
}
.valid-pill.warn {
  background: var(--ochre-tint);
  color: var(--ochre);
}

/* 工具栏与列表 */
.tool-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 16px;
  margin-bottom: 14px;
}
.tool-left,
.tool-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.tf-input {
  width: 220px;
}
.tf-select {
  width: 175px;
}
.tf-select-sm {
  width: 135px;
}
.dim-summary {
  display: flex;
  gap: 4px;
}
.dim-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 20px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-2);
}
.dim-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 210px;
}
.score-line {
  display: flex;
  align-items: center;
  gap: 6px;
}
.unmatched-tag {
  color: var(--ochre);
  font-weight: 500;
}
.need-line {
  font-size: 11.5px;
  color: var(--brand-ink);
  margin-top: 2px;
}

/* 客户档案查询 */
.lookup-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 14px 16px;
  margin-bottom: 14px;
}
.lk-select {
  width: 260px;
}
.pf-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.pf-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.pf-name {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
}
.pf-score-box {
  text-align: right;
  padding: 6px 12px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--line);
}
.pf-score-label {
  font-size: 11px;
  color: var(--ink-3);
}
.pf-score-val {
  font-size: 22px;
  font-weight: 600;
  color: var(--brand-ink);
  line-height: 1.2;
}
.pf-score-val span {
  font-size: 12px;
  color: var(--ink-3);
  font-weight: 400;
}
.pf-advice {
  margin: 12px 0;
  padding: 9px 12px;
  border-radius: 6px;
  background: var(--brand-tint);
  border: 1px solid var(--brand-line);
  color: var(--brand-ink);
  font-size: 12.5px;
  font-weight: 500;
}
.pf-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px 16px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
.pf-kv {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pf-kv span {
  font-size: 11px;
  color: var(--ink-3);
}
.pf-kv strong {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
  word-break: break-word;
}

/* 弹窗评分预览 */
.live-score-banner {
  padding: 11px 14px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  margin-bottom: 14px;
}
.live-score-banner.ok {
  background: var(--brand-tint);
  border-color: var(--brand-line);
}
.lsb-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.lsb-score {
  font-size: 20px;
  font-weight: 600;
  color: var(--ink);
}
.lsb-score span {
  font-size: 12px;
  font-weight: 400;
  color: var(--ink-3);
  margin-left: 2px;
}
.lsb-advice {
  font-size: 12px;
  color: var(--ink-2);
  margin-top: 4px;
}
.form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}
.dim-divider {
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-ink);
  padding: 8px 0 10px;
  margin-top: 4px;
  border-top: 1px solid var(--line);
}
.dialog-note {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--ink-2);
  line-height: 1.65;
}

/* SOP 抽屉 */
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.drawer-kicker {
  font-size: 11px;
  color: var(--ink-3);
}
.drawer-title {
  font-size: 16px;
  font-weight: 600;
  margin-top: 3px;
}
.drawer-close {
  border: 0;
  background: transparent;
  font-size: 20px;
  color: var(--ink-3);
  cursor: pointer;
}
.sop-intro {
  font-size: 12.5px;
  color: var(--ink-2);
  line-height: 1.65;
  margin: 12px 0;
}
.sop-block {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 11px 13px;
  margin-bottom: 10px;
  background: var(--surface);
}
.sop-dim-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 8px;
}
.sop-opt-row {
  display: grid;
  grid-template-columns: 160px 50px 1fr;
  gap: 8px;
  align-items: baseline;
  padding: 5px 0;
  border-top: 1px solid var(--line);
  font-size: 12px;
}
.sop-opt-val {
  font-weight: 500;
  color: var(--ink);
}
.sop-opt-score {
  color: var(--brand-ink);
  font-weight: 600;
  text-align: right;
}
.sop-opt-note {
  color: var(--ink-3);
}
.sop-grade-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 7px 0;
  border-top: 1px solid var(--line);
  font-size: 12px;
}
.sop-range {
  min-width: 68px;
  color: var(--ink-2);
}
.sop-grade-desc {
  flex: 1;
  min-width: 0;
}

/* 移动端卡片 */
.mobile-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.m-crm-card {
  padding: 13px 14px;
}
.mcc-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.mcc-dims {
  font-size: 12px;
  color: var(--ink-2);
  margin-top: 6px;
  line-height: 1.5;
}
.mcc-advice {
  font-size: 12px;
  color: var(--brand-ink);
  margin-top: 5px;
}
.mcc-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
.mcc-actions :deep(.el-button + .el-button),
.scope-actions :deep(.el-button + .el-button),
.tool-right :deep(.el-button + .el-button),
.lookup-bar :deep(.el-button + .el-button) {
  margin-left: 0;
}
.m-rep-card {
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-2);
}
.m-rep-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--ink-2);
}
.follow-match-bar {
  padding: 8px 12px;
  margin-bottom: 12px;
  border-radius: 6px;
  background: var(--brand-tint);
  border: 1px solid var(--brand-line);
  color: var(--brand-ink);
  font-size: 12px;
}

@media (max-width: 1080px) {
  .dash-two-col {
    grid-template-columns: 1fr;
  }
  .pf-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 720px) {
  .sc-select,
  .sc-select-sm,
  .tf-input,
  .tf-select,
  .tf-select-sm,
  .lk-select {
    width: 100%;
  }
  .form-grid-2 {
    grid-template-columns: 1fr;
  }
  .sop-opt-row {
    grid-template-columns: 1fr auto;
  }
  .sop-opt-note {
    grid-column: 1 / -1;
  }
}
</style>
