<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">一物一码</h1>
        <p class="page-subtitle">流向查询 · 批次赋码 · 单码追踪 · 合规预警</p>
      </div>
      <div class="page-actions">
        <el-button v-if="auth.isHQ" type="primary" @click="batchDialog = true">生成防伪码批次</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="plain-tabs">
      <!-- 流向追溯查询（2.3：按产品码、代理商、时间组合查询） -->
      <el-tab-pane label="流向追溯查询" name="flows">
        <div class="surface-card flow-filter-card">
          <div class="flow-filters">
            <el-input
              v-model="flowFilter.code"
              clearable
              placeholder="产品码 / 防伪码"
              class="ff-input"
              @keyup.enter="loadFlows(1)"
            />
            <el-select
              v-if="auth.isHQ"
              v-model="flowFilter.dealerId"
              clearable
              placeholder="全部代理商（服务商）"
              class="ff-select"
              @change="loadFlows(1)"
            >
              <el-option v-for="d in dealers" :key="d.id" :label="d.name" :value="d.id" />
            </el-select>
            <el-select
              v-model="flowFilter.eventType"
              clearable
              placeholder="全部流向节点"
              class="ff-select-sm"
              @change="loadFlows(1)"
            >
              <el-option label="总仓入库" value="HQ_INBOUND" />
              <el-option label="出库绑定代理商" value="HQ_OUTBOUND" />
              <el-option label="代理商收货" value="DEALER_INBOUND" />
              <el-option label="出库至终端机构" value="DEALER_OUTBOUND" />
              <el-option label="顾客扫码验真" value="CONSUMER_VERIFIED" />
              <el-option label="赋码建档" value="BATCH_GENERATED" />
              <el-option label="退货回仓" value="RETURN_TO_HQ" />
            </el-select>
            <el-date-picker
              v-model="flowFilter.startDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="开始日期"
              class="ff-date"
              @change="loadFlows(1)"
            />
            <el-date-picker
              v-model="flowFilter.endDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="结束日期"
              class="ff-date"
              @change="loadFlows(1)"
            />
            <div class="ff-btns">
              <el-button type="primary" :loading="flowsLoading" @click="loadFlows(1)">查询</el-button>
              <el-button @click="resetFlowFilters">重置</el-button>
              <el-button plain @click="exportFlowsCsv">导出 CSV</el-button>
            </div>
          </div>

          <div class="flow-summary">
            <span>命中 <strong class="num">{{ flowData.summary.totalEvents }}</strong> 条流向记录</span>
            <span class="fs-sep">·</span>
            <span>涉及 <strong class="num">{{ flowData.summary.uniqueCodes }}</strong> 个产品码</span>
            <span class="fs-sep">·</span>
            <span>入库 <strong class="num">{{ flowData.summary.inboundCount }}</strong> 条</span>
            <span class="fs-sep">·</span>
            <span>出库 <strong class="num">{{ flowData.summary.outboundCount }}</strong> 条</span>
          </div>
        </div>

        <div v-if="!isMobile" class="surface-card flush">
          <div class="bulk-bar">
            <div class="bulk-left">
              <span class="bulk-count">已选 <strong>{{ flowSelection.length }}</strong> 条</span>
            </div>
            <div class="bulk-right">
              <el-button size="small" :disabled="!flowSelection.length" @click="printSelectedLabels">批量打印二维码贴纸</el-button>
              <el-button size="small" :disabled="!flowSelection.length" @click="exportSelectedFlows">导出所选 CSV</el-button>
            </div>
          </div>
          <el-table
            :data="flowData.items"
            v-loading="flowsLoading"
            size="small"
            style="width: 100%"
            row-key="id"
            empty-text="当前筛选条件下没有流向记录"
            @selection-change="(rows: any[]) => (flowSelection = rows)"
          >
            <el-table-column type="selection" width="38" />
            <el-table-column label="时间" width="114">
              <template #default="{ row }">
                <span class="mono cell-sub">{{ formatDateTime(row.occurredAt) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="流向节点" width="98">
              <template #default="{ row }">
                <span class="code-status-pill" :class="eventTone(row.eventType)">
                  {{ eventLabel(row.eventType) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="产品码" min-width="146">
              <template #default="{ row }">
                <span class="code-chip clickable" title="点击复制" @click="copyToken(row.codeToken)">
                  {{ formatCodeGroups(row.codeToken) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="商品 / 批次" min-width="130" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="cell-strong">{{ row.product?.name }}</div>
                <div class="cell-sub mono">{{ row.batchNo }}</div>
              </template>
            </el-table-column>
            <el-table-column label="代理商 / 去向" min-width="124" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="cell-strong">{{ row.dealer?.name || '总部在库' }}</div>
                <div v-if="row.clinic" class="cell-sub">→ {{ row.clinic.name }}</div>
                <div v-else-if="row.warehouse" class="cell-sub">{{ row.warehouse.name }}</div>
              </template>
            </el-table-column>
            <el-table-column label="单号 / 说明" min-width="108" show-overflow-tooltip>
              <template #default="{ row }">
                <div v-if="row.docNo" class="mono cell-doc">{{ row.docNo }}</div>
                <div class="cell-sub">{{ row.remark || '—' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="64" align="right">
              <template #default="{ row }">
                <el-button size="small" link type="primary" @click="jumpTimeline(row.codeToken)">查链路</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div v-if="flowData.total > flowData.pageSize" class="flow-pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="flowData.total"
              :page-size="flowData.pageSize"
              :current-page="flowData.page"
              @current-change="loadFlows"
            />
          </div>
        </div>

        <div v-else class="mobile-card-list">
          <div v-if="!flowData.items.length" class="surface-card empty-line">当前筛选条件下没有流向记录</div>
          <article v-for="row in flowData.items" :key="row.id" class="surface-card m-batch-card">
            <div class="mbc-top">
              <span class="code-status-pill" :class="eventTone(row.eventType)">{{ eventLabel(row.eventType) }}</span>
              <span class="mono cell-sub">{{ formatDateTime(row.occurredAt) }}</span>
            </div>
            <div class="mc-code-row" @click="copyToken(row.codeToken)">
              <span class="mono mc-token">{{ formatCodeGroups(row.codeToken) }}</span>
              <span class="mc-copy">复制</span>
            </div>
            <div class="mbc-name">{{ row.product?.name }} <span class="mono cell-sub">{{ row.batchNo }}</span></div>
            <div class="mbc-meta">
              <span>代理商：{{ row.dealer?.name || '总部在库' }}</span>
              <span v-if="row.clinic">→ {{ row.clinic.name }}</span>
            </div>
            <div v-if="row.docNo || row.remark" class="mbc-remark">
              <span v-if="row.docNo" class="mono">{{ row.docNo }} · </span>{{ row.remark }}
            </div>
            <div class="mbc-actions">
              <el-button size="small" type="primary" plain @click="jumpTimeline(row.codeToken)">查看完整流向链路</el-button>
            </div>
          </article>
        </div>
      </el-tab-pane>

      <!-- 批次 -->
      <el-tab-pane v-if="auth.isHQ" label="生码批次" name="batches">
        <div v-if="!isMobile" class="surface-card flush">
          <el-table :data="batches" size="small" style="width: 100%" empty-text="还没有生码批次">
            <el-table-column label="批次号" width="150">
              <template #default="{ row }"><span class="mono cell-doc">{{ row.batchNo }}</span></template>
            </el-table-column>
            <el-table-column label="商品" min-width="180">
              <template #default="{ row }">
                <div class="cell-strong">{{ row.product.name }}</div>
                <div class="cell-sub mono">{{ row.product.skuCode }}</div>
              </template>
            </el-table-column>
            <el-table-column label="箱 / 盒" width="128">
              <template #default="{ row }">
                <span class="mono">{{ row.cartonCount }}</span> 箱
                <span class="cell-sub">/</span>
                <span class="mono">{{ row.unitCount }}</span> 盒
                <div class="cell-sub">{{ row.cartonQty }} 盒/箱</div>
              </template>
            </el-table-column>
            <el-table-column label="有效期" width="106">
              <template #default="{ row }"><span class="mono cell-sub">{{ row.expDate?.slice(0, 10) }}</span></template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
            <el-table-column label="操作" width="218" align="right" :fixed="width <= 1180 ? false : 'right'">
              <template #default="{ row }">
                <div class="table-actions">
                  <el-button size="small" type="primary" plain @click="openBatchPrint(row)">打印二维码</el-button>
                  <el-button size="small" link type="primary" @click="openBatchCodes(row.id)">查看码</el-button>
                  <el-button size="small" link @click="downloadCsv(row.id, row.batchNo)">CSV</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="batchTotal"
              :page-size="batchPageSize"
              :current-page="batchPage"
              @current-change="(p: number) => loadBatches(p)"
            />
          </div>
        </div>

        <div v-else class="mobile-card-list">
          <div v-if="!batches.length" class="surface-card empty-line">还没有生码批次</div>
          <article v-for="row in batches" :key="row.id" class="surface-card m-batch-card">
            <div class="mbc-top">
              <span class="mono cell-doc">{{ row.batchNo }}</span>
              <span class="mono cell-sub">效期 {{ row.expDate?.slice(0, 10) }}</span>
            </div>
            <div class="mbc-name">{{ row.product.name }}</div>
            <div class="mbc-meta">
              <span class="mono">{{ row.product.skuCode }}</span>
              <span>·</span>
              <span>{{ row.cartonCount }} 箱 / {{ row.unitCount }} 盒（{{ row.cartonQty }} 盒/箱）</span>
            </div>
            <div v-if="row.remark" class="mbc-remark">{{ row.remark }}</div>
            <div class="mbc-actions">
              <el-button size="small" type="primary" @click="openBatchPrint(row)">打印二维码</el-button>
              <el-button size="small" type="primary" plain @click="openBatchCodes(row.id)">查看码</el-button>
              <el-button size="small" @click="downloadCsv(row.id, row.batchNo)">导出 CSV</el-button>
            </div>
          </article>
        </div>
      </el-tab-pane>

      <!-- 单码追踪 -->
      <el-tab-pane label="单码追踪" name="timeline">
        <div class="trace-search">
          <div class="ts-field">
            <el-icon class="ts-icon"><Aim /></el-icon>
            <input
              v-model="lookupCode"
              class="ts-input mono"
              placeholder="扫描或粘贴 16 位防伪码 / 二维码链接"
              @keyup.enter="searchTimeline"
            />
            <button class="ts-btn" type="button" :disabled="searching" @click="searchTimeline">
              {{ searching ? '查询中…' : '查流向' }}
            </button>
          </div>
          <span class="ts-hint">在顶部全局搜索框扫码，也会直接跳到这里</span>
        </div>

        <template v-if="timelineData">
          <div class="code-hero">
            <div class="ch-left">
              <div class="ch-kicker">
                {{ timelineData.code.codeLevel === 'CARTON' ? '外箱码' : '单品盒码' }}
                <span class="ch-dot">·</span>
                <span :class="timelineData.signatureValid || timelineData.isRegisteredExternal ? 'ch-ok' : 'ch-bad'">
                  {{
                    timelineData.signatureValid
                      ? '防伪签名校验通过'
                      : timelineData.isRegisteredExternal
                        ? '入库建档码 · 系统已收录'
                        : '签名异常'
                  }}
                </span>
              </div>
              <div class="ch-token mono" title="点击复制防伪码" @click="copyToken(timelineData.code.codeToken)">
                {{ formatCodeGroups(timelineData.code.codeToken) }}
              </div>
              <div class="ch-product">
                {{ timelineData.code.product.name }}
                <span class="mono ch-sku">{{ timelineData.code.product.skuCode }}</span>
              </div>
            </div>
            <div class="ch-right">
              <div class="ch-stats">
                <div class="ch-stat">
                  <span class="ch-stat-label">当前状态</span>
                  <span class="ch-stat-value">{{ statusLabel(timelineData.code.status) }}</span>
                </div>
                <div class="ch-stat">
                  <span class="ch-stat-label">已验证</span>
                  <span class="ch-stat-value num">{{ timelineData.code.verifyCount }} 次</span>
                </div>
                <div class="ch-stat">
                  <span class="ch-stat-label">批次</span>
                  <span class="ch-stat-value mono">{{ timelineData.code.batch.batchNo }}</span>
                </div>
              </div>
              <div class="ch-actions">
                <button
                  type="button"
                  class="ch-action-btn"
                  @click="openQrPreview({ ...timelineData.code, productName: timelineData.code.product?.name })"
                >
                  查看二维码
                </button>
                <button type="button" class="ch-action-btn primary" @click="openConsumerVerify(timelineData.code.codeToken)">
                  C 端验真
                </button>
              </div>
            </div>
          </div>

          <section
            v-if="timelineData.code.parent || timelineData.code.children?.length"
            class="surface-card relation-card"
          >
            <div class="section-header" style="margin-bottom: 10px">
              <h2 class="section-title">箱盒关联</h2>
              <span class="section-note">
                {{
                  timelineData.code.parent
                    ? '当前单盒所属外箱（点击可查整箱流向）'
                    : `该外箱内绑定 ${timelineData.code.children.length} 个单品盒码`
                }}
              </span>
            </div>
            <div v-if="timelineData.code.parent" class="relation-chips">
              <span class="level-tag carton">外箱</span>
              <span
                class="code-chip clickable"
                @click="jumpTimeline(timelineData.code.parent.codeToken)"
              >
                {{ formatCodeGroups(timelineData.code.parent.codeToken) }}
              </span>
              <span class="code-status-pill" :class="statusClass(timelineData.code.parent.status)">
                {{ statusLabel(timelineData.code.parent.status) }}
              </span>
            </div>
            <div v-else class="relation-chips">
              <button
                v-for="ch in timelineData.code.children"
                :key="ch.codeToken"
                type="button"
                class="code-chip clickable"
                @click="jumpTimeline(ch.codeToken)"
              >
                {{ formatCodeGroups(ch.codeToken) }}
              </button>
            </div>
          </section>

          <section class="surface-card chain-wrap">
            <div class="section-header">
              <h2 class="section-title">这一盒走过的路</h2>
              <span class="section-note">
                归属：{{ timelineData.assignedDealer?.name || '总部在库' }}
                <template v-if="timelineData.targetClinic"> → {{ timelineData.targetClinic.name }}</template>
              </span>
            </div>
            <CodeChain :stages="journeyStages" />
          </section>

          <section class="surface-card">
            <div class="section-header">
              <h2 class="section-title">流向时间轴</h2>
              <span class="section-note">每次流转都带单号与操作人，不可篡改</span>
            </div>
            <ul v-if="displayEvents.length" class="timeline">
              <li v-for="(ev, i) in displayEvents" :key="ev.id" class="tl-item">
                <div class="tl-rail">
                  <span class="tl-dot" :class="i === 0 ? 'latest' : ''" />
                  <span class="tl-line" v-if="i < displayEvents.length - 1" />
                </div>
                <div class="tl-body">
                  <div class="tl-top">
                    <span class="tl-label">{{ eventLabel(ev.eventType) }}</span>
                    <span class="tl-time mono">{{ formatDateTime(ev.occurredAt) }}</span>
                  </div>
                  <div class="tl-meta">
                    <span v-if="ev.docNo" class="code-chip">{{ ev.docNo }}</span>
                    <span v-if="ev.remark">{{ ev.remark }}</span>
                  </div>
                </div>
              </li>
            </ul>
            <div v-else class="empty-line">暂无流转事件记录</div>
          </section>
        </template>

        <div v-else class="trace-empty">
          <div class="te-title">扫一个码试试</div>
          <div class="te-desc">
            在顶部全局搜索框扫任意防伪码，或在上方输入框粘贴 16 位码，就能看到它从出厂到顾客的完整路径。
          </div>
        </div>
      </el-tab-pane>

      <!-- 预警 -->
      <el-tab-pane label="窜货与合规预警" name="alerts">
        <div class="surface-card flush">
          <el-table :data="alerts" size="small" style="width: 100%" empty-text="当前渠道流向健康">
            <el-table-column label="级别" width="76">
              <template #default="{ row }">
                <span class="sev" :class="sevClass(row.severity)">{{ row.severity }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="alertType" label="类型" width="140" />
            <el-table-column prop="title" label="事件" min-width="190" />
            <el-table-column prop="detail" label="证据" min-width="220" show-overflow-tooltip />
            <el-table-column label="状态" width="88">
              <template #default="{ row }">
                <span class="rec-pill" :class="row.status === 'RESOLVED' ? 'ok' : 'bad'">
                  {{ row.status === 'RESOLVED' ? '已结案' : '待处置' }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="88" align="right" :fixed="width <= 1180 ? false : 'right'">
              <template #default="{ row }">
                <el-button
                  v-if="auth.isHQ && row.status !== 'RESOLVED'"
                  size="small"
                  type="primary"
                  plain
                  @click="openResolve(row)"
                >
                  结案
                </el-button>
                <span v-else class="cell-sub">{{ row.resolution || '—' }}</span>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="alertTotal"
              :page-size="alertPageSize"
              :current-page="alertPage"
              @current-change="(p: number) => loadAlerts(p)"
            />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 生码 -->
    <el-dialog v-model="batchDialog" title="生成防伪码批次" width="min(540px, 94vw)" align-center>
      <el-form :model="batchForm" :label-width="isMobile ? 'auto' : '110px'" :label-position="isMobile ? 'top' : 'right'">
        <el-form-item label="商品" required>
          <el-select v-model="batchForm.productId" style="width: 100%" placeholder="选择商品">
            <el-option
              v-for="p in products"
              :key="p.id"
              :label="`${p.name}（${p.skuCode}）${p.cartonQty}${p.unitName}/箱`"
              :value="p.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="单品盒数" required>
          <el-input-number v-model="batchForm.unitCount" :min="1" :max="10000" style="width: 100%" controls-position="right" />
        </el-form-item>
        <el-form-item label="箱盒关联">
          <el-switch v-model="batchForm.enableCarton" active-text="整箱预绑定箱码" />
        </el-form-item>
        <el-form-item v-if="batchForm.enableCarton" label="每箱盒数">
          <el-input-number v-model="batchForm.cartonQty" :min="2" :max="200" style="width: 100%" controls-position="right" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="batchForm.remark" placeholder="如：广州厂 11 月第二批" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchDialog = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitBatch">生成</el-button>
      </template>
    </el-dialog>

    <!-- 批次码明细 -->
    <el-dialog
      v-model="codesDialog"
      :title="`批次码 · ${batchCodesData?.batch?.batchNo || ''}`"
      width="min(960px, 94vw)"
      align-center
      destroy-on-close
      class="codes-dialog"
    >
      <div v-if="batchCodesData?.batch" class="batch-meta-bar">
        <span class="bm-name">{{ batchCodesData.batch.product?.name }}</span>
        <span class="mono bm-sku">{{ batchCodesData.batch.product?.skuCode }}</span>
        <span class="bm-stat">
          共 {{ batchCodeCounts.all }} 码（外箱 {{ batchCodeCounts.carton }} · 单盒 {{ batchCodeCounts.unit }}）
        </span>
      </div>

      <div class="codes-toolbar">
        <div class="codes-filters">
          <div class="mini-seg">
            <button type="button" :class="{ on: codeLevelFilter === 'ALL' }" @click="codeLevelFilter = 'ALL'">
              全部 {{ batchCodeCounts.all }}
            </button>
            <button type="button" :class="{ on: codeLevelFilter === 'CARTON' }" @click="codeLevelFilter = 'CARTON'">
              外箱 {{ batchCodeCounts.carton }}
            </button>
            <button type="button" :class="{ on: codeLevelFilter === 'UNIT' }" @click="codeLevelFilter = 'UNIT'">
              单盒 {{ batchCodeCounts.unit }}
            </button>
          </div>
          <el-input
            v-model="codeSearch"
            size="small"
            clearable
            placeholder="筛选防伪码 / 外箱码"
            class="code-search-input"
          />
        </div>
        <div class="codes-toolbar-actions">
          <el-button
            v-if="batchCodesData?.batch"
            size="small"
            type="primary"
            @click="openCurrentBatchPrint"
          >
            批量打印二维码（A4）
          </el-button>
          <el-button
            v-if="batchCodesData?.batch"
            size="small"
            @click="downloadCsv(batchCodesData.batch.id, batchCodesData.batch.batchNo)"
          >
            导出工厂印刷 CSV
          </el-button>
        </div>
      </div>

      <!-- 桌面表格 -->
      <div v-if="!isMobile" class="codes-table-scroll">
        <el-table
          :data="filteredBatchCodes"
          size="small"
          style="width: 100%"
          empty-text="没有匹配的防伪码"
        >
        <el-table-column label="级别" width="76">
          <template #default="{ row }">
            <span class="level-tag" :class="row.codeLevel === 'CARTON' ? 'carton' : 'unit'">
              {{ row.codeLevel === 'CARTON' ? '外箱' : '单盒' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="codeToken" label="防伪码（点击复制）" min-width="215">
          <template #default="{ row }">
            <span class="code-chip clickable" title="点击复制防伪码" @click="copyToken(row.codeToken)">
              {{ formatCodeGroups(row.codeToken) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="parentToken" label="所属外箱" min-width="195">
          <template #default="{ row }">
            <button
              v-if="row.parentToken"
              type="button"
              class="parent-link mono"
              @click="jumpTimeline(row.parentToken)"
            >
              {{ formatCodeGroups(row.parentToken) }}
            </button>
            <span v-else class="cell-sub">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" min-width="115">
          <template #default="{ row }">
            <span class="code-status-pill" :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" align="right">
          <template #default="{ row }">
            <div class="table-actions">
              <el-button size="small" link type="primary" @click="jumpTimeline(row.codeToken)">查流向</el-button>
              <el-button size="small" link @click="openQrPreview(row)">二维码</el-button>
              <el-button size="small" link @click="openConsumerVerify(row.codeToken)">C 端验真</el-button>
            </div>
          </template>
        </el-table-column>
        </el-table>
        <div class="table-pager">
          <el-pagination
            background
            layout="total, prev, pager, next"
            :total="batchCodesTotal"
            :page-size="batchCodesPageSize"
            :current-page="batchCodesPage"
            @current-change="(p: number) => loadBatchCodesPage(p)"
          />
        </div>
      </div>

      <!-- 移动端卡片 -->
      <div v-else class="mobile-codes-list">
        <div v-if="!filteredBatchCodes.length" class="empty-line">没有匹配的防伪码</div>
        <article v-for="row in filteredBatchCodes" :key="row.id || row.codeToken" class="mc-card">
          <div class="mc-top">
            <span class="level-tag" :class="row.codeLevel === 'CARTON' ? 'carton' : 'unit'">
              {{ row.codeLevel === 'CARTON' ? '外箱码' : '单品盒码' }}
            </span>
            <span class="code-status-pill" :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span>
          </div>
          <div class="mc-code-row" @click="copyToken(row.codeToken)">
            <span class="mono mc-token">{{ formatCodeGroups(row.codeToken) }}</span>
            <span class="mc-copy">复制</span>
          </div>
          <div v-if="row.parentToken" class="mc-parent">
            所属外箱：<span class="mono">{{ formatCodeGroups(row.parentToken) }}</span>
          </div>
          <div class="mc-actions">
            <el-button size="small" plain type="primary" @click="jumpTimeline(row.codeToken)">查流向</el-button>
            <el-button size="small" plain @click="openQrPreview(row)">二维码</el-button>
            <el-button size="small" plain @click="openConsumerVerify(row.codeToken)">C 端验真</el-button>
          </div>
        </article>
      </div>
    </el-dialog>

    <!-- 二维码 -->
    <el-dialog v-model="qrDialog" title="产品溯源二维码" width="min(390px, 92vw)" align-center>
      <div class="qr-wrap">
        <div class="qr-badge-row">
          <span class="level-tag" :class="qrTarget?.codeLevel === 'CARTON' ? 'carton' : 'unit'">
            {{ qrTarget?.codeLevel === 'CARTON' ? '外箱码' : '单品盒码' }}
          </span>
          <span v-if="qrTarget?.productName || batchCodesData?.batch?.product?.name" class="qr-prod">
            {{ qrTarget?.productName || batchCodesData?.batch?.product?.name }}
          </span>
        </div>
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="溯源二维码" class="qr-img" />
        <div class="mono qr-token" title="点击复制防伪码" @click="copyToken(qrTarget?.codeToken)">
          {{ formatCodeGroups(qrTarget?.codeToken) }}
        </div>
        <div class="qr-url mono" @click="copyToken(qrTarget?.verifyUrl)">{{ qrTarget?.verifyUrl }}</div>
        <div class="qr-actions">
          <el-button @click="copyToken(qrTarget?.verifyUrl)">复制链接</el-button>
          <el-button type="primary" @click="openConsumerVerify(qrTarget?.codeToken)">模拟顾客扫码</el-button>
        </div>
      </div>
    </el-dialog>

    <!-- 结案 -->
    <el-dialog v-model="resolveDialog" title="预警结案" width="min(460px, 94vw)" align-center>
      <div class="resolve-head">{{ activeAlert?.title }}</div>
      <el-input
        v-model="resolutionText"
        type="textarea"
        :rows="3"
        placeholder="填写核查结果与处罚 / 返点扣减说明"
      />
      <template #footer>
        <el-button @click="resolveDialog = false">取消</el-button>
        <el-button type="primary" @click="submitResolve">确认结案</el-button>
      </template>
    </el-dialog>

    <QrLabelPrintModal
      v-model="qrPrintDialog"
      :batch-no="qrPrintBatch?.batchNo"
      :product-name="qrPrintBatch?.productName"
      :sku-code="qrPrintBatch?.skuCode"
      :carton-qty="qrPrintBatch?.cartonQty"
      :codes="qrPrintBatch?.codes || []"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import QRCode from 'qrcode';
import { ElMessage } from 'element-plus';
import QrLabelPrintModal from '../components/QrLabelPrintModal.vue';
import { Aim } from '@element-plus/icons-vue';
import { api, API_BASE, APP_BASE } from '../utils/api';
import { useAuthStore } from '../stores/auth';
import { formatCodeGroups, formatDateTime, useViewport } from '../utils/format';
import CodeChain from '../components/CodeChain.vue';

const auth = useAuthStore();
const route = useRoute();
const { width } = useViewport();
const isMobile = computed(() => width.value <= 720);
const isCompact = computed(() => width.value <= 960);

const activeTab = ref('flows');
const batches = ref<any[]>([]);
const products = ref<any[]>([]);
const alerts = ref<any[]>([]);
const dealers = ref<any[]>([]);

const flowsLoading = ref(false);
const flowFilter = ref({
  code: '',
  dealerId: '',
  eventType: '',
  startDate: '',
  endDate: '',
});
const flowData = ref<{
  total: number;
  page: number;
  pageSize: number;
  summary: { totalEvents: number; uniqueCodes: number; inboundCount: number; outboundCount: number };
  items: any[];
}>({
  total: 0,
  page: 1,
  pageSize: 30,
  summary: { totalEvents: 0, uniqueCodes: 0, inboundCount: 0, outboundCount: 0 },
  items: [],
});

const batchDialog = ref(false);
const creating = ref(false);
const batchForm = ref({ productId: '', unitCount: 12, enableCarton: true, cartonQty: 6, remark: '' });

const codesDialog = ref(false);
const batchCodesData = ref<any>(null);
const codeLevelFilter = ref<'ALL' | 'CARTON' | 'UNIT'>('ALL');
const codeSearch = ref('');

const qrDialog = ref(false);
const qrTarget = ref<any>(null);
const qrDataUrl = ref('');

const qrPrintDialog = ref(false);
const qrPrintBatch = ref<any>(null);
const flowSelection = ref<any[]>([]);

function printSelectedLabels() {
  const seen = new Set<string>();
  const codes = flowSelection.value
    .filter((r) => r.codeToken && !seen.has(r.codeToken) && seen.add(r.codeToken))
    .map((r) => ({ codeToken: r.codeToken, codeLevel: r.codeLevel || 'UNIT', status: r.status }));
  if (!codes.length) return;
  const products = new Set(flowSelection.value.map((r) => r.product?.name).filter(Boolean));
  qrPrintBatch.value = {
    batchNo: flowSelection.value[0]?.batchNo || '所选流向',
    productName: products.size === 1 ? [...products][0] : `${products.size} 个商品`,
    skuCode: flowSelection.value[0]?.product?.skuCode || '',
    codes,
  };
  qrPrintDialog.value = true;
}

function exportSelectedFlows() {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['时间', '流向节点', '产品码', '商品', '批次', '代理商', '去向', '单号', '说明'];
  const rows = flowSelection.value.map((r: any) =>
    [
      formatDateTime(r.occurredAt),
      eventLabel(r.eventType),
      r.codeToken,
      r.product?.name,
      r.batchNo,
      r.dealer?.name || '总部在库',
      r.clinic?.name || r.warehouse?.name || '',
      r.docNo,
      r.remark,
    ]
      .map(esc)
      .join(','),
  );
  const blob = new Blob([`\ufeff${header.join(',')}\n${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lumina-flows-selected-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const lookupCode = ref('');
const searching = ref(false);
const timelineData = ref<any>(null);

const resolveDialog = ref(false);
const activeAlert = ref<any>(null);
const resolutionText = ref('');

const batchCodeCounts = computed(() => {
  const list: any[] = batchCodesData.value?.codes || [];
  const carton = list.filter((c) => c.codeLevel === 'CARTON').length;
  const unit = list.filter((c) => c.codeLevel !== 'CARTON').length;
  return { all: list.length, carton, unit };
});

const filteredBatchCodes = computed(() => {
  const list: any[] = batchCodesData.value?.codes || [];
  const kw = codeSearch.value.trim().toUpperCase().replace(/\s+/g, '');
  return list.filter((c) => {
    if (codeLevelFilter.value !== 'ALL' && c.codeLevel !== codeLevelFilter.value) return false;
    if (!kw) return true;
    const token = String(c.codeToken || '').toUpperCase();
    const parent = String(c.parentToken || '').toUpperCase();
    return token.includes(kw) || parent.includes(kw);
  });
});

const displayEvents = computed(() => {
  const events: any[] = timelineData.value?.code?.events || [];
  if (events.length > 0) return [...events].reverse();
  const code = timelineData.value?.code;
  if (!code) return [];
  const synthesized: any[] = [
    {
      id: 'synth-gen',
      eventType: 'BATCH_GENERATED',
      occurredAt: code.createdAt,
      docNo: code.batch?.batchNo,
      remark: `批次 ${code.batch?.batchNo || ''} 赋码生成`,
    },
  ];
  if (code.status && code.status !== 'GENERATED') {
    synthesized.push({
      id: 'synth-cur',
      eventType: code.status === 'IN_HQ_STOCK' ? 'HQ_INBOUND' : code.status,
      occurredAt: code.updatedAt || code.createdAt,
      remark: `当前状态：${statusLabel(code.status)}`,
    });
  }
  return synthesized.reverse();
});

const journeyStages = computed(() => {
  const code = timelineData.value?.code;
  const events: any[] = code?.events || [];
  const status: string = code?.status || '';
  const has = (t: string) => events.some((e) => e.eventType === t);

  const hqDone =
    has('HQ_INBOUND') ||
    ['IN_HQ_STOCK', 'IN_TRANSIT_TO_DEALER', 'IN_DEALER_STOCK', 'SOLD_TO_CLINIC', 'CONSUMED', 'UNPACKED'].includes(
      status,
    );
  const dealerDone =
    has('HQ_OUTBOUND') ||
    has('DEALER_INBOUND') ||
    Boolean(timelineData.value?.assignedDealer) ||
    ['IN_TRANSIT_TO_DEALER', 'IN_DEALER_STOCK', 'SOLD_TO_CLINIC', 'CONSUMED'].includes(status);
  const clinicDone =
    has('DEALER_OUTBOUND') ||
    Boolean(timelineData.value?.targetClinic) ||
    ['SOLD_TO_CLINIC', 'CONSUMED'].includes(status);
  const consumerDone = has('CONSUMER_VERIFIED') || (code?.verifyCount || 0) > 0;

  const activeKey = consumerDone
    ? 'consumer'
    : clinicDone
      ? 'clinic'
      : dealerDone
        ? 'dealer'
        : hqDone
          ? 'hq'
          : 'gen';

  const stateOf = (key: string, done: boolean) => (activeKey === key ? 'active' : done ? 'done' : 'idle');

  return [
    { key: 'gen', label: '出厂赋码', note: '工厂生成', state: stateOf('gen', true) },
    { key: 'hq', label: '总仓入库', note: hqDone ? '已入库' : '待入库', state: stateOf('hq', hqDone) },
    {
      key: 'dealer',
      label: '发往服务商',
      note: timelineData.value?.assignedDealer?.name || (dealerDone ? '已发往服务商' : '尚未出库'),
      state: stateOf('dealer', dealerDone),
    },
    {
      key: 'clinic',
      label: '终端机构',
      note: timelineData.value?.targetClinic?.name || (clinicDone ? '已售至机构' : '尚未到店'),
      state: stateOf('clinic', clinicDone),
    },
    {
      key: 'consumer',
      label: '顾客验真',
      note: consumerDone ? `已验 ${code?.verifyCount || 1} 次` : '待扫码',
      state: stateOf('consumer', consumerDone),
    },
  ] as any;
});

async function loadFlows(page = 1) {
  flowsLoading.value = true;
  try {
    flowData.value = (await api.get('/trace/flows', {
      params: {
        code: flowFilter.value.code.trim() || undefined,
        dealerId: flowFilter.value.dealerId || undefined,
        eventType: flowFilter.value.eventType || undefined,
        startDate: flowFilter.value.startDate || undefined,
        endDate: flowFilter.value.endDate || undefined,
        page,
        pageSize: flowData.value.pageSize,
      },
    })) as unknown as typeof flowData.value;
  } finally {
    flowsLoading.value = false;
  }
}

function resetFlowFilters() {
  flowFilter.value = { code: '', dealerId: '', eventType: '', startDate: '', endDate: '' };
  loadFlows(1);
}

async function exportFlowsCsv() {
  const token = localStorage.getItem('lumina_token');
  const params = new URLSearchParams();
  if (flowFilter.value.code.trim()) params.set('code', flowFilter.value.code.trim());
  if (flowFilter.value.dealerId) params.set('dealerId', flowFilter.value.dealerId);
  if (flowFilter.value.eventType) params.set('eventType', flowFilter.value.eventType);
  if (flowFilter.value.startDate) params.set('startDate', flowFilter.value.startDate);
  if (flowFilter.value.endDate) params.set('endDate', flowFilter.value.endDate);
  const resp = await fetch(`${API_BASE}/trace/flows/export?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trace_flows_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const batchPage = ref(1);
const batchPageSize = 20;
const batchTotal = ref(0);
const alertPage = ref(1);
const alertPageSize = 20;
const alertTotal = ref(0);
const batchCodesPage = ref(1);
const batchCodesPageSize = 50;
const batchCodesTotal = ref(0);
const activeBatchId = ref('');

async function loadBatches(p = batchPage.value) {
  if (!auth.isHQ) {
    batches.value = [];
    batchTotal.value = 0;
    return;
  }
  batchPage.value = p;
  const res = (await api.get('/trace/batches', { params: { page: p, pageSize: batchPageSize } })) as any;
  batches.value = Array.isArray(res) ? res : res.items || [];
  batchTotal.value = Array.isArray(res) ? res.length : Number(res.total || 0);
}

async function loadAlerts(p = alertPage.value) {
  alertPage.value = p;
  const res = (await api.get('/trace/alerts', { params: { page: p, pageSize: alertPageSize } })) as any;
  alerts.value = Array.isArray(res) ? res : res.items || [];
  alertTotal.value = Array.isArray(res) ? res.length : Number(res.total || 0);
}

async function loadAll() {
  const [, p, , orgs] = await Promise.all([
    loadBatches(batchPage.value),
    api.get('/products'),
    loadAlerts(alertPage.value),
    api.get('/orgs'),
  ]);
  products.value = p as unknown as any[];
  dealers.value = (orgs as unknown as any[]).filter((o) => o.type === 'DEALER');
  if (products.value.length && !batchForm.value.productId) {
    batchForm.value.productId = products.value[0].id;
  }
  await loadFlows(1);
}

function handleLiveScanRefresh() {
  loadAll();
  if (lookupCode.value.trim()) searchTimeline();
}

onMounted(async () => {
  await loadAll();
  window.addEventListener('lumina:scan-activity', handleLiveScanRefresh);
  const q = route.query.code as string | undefined;
  const qTab = route.query.tab as string | undefined;
  if (qTab && ['flows', 'batches', 'timeline', 'alerts'].includes(qTab)) {
    activeTab.value = qTab;
  }
  if (q) {
    activeTab.value = 'timeline';
    lookupCode.value = q;
    await searchTimeline();
  }
});

onUnmounted(() => {
  window.removeEventListener('lumina:scan-activity', handleLiveScanRefresh);
});

watch(
  () => route.query.code,
  async (q) => {
    if (typeof q === 'string' && q.trim()) {
      activeTab.value = 'timeline';
      lookupCode.value = q.trim();
      await searchTimeline();
    }
  },
);

async function submitBatch() {
  creating.value = true;
  try {
    const res = (await api.post('/trace/batches', batchForm.value)) as any;
    ElMessage.success(`已生成 ${res.unitCount} 个单品码、${res.cartonCount} 个外箱码`);
    batchDialog.value = false;
    await loadAll();
    if (res.batch?.id) openBatchCodes(res.batch.id);
  } finally {
    creating.value = false;
  }
}

async function loadBatchCodesPage(p = 1) {
  if (!activeBatchId.value) return;
  batchCodesPage.value = p;
  const res = (await api.get(`/trace/batches/${activeBatchId.value}/codes`, {
    params: { page: p, pageSize: batchCodesPageSize },
  })) as any;
  batchCodesData.value = res;
  batchCodesTotal.value = Number(res?.total ?? res?.codes?.length ?? 0);
}

async function openBatchCodes(batchId: string) {
  codeLevelFilter.value = 'ALL';
  codeSearch.value = '';
  activeBatchId.value = batchId;
  await loadBatchCodesPage(1);
  codesDialog.value = true;
}

async function openBatchPrint(row: any) {
  const data = (await api.get(`/trace/batches/${row.id}/codes`)) as any;
  qrPrintBatch.value = {
    batchNo: data.batch?.batchNo || row.batchNo,
    productName: data.batch?.product?.name || row.product?.name,
    skuCode: data.batch?.product?.skuCode || row.product?.skuCode,
    cartonQty: data.batch?.cartonQty || row.cartonQty || 6,
    codes: data.codes || [],
  };
  qrPrintDialog.value = true;
}

function openCurrentBatchPrint() {
  if (!batchCodesData.value?.batch) return;
  const b = batchCodesData.value.batch;
  qrPrintBatch.value = {
    batchNo: b.batchNo,
    productName: b.product?.name,
    skuCode: b.product?.skuCode,
    cartonQty: b.cartonQty || 6,
    codes: filteredBatchCodes.value,
  };
  qrPrintDialog.value = true;
}

async function downloadCsv(batchId: string, batchNo: string) {
  const token = localStorage.getItem('lumina_token');
  const resp = await fetch(`${API_BASE}/trace/batches/${batchId}/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${batchNo}_trace_codes.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function getVerifyBase() {
  if (import.meta.env.DEV) {
    return `http://${window.location.hostname}:5174${APP_BASE}/v`;
  }
  return `${window.location.origin}${APP_BASE}/v`;
}

async function openQrPreview(row: any) {
  const hostUrl = `${getVerifyBase()}/${row.codeToken}`;
  qrTarget.value = { ...row, verifyUrl: hostUrl };
  qrDataUrl.value = await QRCode.toDataURL(hostUrl, {
    width: 220,
    margin: 1,
    color: { dark: '#17211f', light: '#ffffff' },
  });
  qrDialog.value = true;
}

function openConsumerVerify(token?: string) {
  if (!token) return;
  window.open(`${getVerifyBase()}/${token}`, '_blank');
}

function copyToken(text?: string) {
  if (!text) return;
  navigator.clipboard?.writeText(text);
  ElMessage.success(`已复制：${text}`);
}

async function jumpTimeline(token: string) {
  codesDialog.value = false;
  activeTab.value = 'timeline';
  lookupCode.value = token;
  await searchTimeline();
}

async function searchTimeline() {
  const raw = lookupCode.value.trim().replace(/\s+/g, '');
  if (!raw) return;
  searching.value = true;
  try {
    timelineData.value = await api.get(`/trace/codes/${encodeURIComponent(raw)}/timeline`);
  } finally {
    searching.value = false;
  }
}

function openResolve(row: any) {
  activeAlert.value = row;
  resolutionText.value = '';
  resolveDialog.value = true;
}

async function submitResolve() {
  if (!resolutionText.value.trim()) return ElMessage.warning('请填写处置结论');
  await api.patch(`/trace/alerts/${activeAlert.value.id}/resolve`, {
    status: 'RESOLVED',
    resolution: resolutionText.value,
  });
  ElMessage.success('预警已结案');
  resolveDialog.value = false;
  await loadAll();
}

function eventLabel(t: string) {
  const m: Record<string, string> = {
    BATCH_GENERATED: '赋码建档',
    CARTON_BOUND: '外箱绑定关联',
    HQ_INBOUND: '总仓扫码入库',
    HQ_OUTBOUND: '出库绑定代理商',
    DEALER_INBOUND: '代理商收货入库',
    DEALER_OUTBOUND: '出库至终端机构',
    CARTON_UNPACKED: '外箱拆零解绑',
    RETURN_TO_DEALER: '退回代理商仓',
    RETURN_TO_HQ: '退回品牌总仓',
    CONSUMER_VERIFIED: '顾客扫码验真',
  };
  return m[t] || statusLabel(t);
}

function eventTone(t: string) {
  if (t === 'HQ_INBOUND' || t === 'DEALER_INBOUND') return 'brand';
  if (t === 'HQ_OUTBOUND' || t === 'DEALER_OUTBOUND') return 'warn';
  if (t === 'CONSUMER_VERIFIED') return 'ok';
  if (t === 'RETURN_TO_HQ' || t === 'RETURN_TO_DEALER') return 'bad';
  return 'muted';
}

function statusLabel(s: string) {
  const m: Record<string, string> = {
    GENERATED: '已生成待入库',
    IN_HQ_STOCK: '总仓在库',
    IN_TRANSIT_TO_DEALER: '发往服务商在途',
    IN_DEALER_STOCK: '服务商在库',
    SOLD_TO_CLINIC: '已售至机构',
    CONSUMED: '已验真核销',
    UNPACKED: '外箱已拆零',
    VOIDED: '已作废',
  };
  return m[s] || s;
}

function statusClass(s: string) {
  if (s === 'CONSUMED' || s === 'SOLD_TO_CLINIC') return 'ok';
  if (s === 'IN_HQ_STOCK' || s === 'IN_DEALER_STOCK') return 'brand';
  if (s === 'IN_TRANSIT_TO_DEALER' || s === 'UNPACKED') return 'warn';
  if (s === 'VOIDED') return 'bad';
  return 'muted';
}

function sevClass(s: string) {
  return s === 'CRITICAL' || s === 'HIGH' ? 'high' : 'medium';
}
</script>

<style scoped>
.plain-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
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
  font-size: 11.5px;
  color: var(--ink-3);
}

/* 流向追溯查询 */
.flow-filter-card {
  margin-bottom: 14px;
  padding: 14px 16px;
}
.flow-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.ff-input {
  width: 156px;
}
.ff-select {
  width: 150px;
}
.ff-select-sm {
  width: 122px;
}
.ff-date {
  width: 124px !important;
}
.ff-btns {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ff-btns :deep(.el-button + .el-button) {
  margin-left: 0;
}
.flow-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font-size: 12px;
  color: var(--ink-2);
}
.flow-summary strong {
  color: var(--brand-ink);
  font-weight: 600;
}
.fs-sep {
  color: var(--line-strong);
}
.flow-pager {
  padding: 0 14px 14px;
}

/* 移动端批次卡片 */
.mobile-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.m-batch-card {
  padding: 14px;
}
.mbc-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.mbc-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  margin-top: 6px;
}
.mbc-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-2);
  margin-top: 4px;
}
.mbc-remark {
  font-size: 12px;
  color: var(--ink-3);
  margin-top: 6px;
}
.mbc-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

/* 搜索 */
.trace-search {
  margin-bottom: 16px;
}
.ts-field {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 8px;
  padding: 6px 6px 6px 14px;
}
.ts-icon {
  color: var(--ink-3);
  flex-shrink: 0;
}
.ts-input {
  flex: 1;
  border: 0;
  outline: none;
  font-size: 14px;
  letter-spacing: 0.04em;
  background: transparent;
  min-width: 0;
}
.ts-input::placeholder {
  font-family: var(--font-ui);
  letter-spacing: 0;
  color: var(--ink-3);
}
.ts-btn {
  border: 0;
  background: var(--brand);
  color: #fff;
  border-radius: 5px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  flex-shrink: 0;
}
.ts-btn:hover {
  background: var(--brand-ink);
}
.ts-hint {
  display: block;
  font-size: 11.5px;
  color: var(--ink-3);
  margin-top: 7px;
  padding-left: 4px;
}

/* 码摘要 */
.code-hero {
  display: flex;
  justify-content: space-between;
  gap: 18px 24px;
  background: #111827;
  color: #f8fafc;
  border-radius: var(--radius-md);
  padding: 22px 24px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  box-shadow: var(--shadow-md);
}
.ch-left {
  min-width: 0;
  flex: 1 1 260px;
}
.ch-kicker {
  font-size: 11.5px;
  color: #94a3b8;
  letter-spacing: 0.04em;
}
.ch-dot {
  margin: 0 5px;
}
.ch-ok {
  color: #d1d5db;
  font-weight: 600;
}
.ch-bad {
  color: #fda4af;
  font-weight: 600;
}
.ch-token {
  font-size: clamp(17px, 2.4vw, 23px);
  letter-spacing: 0.07em;
  margin-top: 8px;
  color: #ffffff;
  font-weight: 700;
  word-break: break-all;
  cursor: pointer;
}
.ch-product {
  font-size: 13.5px;
  color: #cbd5e1;
  margin-top: 8px;
}
.ch-sku {
  margin-left: 8px;
  color: #94a3b8;
  font-size: 12px;
}
.ch-right {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-end;
  gap: 14px;
}
.ch-stats {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}
.ch-stat {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ch-stat-label {
  font-size: 11px;
  color: #94a3b8;
}
.ch-stat-value {
  font-size: 14.5px;
  color: #ffffff;
  font-weight: 600;
}
.ch-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.ch-action-btn {
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.08);
  color: #f1f5f9;
  border-radius: 8px;
  padding: 6px 13px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.ch-action-btn:hover {
  background: rgba(255, 255, 255, 0.16);
}
.ch-action-btn.primary {
  background: var(--brand);
  border-color: var(--brand);
  color: #ffffff;
}
.ch-action-btn.primary:hover {
  background: var(--brand-hover);
}

.relation-card {
  margin-bottom: 14px;
}
.relation-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.chain-wrap {
  margin-bottom: 14px;
}

/* 时间轴 */
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
}
.tl-item {
  display: flex;
  gap: 14px;
}
.tl-rail {
  width: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  padding-top: 5px;
}
.tl-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1.5px solid var(--line-strong);
  background: var(--surface);
  flex-shrink: 0;
}
.tl-dot.latest {
  border-color: var(--brand);
  background: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-tint);
}
.tl-line {
  flex: 1;
  width: 1px;
  background: var(--line);
  margin: 4px 0 0;
  min-height: 30px;
}
.tl-body {
  flex: 1;
  padding-bottom: 14px;
  min-width: 0;
}
.tl-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.tl-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
}
.tl-time {
  font-size: 11.5px;
  color: var(--ink-3);
  flex-shrink: 0;
}
.tl-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-2);
  margin-top: 4px;
  flex-wrap: wrap;
}

/* 空态 */
.trace-empty {
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-md);
  padding: 48px 24px;
  text-align: center;
  background: var(--surface-2);
}
.te-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}
.te-desc {
  font-size: 12.5px;
  color: var(--ink-2);
  margin-top: 8px;
  line-height: 1.7;
  max-width: 44ch;
  margin-left: auto;
  margin-right: auto;
}

/* 批次码弹窗 */
.batch-meta-bar {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 9px 12px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  margin-bottom: 12px;
}
.bm-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.bm-sku {
  font-size: 11.5px;
  color: var(--ink-3);
}
.bm-stat {
  margin-left: auto;
  font-size: 12px;
  color: var(--ink-2);
}
.codes-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.codes-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1 1 280px;
}
.mini-seg {
  display: inline-flex;
  padding: 2px;
  background: var(--surface-3);
  border-radius: 6px;
  gap: 2px;
}
.mini-seg button {
  border: 0;
  background: transparent;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--ink-2);
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
.mini-seg button.on {
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(23, 33, 31, 0.06);
}
.code-search-input {
  width: 210px;
  max-width: 100%;
}
.codes-table-scroll {
  max-height: 440px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.parent-link {
  border: 0;
  background: transparent;
  padding: 0;
  font-size: 12px;
  color: var(--ink-2);
  cursor: pointer;
  white-space: nowrap;
}
.parent-link:hover {
  color: var(--brand);
  text-decoration: underline;
}

/* 移动端码明细卡片 */
.mobile-codes-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 55vh;
  overflow-y: auto;
  padding-right: 2px;
}
.mc-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-2);
  padding: 11px 12px;
}
.mc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mc-code-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding: 7px 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: pointer;
}
.mc-token {
  font-size: 13px;
  font-weight: 600;
  color: var(--brand-ink);
  word-break: break-all;
}
.mc-copy {
  font-size: 11px;
  color: var(--brand);
  flex-shrink: 0;
}
.mc-parent {
  font-size: 11.5px;
  color: var(--ink-3);
  margin-top: 6px;
}
.mc-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 10px;
}
.mc-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

/* 二维码弹窗 */
.qr-wrap {
  text-align: center;
}
.qr-badge-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.qr-prod {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.qr-img {
  width: 196px;
  height: 196px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px;
  background: #fff;
}
.qr-token {
  margin-top: 10px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--ink);
  cursor: pointer;
}
.qr-url {
  font-size: 11px;
  color: var(--ink-2);
  margin-top: 8px;
  padding: 6px 8px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  word-break: break-all;
  cursor: pointer;
}
.qr-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 14px;
}
.resolve-head {
  font-size: 13.5px;
  font-weight: 600;
  margin-bottom: 12px;
  line-height: 1.5;
}

/* 状态标签 */
.level-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--ink-2);
  white-space: nowrap;
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
.code-status-pill {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 3px;
  border: 1px solid transparent;
  white-space: nowrap;
}
.code-status-pill.ok {
  background: var(--jade-tint);
  border-color: #cfe0d3;
  color: var(--jade);
}
.code-status-pill.brand {
  background: var(--brand-tint);
  border-color: var(--brand-line);
  color: var(--brand-ink);
}
.code-status-pill.warn {
  background: var(--ochre-tint);
  border-color: #e6d5ae;
  color: var(--ochre);
}
.code-status-pill.bad {
  background: var(--seal-tint);
  border-color: var(--seal-line);
  color: var(--seal);
}
.code-status-pill.muted {
  background: var(--surface-3);
  border-color: var(--line);
  color: var(--ink-3);
}

.sev {
  font-size: 10.5px;
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid transparent;
}
.sev.high {
  background: var(--seal-tint);
  color: var(--seal);
  border-color: var(--seal-line);
}
.sev.medium {
  background: var(--ochre-tint);
  color: var(--ochre);
  border-color: #e6d5ae;
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

@media (max-width: 720px) {
  .ff-input,
  .ff-select,
  .ff-select-sm,
  .ff-date {
    width: 100% !important;
  }
  .ff-btns {
    width: 100%;
  }
  .code-hero {
    padding: 16px;
  }
  .ch-right {
    width: 100%;
    align-items: flex-start;
  }
  .bm-stat {
    margin-left: 0;
    width: 100%;
  }
  .code-search-input {
    width: 100%;
  }
}
</style>
