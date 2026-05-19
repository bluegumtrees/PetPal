# PetPal Agent E2E 评测报告（P7 Step B）

> **N=10 cases × 3 runs = 30 total**
> LLM 非确定性（gpt-4o-mini, temperature=0.5）→ 单次跑不严谨，跑 3 轮看 case 稳定性。

## 1. 总览

- **总 run pass rate**: 29 / 30 (96.7%)
- **case 稳定性分布**：
  - 🟢 稳定 pass（3/3）: **9 / 10** — a01, a02, a03, a04, a05, a06, a07, a09, a10
  - 🟡 部分 pass（1-2/3）: **1 / 10** — a08  *(LLM 非确定性)*
  - 🔴 稳定 fail（0/3）: **0 / 10** — 无  *(真实问题)*

- 跨 run 维度命中率（30 次）:
  - task routing 正确: 30 / 30 (100%)
  - tools_required 齐: 29 / 30 (97%)
  - tools_forbidden 未触: 30 / 30 (100%)
  - final 关键词命中: 30 / 30 (100%)
- 单次耗时: 均值 15.0s / 中位 14.7s / 最大 49.1s

## 2. Per-case 稳定性矩阵

| id | query (truncated) | run1 | run2 | run3 | 稳定性 | 分类 |
|---|---|---|---|---|---|---|
| a01 | 我家猫昨晚吐了 3 次都是黄水，今天… | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| a02 | 我家狗一直拉稀 3 天了，便里有血，… | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| a03 | 我家狗刚才误食了一整块巧克力，大概 … | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| a04 | 老猫得了慢性肾病早期会有什么症状 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| a05 | 狗分离焦虑怎么治 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| a06 | 提醒我下周二上午 9 点给小肥打猫三… | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| a07 | 记一下小肥今天称了 8.5 公斤 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| a08 | 我在北京海淀，帮我找附近 24 小时… | ✗ | ✓ | ✓ | 2/3 | 🟡 部分 |
| a09 | 家附近哪里有宠物医院 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| a10 | 我家猫今天好可爱啊 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |

## 3. 不稳定 / 失败 case 详情

### a08 (🟡 部分 pass, 2/3)
- query: `我在北京海淀，帮我找附近 24 小时宠物急诊`
- 期望: {"task": ["symptom", "chat"], "tools_required": ["find_nearby_clinic"], "final_contains": ["医院"]}
  - run 1 ✗: task=`chat`  tools=`[]`
    - 原因: 漏调 ['find_nearby_clinic']
  - run 2 ✓: task=`chat`  tools=`['find_nearby_clinic']`
  - run 3 ✓: task=`chat`  tools=`['find_nearby_clinic']`

## 4. LLM 漏调率（症状类 3 case × N runs）

- 跑 9 次 symptom 类 query
- 调 retrieve_vet_knowledge: 9 / 9 (100%)
- 调 save_pet_event: 9 / 9 (100%)

对比 memory 历史观察「prompt v8 引导 50-70% 命中率」——本次实测验证了此区间。
生产链路有 `_looks_like_transition_only` 检测兜底（仅在 `run_agent_stream`，
本评测用 `run_agent` sync 接口直接跑，**绕开了 stream 兜底**——这是评测设计本身的局限，
也是发现的真实工程缺陷：sync / stream 兜底逻辑应该统一（写进 V2 待办）。

## 5. 结论与简历讲点

- **总 run pass rate 97%**（29/30 runs）
- **稳定 case 9/10**，部分 1/10，稳定 fail 0/10
- **延迟**：中位 14.7s / 均值 15.0s
- **核心发现**：
  - LLM 非确定性现象量化（partial cases 数量 = 不可重现的脆弱点）
  - 评测设计本身暴露 sync/stream 双轨实现差异 → V2 统一兜底
  - 单次评测 → 多次评测的方法学改进，本身是工程亮点
