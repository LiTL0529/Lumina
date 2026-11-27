/**
 * Standard operating procedures injected into the AI copilot via `get_business_rules_and_sop`.
 * Thresholds in angle-bracket placeholders are replaced with live SystemRuleConfig values.
 */
export type SopTopic = 'ALL' | 'REDLINE' | 'PROTECTION' | 'INBOUND' | 'OUTBOUND' | 'VERIFY' | 'REBATE';

export interface LiveRules {
  minSupplyFold: number; // e.g. 3.5
  minRetailFold: number; // e.g. 8.5
  protectDays: number;
  unbindDays: number;
  unbindWarnDays: number;
  highFreqVerifyThreshold: number;
  allowSpecialPriceApprove: boolean;
}

export function buildSop(topic: SopTopic, r: LiveRules): Record<string, string[]> {
  const all: Record<Exclude<SopTopic, 'ALL'>, string[]> = {
    REDLINE: [
      `供货红线：单品综合折扣低于 ${r.minSupplyFold} 折（即建议零售价 × ${(r.minSupplyFold / 10).toFixed(2)}）时，下单会被系统拦截，订单状态变为「红线待特批」。`,
      `零售红线：终端零售价不得低于建议零售价的 ${r.minRetailFold} 折，顾客验真页的核价举报会自动生成 PRICE_BELOW_REDLINE / RETAIL_PRICE_REPORT 预警。`,
      r.allowSpecialPriceApprove
        ? '特批流程：在「出库与打单」找到「红线待特批」订单 → 总部管理员点击「特批」并填写理由 → 订单转为待出库，特批人与理由永久留痕。'
        : '当前规则已关闭特批，低于供货红线的订单只能修改折扣后重新提交。',
      '常见原因：赠品未勾选「赠品」导致整单折扣被拉低；抹零金额过大；单价录入错误。',
    ],
    PROTECTION: [
      `报备保护：外勤在手机端或 PC「代理商与机构」报备新机构，服务器时间戳先到先得，锁定 ${r.protectDays} 天保护期。`,
      `首单绑定：保护期内完成首单出库，机构升级为「已绑定」；超过 ${r.protectDays} 天未成交自动释放回公海。`,
      `无复购解绑：已绑定机构连续 ${r.unbindDays} 天无出库记录自动解绑，提前 ${r.unbindWarnDays} 天进入临期提醒。`,
    ],
    INBOUND: [
      '总仓入库：「扫码入库建档」选择入库仓 → 扫描外箱码（整箱自动展开）或单盒码 → 核对数量 → 确认入库。',
      '外部条码建档：新码可在「新码建档入库」模式选择商品、批次与码级别后连续扫描登记。',
      '代理商收货：服务商在手机工作台「扫码收货」逐箱扫描总部发出的码，系统自动核对归属。',
    ],
    OUTBOUND: [
      '按单出库：「出库与打单」选择待出库订单 → 逐码扫描 → 系统校验码归属与数量 → 确认出库并打印联单，码自动记到客户名下。',
      '快捷出库：总仓可选择「快捷出库绑代理商」直接扫码绑定目标代理商，自动生成供货单。',
      '退货回仓：「出库与打单」→「退货回仓」录入原单号并扫描退回码，码状态回滚至在库，库存自动回补。',
    ],
    VERIFY: [
      '顾客验真：微信扫描单盒二维码进入官方验真页，展示产品档案、授权服务商与终端机构。',
      `高频验真：同一码验真次数超过 ${r.highFreqVerifyThreshold} 次标记为异常并触发 HIGH_FREQ_VERIFY 预警。`,
      '跨区检测：扫码城市不在授权服务商的授权区域内时，自动生成 CROSS_REGION（跨区窜货）预警。',
    ],
    REBATE: [
      '月度返点：「报表与返点」按月核算，依据回款金额、新增活跃机构数与核心 SKU 覆盖率计算基础与奖励返点。',
      '扣罚：存在未结案的高危窜货预警或月度对账差异时，返点会产生扣减并可冻结供货。',
    ],
  };
  if (topic === 'ALL') return all;
  return { [topic]: all[topic] };
}
