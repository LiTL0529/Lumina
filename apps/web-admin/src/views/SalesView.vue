<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">出库与打单</h1>
        <p class="page-subtitle">扫码出库绑定代理商 / 机构与联单打印</p>
      </div>
      <div class="page-actions">
        <el-button @click="returnDialog = true">退货回仓</el-button>
        <el-button type="primary" @click="openCreateOrder">新建供货单</el-button>
      </div>
    </div>

    <div class="filter-row">
      <div class="segmented">
        <button
          v-for="f in filters"
          :key="f.value"
          type="button"
          :class="{ on: statusFilter === f.value }"
          @click="onStatusFilter(f.value)"
        >
          {{ f.label }}
          <span class="seg-count">{{ countByStatus(f.value) }}</span>
        </button>
      </div>
      <span class="filter-hint">红色为低于供货红线，需总部特批后出库</span>
    </div>

    <div v-if="!isMobile" class="surface-card flush">
      <div class="bulk-bar">
        <div class="bulk-left">
          <span class="bulk-count">已选 <strong>{{ orderSelection.length }}</strong> 项 · 共 {{ salesTotal }} 单</span>
        </div>
        <div class="bulk-right">
          <el-button size="small" :disabled="!orderSelection.length" @click="startBatchPrint">批量打印出库联单</el-button>
          <el-button size="small" @click="exportOrdersCsv">导出 CSV</el-button>
        </div>
      </div>
      <el-table
        :data="filteredOrders"
        size="small"
        style="width: 100%"
        row-key="id"
        empty-text="当前筛选下没有单据"
        @selection-change="(rows: any[]) => (orderSelection = rows)"
      >
        <el-table-column type="selection" width="40" />
        <el-table-column label="单号 / 场景" width="144">
          <template #default="{ row }">
            <div class="mono cell-doc">{{ row.docNo }}</div>
            <div class="cell-sub">{{ row.orderScene === 'HQ_TO_DEALER' ? '总仓 → 服务商' : '服务商 → 机构' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="客户 / 收货方" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="cell-strong ellipsis-line" :title="row.buyerOrg?.name || row.clinic?.name">{{ row.buyerOrg?.name || row.clinic?.name || '—' }}</div>
            <div class="cell-sub ellipsis-line" :title="row.warehouse?.name">仓：{{ row.warehouse?.name }}</div>
          </template>
        </el-table-column>
        <el-table-column label="商品与出库进度" min-width="152">
          <template #default="{ row }">
            <div v-for="it in row.items" :key="it.id" class="item-line">
              <span class="item-name" :title="it.product.name">{{ it.product.name }}</span>
              <span v-if="it.isGift" class="gift-tag">赠</span>
              <span class="mono item-qty">{{ it.outboundQty }}/{{ it.qty }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="折率" width="66" align="right">
          <template #default="{ row }">
            <span
              class="fold"
              :class="{ danger: Number(row.compositeDiscountRatio) < 0.35 }"
            >
              {{ (Number(row.compositeDiscountRatio) * 10).toFixed(2) }}折
            </span>
          </template>
        </el-table-column>
        <el-table-column label="应收" width="88" align="right">
          <template #default="{ row }"><span class="mono">¥{{ Number(row.totalAmount).toFixed(2) }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="76">
          <template #default="{ row }">
            <span class="status-pill" :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="184" align="right" :fixed="width <= 1200 ? false : 'right'">
          <template #default="{ row }">
            <div class="table-actions">
              <el-button
                v-if="row.status === 'PENDING_OUTBOUND' || row.status === 'PARTIAL_OUTBOUND'"
                size="small"
                type="primary"
                @click="openOutbound(row)"
              >
                扫码出库
              </el-button>
              <el-button
                v-if="auth.isHQ && row.status === 'PENDING_APPROVAL'"
                size="small"
                type="warning"
                plain
                @click="approveOrder(row)"
              >
                特批放行
              </el-button>
              <el-button size="small" link type="primary" @click="openOrderCodes(row)">码归属</el-button>
              <el-button size="small" link @click="openPrint(row.id)">
                打单{{ row.printCount ? ` ${row.printCount}` : '' }}
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div class="table-pager">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="salesTotal"
          :page-size="salesPageSize"
          :current-page="salesPage"
          @current-change="(p: number) => loadSalesOrders(p)"
        />
      </div>
    </div>

    <!-- 移动端订单卡片 -->
    <div v-else class="mobile-orders">
      <div v-if="!filteredOrders.length" class="surface-card empty-line">当前筛选下没有单据</div>
      <article v-for="row in filteredOrders" :key="row.id" class="surface-card mo-card">
        <div class="mo-top">
          <div>
            <div class="mono cell-doc">{{ row.docNo }}</div>
            <div class="cell-sub">{{ row.orderScene === 'HQ_TO_DEALER' ? '总仓 → 服务商' : '服务商 → 机构' }}</div>
          </div>
          <span class="status-pill" :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span>
        </div>
        <div class="mo-buyer">{{ row.buyerOrg?.name || row.clinic?.name || '—' }}</div>
        <div class="cell-sub">出库仓：{{ row.warehouse?.name }}</div>
        <div class="mo-items">
          <div v-for="it in row.items" :key="it.id" class="item-line">
            <span class="item-name">{{ it.product.name }}</span>
            <span v-if="it.isGift" class="gift-tag">赠</span>
            <span class="mono item-qty">{{ it.outboundQty }}/{{ it.qty }}</span>
          </div>
        </div>
        <div class="mo-summary">
          <span class="fold" :class="{ danger: Number(row.compositeDiscountRatio) < 0.35 }">
            综合 {{ (Number(row.compositeDiscountRatio) * 10).toFixed(2) }} 折
          </span>
          <span class="mono mo-amount">¥{{ Number(row.totalAmount).toFixed(2) }}</span>
        </div>
        <div class="mo-actions">
          <el-button
            v-if="row.status === 'PENDING_OUTBOUND' || row.status === 'PARTIAL_OUTBOUND'"
            size="small"
            type="primary"
            @click="openOutbound(row)"
          >
            扫码出库
          </el-button>
          <el-button
            v-if="auth.isHQ && row.status === 'PENDING_APPROVAL'"
            size="small"
            type="warning"
            plain
            @click="approveOrder(row)"
          >
            特批放行
          </el-button>
          <el-button size="small" plain type="primary" @click="openOrderCodes(row)">码归属</el-button>
          <el-button size="small" @click="openPrint(row.id)">
            打单{{ row.printCount ? ` ${row.printCount}` : '' }}
          </el-button>
        </div>
      </article>
    </div>

    <!-- 退货记录 -->
    <section class="surface-card returns-card">
      <div class="section-header">
        <div>
          <h2 class="section-title">退货回仓</h2>
          <span class="section-note">退回的码自动解除下游归属、恢复在库，可继续出货</span>
        </div>
        <el-button link type="primary" @click="returnDialog = true">登记退货</el-button>
      </div>

      <div v-if="!returnOrders.length" class="empty-line">还没有退货记录。</div>
      <el-table v-else :data="returnOrders" size="small">
        <el-table-column prop="docNo" label="退货单号" width="160">
          <template #default="{ row }"><span class="mono">{{ row.docNo }}</span></template>
        </el-table-column>
        <el-table-column label="退回仓库" width="150">
          <template #default="{ row }">{{ row.warehouse?.name }}</template>
        </el-table-column>
        <el-table-column label="退货机构" width="160">
          <template #default="{ row }">{{ row.clinic?.name || '—' }}</template>
        </el-table-column>
        <el-table-column label="退回码" min-width="280">
          <template #default="{ row }">
            <div v-for="it in row.items" :key="it.id" class="item-line">
              <span>{{ it.product.name }} × {{ it.qty }}</span>
              <span class="mono cell-sub">{{ (it.returnedCodes || []).join(', ') }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="退款" width="110" align="right">
          <template #default="{ row }"><span class="mono">¥{{ Number(row.totalRefundAmount).toFixed(2) }}</span></template>
        </el-table-column>
      </el-table>
      <div class="table-pager">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="returnTotal"
          :page-size="returnPageSize"
          :current-page="returnPage"
          @current-change="(p: number) => loadReturnOrders(p)"
        />
      </div>
    </section>

    <!-- ================= 扫码出库作业层 ================= -->
    <Teleport to="body">
      <div v-if="outboundOpen" class="desk-layer">
        <header class="dl-head">
          <div class="dl-head-left">
            <span class="dl-kicker">扫码出库作业</span>
            <div class="dl-title-row">
              <h2 class="mono dl-doc">{{ activeOutboundOrder?.docNo }}</h2>
              <span class="dl-target">{{ activeOutboundOrder?.buyerOrg?.name || activeOutboundOrder?.clinic?.name }}</span>
            </div>
            <div class="dl-sub">
              出库仓 {{ activeOutboundOrder?.warehouse?.name }} ·
              扫外箱码整箱出库，扫盒码单盒出库，系统自动拆箱并防重复扫
            </div>
          </div>
          <button class="dl-close" type="button" @click="closeOutbound">关闭 Esc</button>
        </header>

        <div class="dl-body">
          <section class="dl-main">
            <div class="stage">
              <div class="stage-head">
                <span class="stage-title">扫码口</span>
                <div class="stage-head-right">
                  <span class="stage-sub">USB 扫码枪免点击盲扫 · 或手工输入防伪码回车录入</span>
                </div>
              </div>
              <input
                ref="outScanRef"
                v-model="outScanInput"
                class="stage-input mono"
                placeholder="扫描箱码 / 盒码"
                autocomplete="off"
                @keyup.enter="handleOutScan"
              />
              <div class="stage-foot">
                <span class="kbd-hint"><kbd>Enter</kbd> 校验加入</span>
                <span class="kbd-hint"><kbd>F4</kbd> 确认出库</span>
                <span class="stage-mode">待出 {{ totalRemaining }} 盒</span>
              </div>
            </div>

            <div class="last-scan" :class="outLast?.ok === false ? 'fail' : outLast ? 'ok' : 'idle'">
              <template v-if="outLast">
                <div class="ls-mark">{{ outLast.ok ? '✓' : '✕' }}</div>
                <div class="ls-body">
                  <div class="ls-title">{{ outLast.ok ? outLast.productName : outLast.message }}</div>
                  <div class="ls-meta">
                    <template v-if="outLast.ok">
                      <span class="mono">{{ outLast.token }}</span>
                      <span>{{ outLast.codeLevel === 'CARTON' ? '外箱' : '单盒' }}</span>
                      <span class="ls-qty">+{{ outLast.unitCount }} 盒</span>
                    </template>
                    <template v-else>请核对订单商品与仓库</template>
                  </div>
                </div>
              </template>
              <template v-else>
                <div class="ls-mark idle">·</div>
                <div class="ls-body">
                  <div class="ls-title idle">等待扫描</div>
                  <div class="ls-meta">扫到的码会核对商品、库存与待出数量，不匹配立即拦截。</div>
                </div>
              </template>
            </div>

            <div class="dl-list">
              <div class="list-head">
                <span>本次已扫 {{ outScanned.length }} 次 · {{ totalScanned }} 盒</span>
                <button v-if="outScanned.length" class="link-danger" type="button" @click="outScanned = []">
                  清空
                </button>
              </div>
              <el-table :data="outScanned" size="small" max-height="360" empty-text="还没有扫描">
                <el-table-column prop="token" label="防伪码" width="185">
                  <template #default="{ row }"><span class="code-chip">{{ row.token }}</span></template>
                </el-table-column>
                <el-table-column label="级别" width="76">
                  <template #default="{ row }">
                    <span class="level-tag" :class="row.codeLevel === 'CARTON' ? 'carton' : 'unit'">
                      {{ row.codeLevel === 'CARTON' ? '外箱' : '单盒' }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column prop="productName" label="商品" min-width="170" />
                <el-table-column label="盒数" width="70" align="right">
                  <template #default="{ row }"><strong class="mono">{{ row.unitCount }}</strong></template>
                </el-table-column>
                <el-table-column label="" width="56" align="right">
                  <template #default="{ $index }">
                    <el-button link type="danger" size="small" @click="outScanned.splice($index, 1)">删</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </section>

          <aside class="dl-side">
            <div class="side-head">订单进度</div>
            <div class="progress-list">
              <div v-for="p in orderProgress" :key="p.id" class="progress-row">
                <div class="pr-top">
                  <span class="pr-name">{{ p.product.name }}</span>
                  <span class="pr-num mono">{{ p.done }}/{{ p.qty }}</span>
                </div>
                <div class="pr-bar">
                  <span :style="{ width: `${Math.min(100, (p.done / p.qty) * 100)}%` }" :class="{ full: p.done >= p.qty }" />
                </div>
                <div class="pr-meta">
                  已出 {{ p.outboundQty }} · 本次 {{ p.scanned }} · 待出
                  <strong :class="{ done: p.remaining === 0 }">{{ p.remaining }}</strong>
                </div>
              </div>
            </div>

            <div class="side-tracking">
              <label class="st-label">物流单号（可选）</label>
              <el-input v-model="outTrackingNo" size="small" placeholder="打印联单时自动带出" />
            </div>

            <div class="side-summary">
              <div class="ss-row">
                <span>本单应收</span>
                <span class="num ss-amount">¥{{ Number(activeOutboundOrder?.totalAmount || 0).toFixed(2) }}</span>
              </div>
              <div class="ss-row">
                <span>本次出库</span>
                <span class="num">{{ totalScanned }} 盒 / {{ outScanned.length }} 码</span>
              </div>
            </div>

            <div class="side-actions">
              <el-button style="width: 100%" @click="closeOutbound">暂存并关闭</el-button>
              <el-button
                style="width: 100%; margin: 8px 0 0"
                type="primary"
                :disabled="!outScanned.length"
                :loading="submittingOut"
                @click="confirmOutbound"
              >
                确认出库并打印联单
              </el-button>
            </div>
            <p class="side-note">
              确认后，这批码立即归属到「{{ activeOutboundOrder?.buyerOrg?.name || activeOutboundOrder?.clinic?.name }}」名下，并写入不可篡改的流向时间轴。
            </p>
          </aside>
        </div>
      </div>
    </Teleport>

    <!-- 出库码归属抽屉 -->
    <el-drawer v-model="codesDrawer" :size="isMobile ? '100%' : '580px'" :with-header="false">
      <div class="drawer-inner">
        <div class="drawer-head">
          <div>
            <div class="drawer-kicker">出库码归属</div>
            <div class="drawer-title mono">{{ codesData?.order.docNo }}</div>
            <div class="drawer-sub">
              归属到
              <strong>{{ codesData?.order.ownerName || '—' }}</strong>
              <span v-if="codesData?.order.ownerType === 'DEALER'" class="owner-tag">服务商</span>
              <span v-else class="owner-tag clinic">机构</span>
            </div>
          </div>
          <button class="drawer-close" type="button" @click="codesDrawer = false">×</button>
        </div>

        <div v-if="codesLoading" class="empty-line">正在读取码明细…</div>
        <template v-else-if="codesData">
          <div class="code-summary">
            <div class="cs-cell">
              <span class="cs-label">总码数</span>
              <span class="cs-value num">{{ codesData.summary.totalCodes }}</span>
            </div>
            <div class="cs-cell">
              <span class="cs-label">外箱码</span>
              <span class="cs-value num">{{ codesData.summary.cartonCodes }}</span>
            </div>
            <div class="cs-cell">
              <span class="cs-label">单品码</span>
              <span class="cs-value num">{{ codesData.summary.unitCodes }}</span>
            </div>
          </div>

          <div v-if="!codesData.codes.length" class="empty-line">
            该单还没有扫码出库记录。扫码出库后，这里会列出归属到客户名下的每一个码。
          </div>

          <template v-else>
            <div class="drawer-tools">
              <el-button size="small" @click="copyAllCodes">复制全部码</el-button>
              <el-button size="small" @click="exportCodesCsv">导出 CSV</el-button>
            </div>
            <el-table :data="codesData.codes" size="small" style="width: 100%" max-height="520">
              <el-table-column label="防伪码" min-width="195">
                <template #default="{ row }">
                  <span class="code-chip clickable" title="点击复制防伪码" @click="copySingleCode(row.token)">
                    {{ formatCodeGroups(row.token) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="商品" min-width="135">
                <template #default="{ row }">
                  <div>{{ row.productName }}</div>
                  <div class="cell-sub mono">{{ row.skuCode }}</div>
                </template>
              </el-table-column>
              <el-table-column label="级别" width="66">
                <template #default="{ row }">
                  <span class="level-tag" :class="row.codeLevel === 'CARTON' ? 'carton' : 'unit'">
                    {{ row.codeLevel === 'CARTON' ? '外箱' : '单盒' }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="验真" width="70" align="right">
                <template #default="{ row }">
                  <span class="mono" :class="{ muted: !row.verifyCount }">{{ row.verifyCount || 0 }} 次</span>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </template>
      </div>
    </el-drawer>

    <!-- 新建供货单 -->
    <el-dialog v-model="createDialog" title="新建供货单" width="min(900px, 94vw)" top="3vh">
      <el-form :model="orderForm" :label-width="isMobile ? 'auto' : '86px'" :label-position="isMobile ? 'top' : 'right'">
        <div class="form-grid-3">
          <el-form-item label="业务场景" required>
            <el-select v-model="orderForm.orderScene" style="width: 100%">
              <el-option v-if="auth.isHQ" label="总仓 → 服务商" value="HQ_TO_DEALER" />
              <el-option label="服务商 → 终端机构" value="DEALER_TO_CLINIC" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="orderForm.orderScene === 'HQ_TO_DEALER'" label="目标服务商" required>
            <el-select v-model="orderForm.buyerOrgId" style="width: 100%" placeholder="选择服务商">
              <el-option
                v-for="d in dealers"
                :key="d.id"
                :label="`${d.name}${d.supplyFrozen ? '（已停供）' : ''}`"
                :value="d.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-else label="终端机构" required>
            <el-select v-model="orderForm.clinicId" style="width: 100%" placeholder="选择已绑定机构">
              <el-option v-for="c in clinics" :key="c.id" :label="`${c.name}（${c.city}）`" :value="c.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="出库仓库" required>
            <el-select v-model="orderForm.warehouseId" style="width: 100%">
              <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
            </el-select>
          </el-form-item>
        </div>

        <div class="line-table">
          <div class="lt-head">
            <span>商品</span>
            <span>数量</span>
            <span>单价</span>
            <span>折扣%</span>
            <span>赠品</span>
            <span class="lt-amount">小计</span>
            <span />
          </div>
          <div v-for="(row, idx) in orderForm.items" :key="idx" class="lt-row">
            <el-select v-model="row.productId" size="small" @change="onPickProduct(row)">
              <el-option v-for="p in products" :key="p.id" :label="`${p.name}（指导 ¥${p.retailPrice}）`" :value="p.id" />
            </el-select>
            <el-input-number v-model="row.qty" :min="1" size="small" controls-position="right" @change="runRedlinePreview" />
            <el-input-number v-model="row.unitPrice" :min="0" :precision="2" size="small" controls-position="right" @change="runRedlinePreview" />
            <el-input-number
              v-model="row.discountPercent"
              :min="0"
              :max="100"
              size="small"
              :disabled="row.isGift"
              controls-position="right"
              @change="runRedlinePreview"
            />
            <el-checkbox v-model="row.isGift" @change="runRedlinePreview" />
            <span class="mono lt-amount">
              ¥{{ row.isGift ? '0.00' : ((row.qty * row.unitPrice * row.discountPercent) / 100).toFixed(2) }}
            </span>
            <el-button link type="danger" size="small" @click="removeOrderLine(idx)">删</el-button>
          </div>
          <button class="add-line" type="button" @click="addOrderLine">+ 添加商品行（可勾选赠品验证红线防绕过）</button>
        </div>

        <div class="form-grid-4">
          <el-form-item label="抹零">
            <el-input-number v-model="orderForm.roundingAmount" :min="0" :precision="2" size="small" style="width: 100%" @change="runRedlinePreview" />
          </el-form-item>
          <el-form-item label="运费">
            <el-input-number v-model="orderForm.otherFee" :min="0" :precision="2" size="small" style="width: 100%" />
          </el-form-item>
          <el-form-item label="实收">
            <el-input-number v-model="orderForm.paidAmount" :min="0" :precision="2" size="small" style="width: 100%" />
          </el-form-item>
          <el-form-item label="发货方式">
            <el-input v-model="orderForm.shippingMethod" size="small" />
          </el-form-item>
        </div>

        <div v-if="redlinePreview" class="redline-banner" :class="redlinePreview.passed ? 'pass' : 'fail'">
          <div>
            <strong>{{ redlinePreview.passed ? '3.5 折供货红线校验通过' : '触发 3.5 折供货红线' }}</strong>
            <span class="mono" style="margin-left: 10px">
              综合折率 {{ (redlinePreview.compositeRatio * 10).toFixed(2) }} 折（指导 ¥{{ redlinePreview.totalRetailValue }} / 折算 ¥{{ redlinePreview.totalNetReceivable }}）
            </span>
            <div v-for="(v, i) in redlinePreview.violations" :key="i" class="rv-line">· {{ v.message }}</div>
          </div>
          <el-checkbox v-if="!redlinePreview.passed" v-model="orderForm.requestSpecialApproval">
            发起总部特批
          </el-checkbox>
        </div>
      </el-form>

      <template #footer>
        <el-button @click="createDialog = false">取消</el-button>
        <el-button @click="submitOrder(true)">存草稿</el-button>
        <el-button type="primary" :loading="savingOrder" @click="submitOrder(false)">
          {{ redlinePreview && !redlinePreview.passed && orderForm.requestSpecialApproval ? '提交总部特批' : '提交并推送仓库' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 退货 -->
    <el-dialog v-model="returnDialog" title="退货回仓" width="min(560px, 94vw)" align-center>
      <el-form :model="returnForm" :label-width="isMobile ? 'auto' : '96px'" :label-position="isMobile ? 'top' : 'right'">
        <el-form-item label="退回仓库" required>
          <el-select v-model="returnForm.warehouseId" style="width: 100%">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="原销售单号">
          <el-input v-model="returnForm.originalSalesNo" placeholder="选填，便于溯源" />
        </el-form-item>
        <el-form-item label="退回单品码" required>
          <el-input
            v-model="returnForm.codesText"
            type="textarea"
            :rows="4"
            placeholder="扫码或粘贴退货盒码，每行一个或用逗号分隔"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="returnDialog = false">取消</el-button>
        <el-button type="primary" @click="submitReturn">确认回仓</el-button>
      </template>
    </el-dialog>

    <PrintOrderModal v-model="printVisible" :order-id="printOrderId" @printed="loadAll" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';
import { formatCodeGroups, useViewport } from '../utils/format';
import PrintOrderModal from '../components/PrintOrderModal.vue';
import { playScanBeep, speakWarehouseVoice, useBarcodeScanner } from '../composables/useBarcodeScanner';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { width } = useViewport();
const isMobile = computed(() => width.value <= 720);
const isCompact = computed(() => width.value <= 960);

const salesOrders = ref<any[]>([]);
const returnOrders = ref<any[]>([]);
const dealers = ref<any[]>([]);
const clinics = ref<any[]>([]);
const warehouses = ref<any[]>([]);
const products = ref<any[]>([]);
const statusFilter = ref('ALL');

const createDialog = ref(false);
const savingOrder = ref(false);
const redlinePreview = ref<any>(null);
const orderForm = ref({
  orderScene: auth.isHQ ? 'HQ_TO_DEALER' : 'DEALER_TO_CLINIC',
  buyerOrgId: '',
  clinicId: '',
  warehouseId: '',
  roundingAmount: 0,
  otherFee: 0,
  paidAmount: 0,
  shippingMethod: '物流发货',
  requestSpecialApproval: false,
  items: [{ productId: '', qty: 2, unitPrice: 880, discountPercent: 40, isGift: false }],
});

/* ---------- 出库作业 ---------- */
const outboundOpen = ref(false);
const activeOutboundOrder = ref<any>(null);
const outScanInput = ref('');
const outScanRef = ref<HTMLInputElement | null>(null);
const outScanned = ref<any[]>([]);
const outLast = ref<any>(null);
const outTrackingNo = ref('');
const submittingOut = ref(false);

/* ---------- 码归属 ---------- */
const codesDrawer = ref(false);
const codesLoading = ref(false);
const codesData = ref<any>(null);

/* ---------- 退货 / 打印 ---------- */
const returnDialog = ref(false);
const returnForm = ref({ warehouseId: '', originalSalesNo: '', codesText: '' });
const printVisible = ref(false);
const printOrderId = ref<string | null>(null);
const orderSelection = ref<any[]>([]);
const printQueue = ref<string[]>([]);

function startBatchPrint() {
  const ids = orderSelection.value.map((o) => o.id);
  if (!ids.length) return;
  printQueue.value = ids.slice(1);
  printOrderId.value = ids[0];
  printVisible.value = true;
  if (ids.length > 1) ElMessage.info(`共 ${ids.length} 张联单，关闭当前联单后自动打开下一张`);
}

watch(printVisible, (open) => {
  if (!open && printQueue.value.length) {
    const next = printQueue.value.shift() as string;
    setTimeout(() => {
      printOrderId.value = next;
      printVisible.value = true;
    }, 180);
  }
});

function exportOrdersCsv() {
  const list = orderSelection.value.length ? orderSelection.value : filteredOrders.value;
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['单号', '场景', '客户', '数量', '应收', '状态', '日期'];
  const rows = list.map((o: any) =>
    [
      o.docNo,
      o.orderScene === 'HQ_TO_DEALER' ? '总仓→服务商' : '服务商→机构',
      o.buyerOrg?.name || o.clinic?.name || '',
      (o.items || []).reduce((s: number, i: any) => s + Number(i.qty || 0), 0),
      Number(o.totalAmount).toFixed(2),
      statusLabel(o.status),
      String(o.bizDate || o.createdAt || '').slice(0, 10),
    ]
      .map(esc)
      .join(','),
  );
  const blob = new Blob([`\ufeff${header.join(',')}\n${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lumina-sales-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
const filters = [
  { label: '全部', value: 'ALL' },
  { label: '待出库', value: 'PENDING_OUTBOUND' },
  { label: '待特批', value: 'PENDING_APPROVAL' },
  { label: '已完成', value: 'COMPLETED' },
];

const filteredOrders = computed(() => {
  if (statusFilter.value === 'ALL') return salesOrders.value;
  if (statusFilter.value === 'PENDING_OUTBOUND') {
    return salesOrders.value.filter((o) => ['PENDING_OUTBOUND', 'PARTIAL_OUTBOUND'].includes(o.status));
  }
  return salesOrders.value.filter((o) => o.status === statusFilter.value);
});

const orderProgress = computed(() => {
  const order = activeOutboundOrder.value;
  if (!order) return [];
  return order.items.map((it: any) => {
    const scanned = outScanned.value
      .filter((s) => s.productId === it.productId)
      .reduce((a, b) => a + b.unitCount, 0);
    const remaining = Math.max(0, it.qty - it.outboundQty - scanned);
    return {
      id: it.id,
      product: it.product,
      qty: it.qty,
      outboundQty: it.outboundQty,
      scanned,
      remaining,
      done: Math.min(it.qty, it.outboundQty + scanned),
    };
  });
});

const totalScanned = computed(() => outScanned.value.reduce((s: number, i: any) => s + i.unitCount, 0));
const totalRemaining = computed(() => orderProgress.value.reduce((s: number, p: any) => s + p.remaining, 0));

const salesPage = ref(1);
const salesPageSize = 20;
const salesTotal = ref(0);
const returnPage = ref(1);
const returnPageSize = 20;
const returnTotal = ref(0);

function statusQueryParam() {
  if (statusFilter.value === 'ALL') return undefined;
  if (statusFilter.value === 'PENDING_OUTBOUND') return 'PENDING_OUTBOUND,PARTIAL_OUTBOUND';
  return statusFilter.value;
}

async function loadSalesOrders(p = salesPage.value) {
  salesPage.value = p;
  const res = (await api.get('/sales-orders', {
    params: { status: statusQueryParam(), page: p, pageSize: salesPageSize },
  })) as any;
  salesOrders.value = Array.isArray(res) ? res : res.items || [];
  salesTotal.value = Array.isArray(res) ? res.length : Number(res.total || 0);
}

async function loadReturnOrders(p = returnPage.value) {
  returnPage.value = p;
  const res = (await api.get('/return-orders', {
    params: { page: p, pageSize: returnPageSize },
  })) as any;
  returnOrders.value = Array.isArray(res) ? res : res.items || [];
  returnTotal.value = Array.isArray(res) ? res.length : Number(res.total || 0);
}

async function onStatusFilter(val: string) {
  statusFilter.value = val;
  await loadSalesOrders(1);
}

async function loadAll() {
  const [, , orgs, cls, whs, prods] = await Promise.all([
    loadSalesOrders(salesPage.value),
    loadReturnOrders(returnPage.value),
    api.get('/orgs'),
    api.get('/clinics'),
    api.get('/warehouses'),
    api.get('/products'),
  ]);
  dealers.value = (orgs as unknown as any[]).filter((o) => o.type === 'DEALER');
  clinics.value = cls as unknown as any[];
  warehouses.value = whs as unknown as any[];
  products.value = prods as unknown as any[];
  if (warehouses.value.length && !returnForm.value.warehouseId) {
    returnForm.value.warehouseId = warehouses.value[0].id;
  }
}

onMounted(async () => {
  await loadAll();
  window.addEventListener('keydown', hotkeys);
  window.addEventListener('lumina:scan-activity', loadAll);
  openFromQuery();
});

onUnmounted(() => {
  window.removeEventListener('keydown', hotkeys);
  window.removeEventListener('lumina:scan-activity', loadAll);
});

watch(
  () => route.query.outbound,
  () => openFromQuery(),
);

function openFromQuery() {
  const id = route.query.outbound as string | undefined;
  if (!id) return;
  const order = salesOrders.value.find((o) => o.id === id);
  if (order) openOutbound(order);
  router.replace({ path: '/sales' });
}

function hotkeys(e: KeyboardEvent) {
  if (e.key === 'Escape' && outboundOpen.value) {
    closeOutbound();
    return;
  }
  if (e.key === 'F4' && outboundOpen.value) {
    e.preventDefault();
    if (outScanned.value.length) confirmOutbound();
  }
}

function countByStatus(v: string) {
  if (v === 'ALL') return salesOrders.value.length;
  if (v === 'PENDING_OUTBOUND') {
    return salesOrders.value.filter((o) => ['PENDING_OUTBOUND', 'PARTIAL_OUTBOUND'].includes(o.status)).length;
  }
  return salesOrders.value.filter((o) => o.status === v).length;
}

/* ---------- 新建 ---------- */
function openCreateOrder() {
  orderForm.value.warehouseId = warehouses.value[0]?.id || '';
  orderForm.value.buyerOrgId = dealers.value[0]?.id || '';
  orderForm.value.clinicId =
    clinics.value.find((c) => c.bindStatus !== 'PUBLIC_POOL')?.id || clinics.value[0]?.id || '';
  if (products.value.length && !orderForm.value.items[0].productId) {
    orderForm.value.items[0].productId = products.value[0].id;
    orderForm.value.items[0].unitPrice = Number(products.value[0].retailPrice);
  }
  orderForm.value.requestSpecialApproval = false;
  createDialog.value = true;
  runRedlinePreview();
}

function onPickProduct(row: any) {
  const p = products.value.find((x) => x.id === row.productId);
  if (p) row.unitPrice = Number(p.retailPrice);
  runRedlinePreview();
}

function addOrderLine() {
  const p = products.value[0];
  orderForm.value.items.push({
    productId: p?.id || '',
    qty: 1,
    unitPrice: Number(p?.retailPrice || 698),
    discountPercent: 40,
    isGift: false,
  });
  runRedlinePreview();
}

function removeOrderLine(idx: number) {
  orderForm.value.items.splice(idx, 1);
  runRedlinePreview();
}

async function runRedlinePreview() {
  const valid = orderForm.value.items.filter((i) => i.productId && i.qty > 0);
  if (!valid.length) {
    redlinePreview.value = null;
    return;
  }
  try {
    redlinePreview.value = await api.post('/sales-orders/check-redline', {
      items: valid,
      roundingAmount: orderForm.value.roundingAmount,
    });
  } catch {
    // 校验接口异常时不阻断编辑
  }
}

async function submitOrder(asDraft: boolean) {
  savingOrder.value = true;
  try {
    await api.post('/sales-orders', { ...orderForm.value, asDraft });
    ElMessage.success(asDraft ? '已存为草稿' : '订单已提交，仓库可扫码出库');
    createDialog.value = false;
    await loadAll();
  } catch (err: any) {
    if (err.response?.data?.code === 'REDLINE_VIOLATION') {
      ElMessage.error(err.response.data.message);
    }
  } finally {
    savingOrder.value = false;
  }
}

async function approveOrder(row: any) {
  await api.post(`/sales-orders/${row.id}/special-approve`, { approve: true });
  ElMessage.success('已特批放行，仓库可扫码出库');
  await loadAll();
}

/* ---------- 出库扫描 ---------- */
function openOutbound(row: any) {
  activeOutboundOrder.value = row;
  outScanned.value = [];
  outScanInput.value = '';
  outLast.value = null;
  outTrackingNo.value = row.trackingNo || '';
  outboundOpen.value = true;
  setTimeout(() => outScanRef.value?.focus(), 80);
}

function closeOutbound() {
  outboundOpen.value = false;
  activeOutboundOrder.value = null;
  outScanned.value = [];
}

const inFlightOutTokens = new Set<string>();

function normalizeSalesCode(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/\/v\/([0-9A-Za-z]{16})(?:[/?#]|$)/i);
  if (m) return m[1].toUpperCase();
  return s.replace(/\s+/g, '').toUpperCase();
}

function findSalesDupReason(
  list: any[],
  token: string,
  parentToken?: string | null,
  childTokens?: string[],
): string | null {
  if (list.some((x) => x.token === token)) {
    return `产品码 ${token} 已在待出库列表中，已自动去重`;
  }
  if (parentToken && list.some((x) => x.token === parentToken)) {
    return `产品码 ${token} 所属外箱 ${parentToken} 已在列表中，无需重复扫描`;
  }
  if (list.some((x) => Array.isArray(x.childTokens) && x.childTokens.includes(token))) {
    return `产品码 ${token} 所属外箱已在列表中，无需重复扫描`;
  }
  if (Array.isArray(childTokens) && childTokens.length) {
    const hit = childTokens.find((ct) => list.some((x) => x.token === ct));
    if (hit) {
      return `外箱 ${token} 内的单品码 ${hit} 已在列表中，请勿箱盒混扫重复`;
    }
  }
  return null;
}

async function processOutScan(raw: string) {
  const norm = normalizeSalesCode(raw);
  if (!norm || !activeOutboundOrder.value) return;
  const preDup = findSalesDupReason(outScanned.value, norm);
  if (preDup) {
    playScanBeep('error');
    outLast.value = { ok: false, message: preDup };
    ElMessage.warning(preDup);
    return;
  }
  if (inFlightOutTokens.has(norm)) return;
  inFlightOutTokens.add(norm);
  try {
    const mode = activeOutboundOrder.value.orderScene === 'HQ_TO_DEALER' ? 'HQ_OUTBOUND' : 'DEALER_OUTBOUND';
    const res = (await api.post('/stock/scan-validate', {
      rawInput: raw.trim(),
      mode,
      warehouseId: activeOutboundOrder.value.warehouseId,
    })) as any;

    if (!res.ok) {
      playScanBeep('error');
      speakWarehouseVoice(res.message);
      outLast.value = { ok: false, message: res.message };
      ElMessage.error(res.message);
      return;
    }
    const postDup = findSalesDupReason(outScanned.value, res.token, res.parentToken, res.childTokens);
    if (postDup) {
      playScanBeep('error');
      outLast.value = { ok: false, message: postDup };
      ElMessage.warning(postDup);
      return;
    }

    const line = orderProgress.value.find((p: any) => p.product.id === res.productId);
    if (!line) {
      playScanBeep('error');
      outLast.value = { ok: false, message: `商品【${res.productName}】不在这张订单里` };
      ElMessage.error(`商品【${res.productName}】不在这张订单里`);
      return;
    }
    if (res.unitCount > line.remaining) {
      playScanBeep('error');
      outLast.value = { ok: false, message: `超出待出数量：本单还可出 ${line.remaining} 盒` };
      ElMessage.error(`【${res.productName}】超出待出数量，本单还可出 ${line.remaining} 盒`);
      return;
    }

    outScanned.value.unshift(res);
    playScanBeep('success');
    outLast.value = { ...res, ok: true };
    outScanRef.value?.focus();
  } finally {
    inFlightOutTokens.delete(norm);
  }
}

async function handleOutScan() {
  await processOutScan(outScanInput.value);
  outScanInput.value = '';
}

useBarcodeScanner((code) => {
  if (outboundOpen.value) processOutScan(code);
});

async function confirmOutbound() {
  submittingOut.value = true;
  try {
    const res = (await api.post('/stock/outbound', {
      salesOrderId: activeOutboundOrder.value.id,
      codeInputs: outScanned.value.map((x) => x.token),
      trackingNo: outTrackingNo.value || undefined,
    })) as any;
    playScanBeep('notify');
    ElMessage.success(
      `出库完成：${res.outboundUnitsCount} 盒${res.autoUnpackedCartonsCount ? `，自动拆箱 ${res.autoUnpackedCartonsCount} 箱` : ''}`,
    );
    const idForPrint = activeOutboundOrder.value.id;
    closeOutbound();
    await loadAll();
    openPrint(idForPrint);
  } finally {
    submittingOut.value = false;
  }
}

/* ---------- 码归属 ---------- */
async function openOrderCodes(row: any) {
  codesDrawer.value = true;
  codesLoading.value = true;
  codesData.value = null;
  try {
    codesData.value = await api.get(`/sales-orders/${row.id}/codes`);
  } finally {
    codesLoading.value = false;
  }
}

function copySingleCode(token: string) {
  navigator.clipboard?.writeText(token);
  ElMessage.success(`已复制：${token}`);
}

function copyAllCodes() {
  const text = (codesData.value?.codes || []).map((c: any) => c.token).join('\n');
  navigator.clipboard?.writeText(text);
  ElMessage.success(`已复制 ${codesData.value?.codes.length || 0} 个码`);
}

function exportCodesCsv() {
  const rows = codesData.value?.codes || [];
  const head = '防伪码,商品,货号,级别,状态,验真次数\n';
  const body = rows
    .map((c: any) => `${c.token},${c.productName},${c.skuCode},${c.codeLevel},${c.status},${c.verifyCount}`)
    .join('\n');
  const blob = new Blob([`﻿${head}${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${codesData.value?.order.docNo}_codes.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- 退货 / 打印 ---------- */
async function submitReturn() {
  const tokens = returnForm.value.codesText
    .split(/[\s,，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!tokens.length) return ElMessage.warning('请输入至少 1 个退货单品码');
  await api.post('/return-orders', {
    warehouseId: returnForm.value.warehouseId,
    originalSalesNo: returnForm.value.originalSalesNo || undefined,
    codeInputs: tokens,
  });
  ElMessage.success(`退货回仓完成，${tokens.length} 盒码已恢复在库`);
  returnDialog.value = false;
  returnForm.value.codesText = '';
  await loadAll();
}

function openPrint(orderId: string) {
  printOrderId.value = orderId;
  printVisible.value = true;
}

/* ---------- 文案 ---------- */
function statusLabel(s: string) {
  const m: Record<string, string> = {
    DRAFT: '草稿',
    PENDING_APPROVAL: '待特批',
    PENDING_OUTBOUND: '待出库',
    PARTIAL_OUTBOUND: '部分出库',
    COMPLETED: '已完成',
    CANCELLED: '已撤销',
  };
  return m[s] || s;
}

function statusClass(s: string) {
  if (s === 'COMPLETED') return 'done';
  if (s === 'PENDING_APPROVAL') return 'danger';
  if (s === 'CANCELLED' || s === 'DRAFT') return 'muted';
  return 'open';
}
</script>

<style scoped>
/* 筛选 */
.filter-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.segmented {
  display: inline-flex;
  padding: 2px;
  background: var(--surface-3);
  border-radius: 6px;
  gap: 2px;
}
.segmented button {
  border: 0;
  background: transparent;
  padding: 6px 11px;
  border-radius: 4px;
  font-size: 12.5px;
  color: var(--ink-2);
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.segmented button.on {
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(23, 33, 31, 0.06);
}
.seg-count {
  font-family: var(--font-num);
  font-size: 11px;
  color: var(--ink-3);
}
.segmented button.on .seg-count {
  color: var(--brand);
}
.filter-hint {
  font-size: 11.5px;
  color: var(--ink-3);
}

/* 表格单元 */
.cell-doc {
  font-size: 12.5px;
  color: var(--brand-ink);
  font-weight: 600;
}
.cell-sub {
  font-size: 11px;
  color: var(--ink-3);
  margin-top: 1px;
}
.cell-strong {
  font-size: 13px;
  font-weight: 600;
}
.ellipsis-line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-line {
  font-size: 12px;
  line-height: 1.6;
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: nowrap;
  min-width: 0;
}
.item-name {
  color: var(--ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.item-qty {
  color: var(--ink-3);
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}
.gift-tag {
  font-size: 9.5px;
  border: 1px solid var(--line);
  border-radius: 2px;
  padding: 0 3px;
  color: var(--ink-3);
}
.fold {
  font-family: var(--font-num);
  font-size: 13px;
  color: var(--ink);
}
.fold.danger {
  color: var(--seal);
  font-weight: 600;
}
.status-pill {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 3px;
  border: 1px solid transparent;
  white-space: nowrap;
}
.status-pill.open {
  background: var(--brand-tint);
  border-color: var(--brand-line);
  color: var(--brand-ink);
}
.status-pill.done {
  background: var(--jade-tint);
  border-color: #cfe0d3;
  color: var(--jade);
}
.status-pill.danger {
  background: var(--seal-tint);
  border-color: var(--seal-line);
  color: var(--seal);
}
.status-pill.muted {
  background: var(--surface-3);
  border-color: var(--line);
  color: var(--ink-3);
}

.returns-card {
  margin-top: 16px;
}

.mobile-orders {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mo-card {
  padding: 14px;
}
.mo-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.mo-buyer {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  margin-top: 8px;
}
.mo-items {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
.mo-summary {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: 8px;
}
.mo-amount {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}
.mo-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}
.mo-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

/* ============ 出库作业层 ============ */
.desk-layer {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: var(--paper);
  display: flex;
  flex-direction: column;
  animation: desk-in 0.22s ease both;
}
@keyframes desk-in {
  from {
    opacity: 0;
    transform: scale(0.995);
  }
}

.dl-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 16px 24px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.dl-kicker {
  font-size: 10.5px;
  letter-spacing: 0.12em;
  color: var(--ink-3);
}
.dl-title-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-top: 4px;
  flex-wrap: wrap;
}
.dl-doc {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: 0.01em;
}
.dl-target {
  font-size: 14px;
  color: var(--ink);
  font-weight: 500;
}
.dl-sub {
  font-size: 11.5px;
  color: var(--ink-3);
  margin-top: 4px;
}
.dl-close {
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 5px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--ink-2);
  cursor: pointer;
  font-family: inherit;
  flex-shrink: 0;
}
.dl-close:hover {
  border-color: var(--line-strong);
  color: var(--ink);
}

.dl-body {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 18px;
  padding: 18px 24px 24px;
  overflow: hidden;
}

.dl-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  overflow: hidden;
}

/* 扫描台（与入库共用视觉语言） */
.stage {
  background: #111827;
  padding: 20px 22px 16px;
  position: relative;
}
.stage-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.stage-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: #d1d5db;
}
.stage-sub {
  font-size: 11.5px;
  color: #94a3b8;
}
.stage-input {
  width: 100%;
  height: 54px;
  border: 1px solid #334155;
  background: rgba(15, 23, 42, 0.72);
  border-radius: 10px;
  padding: 0 18px;
  font-size: 17px;
  letter-spacing: 0.08em;
  color: #f8fafc;
  outline: none;
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}
.stage-input::placeholder {
  color: #64748b;
  font-size: 15px;
}
.stage-input:focus {
  border-color: #9ca3af;
  background: rgba(15, 23, 42, 0.94);
  box-shadow: none;
}
.stage-foot {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 11px;
  font-size: 11px;
  color: #94a3b8;
}
.kbd-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 4px;
  padding: 1px 5px;
  color: #cbd5e1;
}
.stage-mode {
  margin-left: auto;
  color: #94a3b8;
}

.last-scan {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 13px 20px;
  border-bottom: 1px solid var(--line);
  min-height: 68px;
}
.last-scan.ok {
  background: var(--jade-tint);
}
.last-scan.fail {
  background: var(--seal-tint);
}
.last-scan.idle {
  background: var(--surface-2);
}
.ls-mark {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
}
.last-scan.ok .ls-mark {
  background: var(--jade);
  color: #fff;
}
.last-scan.fail .ls-mark {
  background: var(--seal);
  color: #fff;
}
.last-scan.idle .ls-mark {
  background: var(--surface-3);
  color: var(--ink-3);
}
.ls-body {
  flex: 1;
  min-width: 0;
}
.ls-title {
  font-size: 14px;
  font-weight: 600;
}
.ls-title.idle {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ink-2);
}
.ls-meta {
  display: flex;
  gap: 12px;
  font-size: 11.5px;
  color: var(--ink-2);
  margin-top: 3px;
  flex-wrap: wrap;
}
.ls-qty {
  font-family: var(--font-num);
  font-size: 15px;
  font-weight: 600;
  color: var(--jade);
}

.dl-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 18px 8px;
}
.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0 6px;
  font-size: 12px;
  color: var(--ink-2);
}
.link-danger {
  border: 0;
  background: transparent;
  color: var(--seal);
  font-size: 11.5px;
  cursor: pointer;
  font-family: inherit;
}

.level-tag {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--line);
  color: var(--ink-2);
  background: var(--surface-2);
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

/* 右侧进度 */
.dl-side {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}
.side-head {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.progress-list {
  padding: 6px 0 4px;
}
.progress-row {
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.progress-row:last-child {
  border-bottom: 0;
}
.pr-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.pr-name {
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.5;
}
.pr-num {
  font-size: 12.5px;
  color: var(--ink-2);
  flex-shrink: 0;
}
.pr-bar {
  height: 4px;
  background: var(--surface-3);
  border-radius: 3px;
  margin: 7px 0 6px;
  overflow: hidden;
}
.pr-bar span {
  display: block;
  height: 100%;
  background: var(--brand-line);
  transition: width 0.25s ease;
}
.pr-bar span.full {
  background: var(--jade);
}
.pr-meta {
  font-size: 10.5px;
  color: var(--ink-3);
}
.pr-meta strong {
  color: var(--ochre);
  font-family: var(--font-num);
  font-size: 12px;
}
.pr-meta strong.done {
  color: var(--jade);
}

.side-tracking {
  margin-top: auto;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.st-label {
  display: block;
  font-size: 11px;
  color: var(--ink-3);
  margin-bottom: 5px;
}

.side-summary {
  border-top: 1px solid var(--line);
  padding-top: 12px;
  margin-top: 12px;
}
.ss-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
  color: var(--ink-2);
  padding: 3px 0;
}
.ss-amount {
  font-size: 19px;
  color: var(--ink);
  font-weight: 600;
}
.side-actions {
  margin-top: 12px;
}
.side-note {
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--ink-3);
  margin: 10px 0 0;
}

/* 抽屉 */
.drawer-inner {
  padding: 4px 2px;
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
}
.drawer-kicker {
  font-size: 10.5px;
  letter-spacing: 0.12em;
  color: var(--ink-3);
}
.drawer-title {
  font-size: 15px;
  font-weight: 600;
  margin-top: 4px;
}
.drawer-sub {
  font-size: 12.5px;
  color: var(--ink-2);
  margin-top: 4px;
}
.owner-tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--brand-tint);
  color: var(--brand-ink);
  border: 1px solid var(--brand-line);
  margin-left: 5px;
}
.owner-tag.clinic {
  background: var(--ochre-tint);
  border-color: #dcc9a3;
  color: var(--ochre);
}
.drawer-close {
  border: 0;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  color: var(--ink-3);
  cursor: pointer;
  padding: 0 2px;
}
.code-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 14px 0;
}
.cs-cell {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 9px 11px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.cs-label {
  font-size: 10.5px;
  color: var(--ink-3);
}
.cs-value {
  font-size: 19px;
  font-weight: 600;
}
.drawer-tools {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

/* 新建单 */
.form-grid-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.form-grid-4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-top: 4px;
}
.line-table {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px 10px 10px;
  margin-bottom: 12px;
}
.lt-head {
  display: grid;
  grid-template-columns: 2.4fr 0.9fr 0.9fr 0.9fr 0.5fr 0.9fr 0.4fr;
  gap: 8px;
  font-size: 11px;
  color: var(--ink-3);
  padding: 0 2px 6px;
}
.lt-row {
  display: grid;
  grid-template-columns: 2.4fr 0.9fr 0.9fr 0.9fr 0.5fr 0.9fr 0.4fr;
  gap: 8px;
  align-items: center;
  padding: 3px 0;
}
.lt-row :deep(.el-input-number) {
  width: 100%;
}
.lt-amount {
  text-align: right;
  font-size: 12px;
}
.add-line {
  border: 1px dashed var(--line-strong);
  background: transparent;
  border-radius: 5px;
  padding: 6px 10px;
  font-size: 11.5px;
  color: var(--ink-2);
  cursor: pointer;
  margin-top: 8px;
  font-family: inherit;
}
.add-line:hover {
  border-color: var(--brand-line);
  color: var(--brand-ink);
}
.rv-line {
  font-size: 12px;
  margin-top: 3px;
}

@media (max-width: 1080px) {
  .dl-body {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
  .dl-side {
    order: -1;
  }
  .form-grid-3,
  .form-grid-4 {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 720px) {
  .lt-head {
    display: none;
  }
  .lt-row {
    grid-template-columns: 1fr 1fr;
    border-bottom: 1px solid var(--line);
    padding: 8px 0;
  }
  .dl-head {
    padding: 12px 14px;
  }
  .dl-body {
    padding: 12px 14px 18px;
  }
  .form-grid-3,
  .form-grid-4 {
    grid-template-columns: 1fr;
  }
}
</style>
