# PetPal Agent E2E 评测报告（P7 Step B）

> **N=30 cases × 3 runs = 90 total**
> LLM 非确定性（qwen/qwen3-235b-a22b-2507, temperature=0.5）→ 单次跑不严谨，跑 3 轮看 case 稳定性。

## 1. 总览

- **总 run pass rate**: 78 / 90 (86.7%)
- **case 稳定性分布**：
  - 🟢 稳定 pass（3/3）: **23 / 30** — a01, a04, a06, a07, a08, a09, a10, n01, n02, n03, n04, n05, n07, n08, n10, n11, n12, n13, n14, n16, n17, n18, n20
  - 🟡 部分 pass（1-2/3）: **6 / 30** — a02, a03, a05, n06, n09, n19  *(LLM 非确定性)*
  - 🔴 稳定 fail（0/3）: **1 / 30** — n15  *(真实问题)*

- 跨 run 维度命中率（90 次）:
  - task routing 正确: 90 / 90 (100%)
  - tools_required 齐: 80 / 90 (89%)
  - tools_forbidden 未触: 90 / 90 (100%)
  - final 关键词命中: 84 / 90 (93%)
- 单次耗时: 均值 30.0s / 中位 28.3s / 最大 102.6s

## 2. Per-case 稳定性矩阵

| id | query (truncated) | run1 | run2 | run3 | 稳定性 | 分类 |
|---|---|---|---|---|---|---|
| a01 | 我家猫昨晚吐了 3 次都是黄水，今天… | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| a02 | 我家狗一直拉稀 3 天了，便里有血，… | ✗ | ✗ | ✓ | 1/3 | 🟡 部分 |
| a03 | 我家狗刚才误食了一整块巧克力，大概 … | ✗ | ✗ | ✓ | 1/3 | 🟡 部分 |
| a04 | 老猫得了慢性肾病早期会有什么症状 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| a05 | 狗分离焦虑怎么治 | ✗ | ✓ | ✓ | 2/3 | 🟡 部分 |
| a06 | 提醒我下周二上午 9 点给蛋蛋打猫三… | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| a07 | 记一下蛋蛋今天称了 4.4 公斤 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| a08 | 我在北京海淀，帮我找附近 24 小时… | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| a09 | 家附近哪里有宠物医院 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| a10 | 我家猫今天好可爱啊 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n01 | 猫吃了冻干零食以后挑食不吃猫粮了怎么… | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n02 | 狗减肥一周减多少体重是安全的 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n03 | 两个月大的小猫一天应该喂几顿 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n04 | 我家猫不爱喝水，有什么办法让它多喝水 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n05 | 想给猫换新粮，怎么换才不会拉肚子 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n06 | 每天能给狗吃多少零食不算过量 | ✗ | ✓ | ✓ | 2/3 | 🟡 部分 |
| n07 | 老年猫的饮食需要注意什么 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n08 | 狗吃了几颗葡萄要紧吗 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n09 | 狗偷吃了一片无糖口香糖会中毒吗 | ✓ | ✗ | ✗ | 1/3 | 🟡 部分 |
| n10 | 猫能吃洋葱吗，昨天猫偷舔了点洋葱炒肉… | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n11 | 猫白血病病毒会传染给家里其他猫吗 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n12 | 听说猫传腹很致命，早期有什么信号 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n13 | 狗从宠物店接回来以后一直咳嗽，像卡了… | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n14 | 猫口臭还流口水，牙龈看着发红 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n15 | 十四岁的老猫半夜乱叫白天转圈，是老年… | ✗ | ✗ | ✗ | 0/3 | 🔴 稳 fail |
| n16 | 猫突然不在猫砂盆里尿，到处乱尿 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n17 | 帮我总结一下蛋蛋最近的健康状况 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n18 | 蛋蛋上次打疫苗是什么时候 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |
| n19 | 多久给猫称一次体重比较合适 | ✓ | ✗ | ✓ | 2/3 | 🟡 部分 |
| n20 | 每个月 1 号提醒我给蛋蛋体内驱虫 | ✓ | ✓ | ✓ | 3/3 | 🟢 稳 pass |

## 3. 不稳定 / 失败 case 详情

### a02 (🟡 部分 pass, 1/3)
- query: `我家狗一直拉稀 3 天了，便里有血，怎么办`
- 期望: {"task": ["symptom"], "tools_required": ["retrieve_vet_knowledge", "save_pet_event"], "final_contains": ["腹泻", "就医"]}
  - run 1 ✗: task=`symptom`  tools=`[]`
    - 原因: 漏调 ['retrieve_vet_knowledge', 'save_pet_event']; final 缺 ['腹泻', '就医']
  - run 2 ✗: task=`symptom`  tools=`['retrieve_vet_knowledge', 'retrieve_vet_knowledge']`
    - 原因: 漏调 ['save_pet_event']
  - run 3 ✓: task=`symptom`  tools=`['retrieve_vet_knowledge', 'save_pet_event']`

### a03 (🟡 部分 pass, 1/3)
- query: `我家狗刚才误食了一整块巧克力，大概 30 分钟前`
- 期望: {"task": ["symptom"], "tools_required": ["retrieve_vet_knowledge", "save_pet_event"], "final_contains": ["巧克力", "立即"]}
  - run 1 ✗: task=`symptom`  tools=`['retrieve_vet_knowledge']`
    - 原因: 漏调 ['save_pet_event']
  - run 2 ✗: task=`symptom`  tools=`['retrieve_vet_knowledge']`
    - 原因: 漏调 ['save_pet_event']
  - run 3 ✓: task=`symptom`  tools=`['retrieve_vet_knowledge', 'save_pet_event']`

### a05 (🟡 部分 pass, 2/3)
- query: `狗分离焦虑怎么治`
- 期望: {"task": ["symptom", "chat"], "tools_required": ["retrieve_vet_knowledge"], "final_contains": ["焦虑", "分离", "独处"]}
  - run 1 ✗: task=`chat`  tools=`[]`
    - 原因: 漏调 ['retrieve_vet_knowledge']
  - run 2 ✓: task=`chat`  tools=`['retrieve_vet_knowledge']`
  - run 3 ✓: task=`chat`  tools=`['retrieve_vet_knowledge']`

### n06 (🟡 部分 pass, 2/3)
- query: `每天能给狗吃多少零食不算过量`
- 期望: {"task": ["chat", "symptom"], "tools_required": ["retrieve_vet_knowledge"], "final_contains": ["零食", "10", "热量"]}
  - run 1 ✗: task=`chat`  tools=`['retrieve_vet_knowledge', 'retrieve_vet_knowledge', 'retrieve_vet_knowledge', 'retrieve_vet_knowledge']`
    - 原因: final 缺 ['零食', '10', '热量']
  - run 2 ✓: task=`chat`  tools=`['retrieve_vet_knowledge', 'retrieve_vet_knowledge']`
  - run 3 ✓: task=`chat`  tools=`['retrieve_vet_knowledge']`

### n09 (🟡 部分 pass, 1/3)
- query: `狗偷吃了一片无糖口香糖会中毒吗`
- 期望: {"task": ["symptom"], "tools_required": ["retrieve_vet_knowledge"], "final_contains": ["木糖醇", "就医", "送医", "低血糖", "血糖"]}
  - run 1 ✓: task=`symptom`  tools=`['retrieve_vet_knowledge']`
  - run 2 ✗: task=`symptom`  tools=`['retrieve_vet_knowledge', 'save_pet_event']`
    - 原因: final 缺 ['木糖醇', '就医', '送医', '低血糖', '血糖']
  - run 3 ✗: task=`symptom`  tools=`[]`
    - 原因: 漏调 ['retrieve_vet_knowledge']; final 缺 ['木糖醇', '就医', '送医', '低血糖', '血糖']

### n19 (🟡 部分 pass, 2/3)
- query: `多久给猫称一次体重比较合适`
- 期望: {"task": ["chat", "symptom"], "tools_required": ["retrieve_vet_knowledge"], "final_contains": ["体重", "周"]}
  - run 1 ✓: task=`chat`  tools=`['retrieve_vet_knowledge']`
  - run 2 ✗: task=`chat`  tools=`[]`
    - 原因: 漏调 ['retrieve_vet_knowledge']
  - run 3 ✓: task=`chat`  tools=`['retrieve_vet_knowledge']`

### n15 (🔴 稳定 fail, 0/3)
- query: `十四岁的老猫半夜乱叫白天转圈，是老年痴呆吗`
- 期望: {"task": ["symptom", "chat"], "tools_required": ["retrieve_vet_knowledge"], "final_contains": ["认知", "老年", "兽医"]}
  - run 1 ✗: task=`chat`  tools=`[]`
    - 原因: 漏调 ['retrieve_vet_knowledge']
  - run 2 ✗: task=`chat`  tools=`[]`
    - 原因: 漏调 ['retrieve_vet_knowledge']; final 缺 ['认知', '老年', '兽医']
  - run 3 ✗: task=`chat`  tools=`[]`
    - 原因: 漏调 ['retrieve_vet_knowledge']; final 缺 ['认知', '老年', '兽医']

## 4. LLM 漏调率（症状类 3 case × N runs）

- 跑 9 次 symptom 类 query
- 调 retrieve_vet_knowledge: 8 / 9 (89%)
- 调 save_pet_event: 5 / 9 (56%)

对比 memory 历史观察「prompt v8 引导 50-70% 命中率」——本次实测验证了此区间。
生产链路有 `_looks_like_transition_only` 检测兜底（仅在 `run_agent_stream`，
本评测用 `run_agent` sync 接口直接跑，**绕开了 stream 兜底**——这是评测设计本身的局限，
也是发现的真实工程缺陷：sync / stream 兜底逻辑应该统一（写进 V2 待办）。

## 5. 结论与简历讲点

- **总 run pass rate 87%**（78/90 runs）
- **稳定 case 23/30**，部分 6/30，稳定 fail 1/30
- **延迟**：中位 28.3s / 均值 30.0s
- **核心发现**：
  - LLM 非确定性现象量化（partial cases 数量 = 不可重现的脆弱点）
  - 评测设计本身暴露 sync/stream 双轨实现差异 → V2 统一兜底
  - 单次评测 → 多次评测的方法学改进，本身是工程亮点
