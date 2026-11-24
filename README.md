# Lumina 品牌供销溯源系统与轻量化 ERP（需求一）

面向美业品牌方的 **一物一码防窜货溯源 + 渠道合同规则执行 + PC 仓管针式套打 + 移动端/微信小程序双端协同** 全栈系统。

## 核心能力一览

1. **一物一码与箱盒双层关联（`@lumina/trace-crypto`）**
   - 16 位 Crockford Base32 + HMAC-SHA256 防伪加密 Token（无状态验签拦截假码、不可枚举）。
   - 支持 **箱码/盒码预绑定 & 现场绑定**，整箱出入库扫 1 次自动展开，单盒拆零出库自动将父箱置为 `UNPACKED` 防重扫。
   - 完整单码生命周期时间轴（工厂生码 → 总仓入库 → 总仓出库 → 服务商收货 → 机构出库 → C 端验真 → 退货回仓）。
2. **渠道合同规则自动执行（`@lumina/shared-types` + `@lumina/api`）**
   - **90 天机构保护 / 270 天无复购自动解绑**：Redis 分布式锁 + 归一化指纹防同城重复抢报，记录服务端 UTC 时间戳；每日定时巡检到期自动回公海。
   - **3.5 折供货红线防绕过**：同时校验单行折扣与整单含赠品+抹零综合折率，低于红线强阻断或走总部破价特批流。
   - **8.5 折零售红线 + 跨区窜货稽核**：C 端验真页展示官方指导价与授权服务商背书，支持匿名核价举报；异地跨授权区域验真与高频查验自动触发总部风控预警。
   - **月度流向库存核验 + KPI 返点自动核算**：自动比对理论库存与服务商实盘，异常支持一键**暂停供货冻结**；返点按回款、活跃机构数、核心 SKU 覆盖率与违规扣减生成可审计快照。
3. **PC 仓管端 + 老式针式套打 + 移动/小程序双端**
   - `apps/web-admin`（Vue 3 + Element Plus）：集成全局 USB HID 扫码枪盲扫监听、Web Audio 声光提示、Socket.IO 手机下单实时语音播报、`electron-hiprint` 针式机静默套打（`241×140mm` / `241×93mm` / `A4` / `50×30mm`）及「生意通」CSV 一键导入。
   - `apps/miniapp`（独立域名 H5 + `mp-weixin/` 原生微信小程序）：免登录 C 端防伪验真页（`/v/:token`）+ 外勤销售移动下单/机构报备/查库存工作台（`/m/workbench`）。

## 目录结构

```text
beauty/
├── packages/
│   ├── shared-types/      # 领域枚举、3.5折防绕过红线算法、机构去重指纹（含 Vitest 单测）
│   ├── trace-crypto/      # CSPRNG + HMAC-SHA256 防伪码生成/验签/箱盒批次生成器（含单测）
│   └── print-templates/   # 241x140 / 241x93 针式联单与 A4/标签 hiprint 模板引擎（含单测）
├── apps/
│   ├── api/               # NestJS 10 + Prisma + PostgreSQL 16 + Redis 7 + Socket.IO（含 E2E 测试）
│   ├── web-admin/         # PC 品牌总控 & 仓管工作台 (Vite + Vue 3 + Element Plus)
│   └── miniapp/           # 独立域名 H5 验真/移动工作台 + mp-weixin 原生微信小程序工程
├── docker/                # Docker Compose (PostgreSQL 16 + Redis 7) & Nginx 配置
└── docs/                  # 针式打印机配置手册 & 仓库扫码 SOP
```

## 快速启动

```bash
# 1. 复制环境变量并启动 PostgreSQL 16 + Redis 7（需要 Node 22 + pnpm + Docker）
cp .env.example .env && cp .env.example apps/api/.env
pnpm docker:up

# 2. 一键安装依赖、生成 Prisma Client、构建全量包并灌入演示数据
pnpm install
pnpm setup

# 3. 运行全量自动化单元测试与端到端业务闭环测试
pnpm test

# 4. 启动服务（三个终端或后台进程）
pnpm dev:api       # 后端 API: http://localhost:3100/api/v1
pnpm dev:admin     # PC 仓管与总控端: http://localhost:5173
pnpm dev:miniapp   # 手机 C端验真(/v/:token) & 销售工作台(/m/workbench): http://localhost:5174
```

### 默认演示账号（密码均为 `123456`）

| 账号 | 角色 | 主体视角 |
| :--- | :--- | :--- |
| `admin` | 品牌总部管理员 | 全局流向管控、生码、停供、特批与返点核算 |
| `hq_warehouse` | 品牌总仓库管 | 璞澜总仓扫码入库、出库与针式打单 |
| `dealer_nc` | 南昌服务商负责人（张硕） | 南昌独立仓隔离数据、月度盘点提报、机构报备 |
| `dealer_cs` | 长沙服务商负责人 | 跨主体越权隔离与同城抢报冲突演示 |
| `sales_nc` | 外勤销售 | 手机端下单实时推仓库、现场报备机构 |
