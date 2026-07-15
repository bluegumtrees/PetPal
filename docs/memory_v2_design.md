# PetPal 记忆系统 V2 设计稿：滚动健康画像（Rolling Health Profile）

> 状态：设计完成，待实现（排期：面试季后）。
> 作者备注：本文档同时是面试讲点——"记忆不是塞更多消息进 context，而是分层压缩"。

## 1. 现状与问题

当前记忆 = 三层拼装（`app/agent/context.py`）：

| 层 | 内容 | 局限 |
|---|---|---|
| 档案层 | pets 表静态字段（品种/年龄/体重…） | 无健康语义 |
| 近事层 | 最近 5 条 pet_events 注入 system prompt | **窗口太窄**——第 6 条起对 LLM 不存在 |
| 检索层 | `query_pet_history` 工具按需查 | 依赖 LLM 主动调用；返回原始行，token 贵且要 LLM 现场消化 |

实际暴露的问题（黄金账号数据、56+ 事件）：

1. **跨月记忆盲区**：问"蛋蛋术后恢复得怎么样"，绝育发生在 3 个月前，近事层看不见；LLM 要么调 `query_pet_history`（+1 轮延迟 ~5-15s），要么凭空答。
2. **token 与延迟的双输**：`query_pet_history(days_back=180)` 返回几十条 JSON，单轮 context 膨胀数千 token；D4"总结半年减肥"场景实测 tool 结果超长后模型输出质量下降（曾触发空回复链）。
3. **没有"趋势语义"**：原始事件行没有"体重半年 -13%""FGS 术后 4→0"这类结论，每次都要 LLM 重新归纳，且不同轮次归纳不一致。

## 2. 目标

- 让 agent **默认**就"记得"宠物的长期健康叙事（不依赖工具调用）。
- 注入 context 的记忆开销**恒定**（~300-500 token），与事件总量解耦。
- 摘要**可审计可再生**：由事件数据确定性驱动 + LLM 归纳，坏了随时重算。

## 3. 方案：pet_profiles 摘要表 + 事件计数触发

### 3.1 数据模型（新表 `pet_health_summaries`）

```
id / pet_id (FK, unique) 
summary_text      TEXT      # ~300-500 token 的健康画像（LLM 生成）
facts_json        TEXT      # 结构化关键事实（确定性代码算，不经 LLM）：
                            #   weight_trend: {start, current, delta_pct, window_days}
                            #   last_vaccine / last_deworm / last_grooming: date
                            #   open_concerns: [近 30 天 severity>=medium 的 symptom]
                            #   milestones_recent: [...]
events_covered    INT       # 生成时覆盖到的最大 event_id（水位线）
generated_at      DATETIME
model             VARCHAR   # 归纳用的模型名，便于回溯
```

### 3.2 生成时机（触发器，不用定时任务）

- **水位线触发**：每次 `save_pet_event` 后检查 `新事件数 - events_covered ≥ N`（N=8）→ 排一个后台任务重新归纳。复用现有 APScheduler，`misfire_grace_time` 宽松。
- **兜底**：agent 请求组装 context 时发现摘要缺失/过旧（>30 天）→ 同步用 facts_json 降级拼一段模板文本（无 LLM 依赖，永不阻塞聊天路径）。

### 3.3 归纳 prompt（要点）

- 输入：facts_json + 自水位线以来的新事件行 + 旧 summary_text。
- 要求：≤400 字；分【体重体态】【已解决的健康事件】【进行中关注】【行为与里程碑】四段；
  引用日期用相对表述（"三个月前绝育"）；**禁止诊断措辞**，只做事实归纳。
- 增量式：旧摘要 + 新事件 → 新摘要（不是全量重算），成本 O(1)。

### 3.4 注入方式（context.py 改动）

```
system prompt 组装顺序：
  档案层（不变）
  + 健康画像 summary_text          ← 新增，替代"最近 5 条"的大部分职责
  + 最近 3 条事件（从 5 收窄）      ← 保留"今天刚发生"的即时性
  + facts_json 里的 open_concerns  ← 结构化红线，权重最高
```

`query_pet_history` 工具保留，prompt 引导改为："画像已含长期趋势；仅当主人问**具体某次/某天**的记录时才调用"。

## 4. Token/延迟预算

| 项 | 现状 | V2 |
|---|---|---|
| context 记忆部分 | 5 条事件 ≈ 400-700 tk（随事件复杂度浮动） | 画像 400 + 3 条事件 250 + concerns 50 ≈ **700 tk 恒定** |
| "总结健康状况"类请求 | +1 轮工具（5-15s）+ 数千 tk | **0 额外轮次**（画像直接答） |
| 写路径开销 | 0 | 每 8 事件一次后台归纳（~1s LLM 调用，不在聊天关键路径） |

## 5. 评测方案（合入 eval_agent）

新增 case 组 m01-m06：
- m01 "总结最近健康状况" → 期望 **不调** query_pet_history 且 final 含画像事实（术后康复/体重趋势）
- m02 "上上个月它做了什么手术" → 允许调 query_pet_history（精确回忆场景）
- m03 摘要新鲜度：插入新 symptom 后问 → open_concerns 应反映
- m04-m06 回归：v1/v2 现有 case 不退化（画像挤占 context 的副作用检查）

通过标准：m 组 pass ≥ 5/6，v1+v2 回归无下降（±1 case 容差）。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 摘要幻觉（LLM 归纳错事实） | facts_json 由代码确定性计算，摘要只做"串词"；注入时 facts 优先 |
| 摘要过期误导 | generated_at + 水位线双重新鲜度检查；过旧自动降级模板拼装 |
| 多宠物成本 | 按 pet 独立触发，闲置宠物零成本 |
| 与"最近 5 条"重复 | 收窄为 3 条 + 归纳 prompt 明示"不复述近 3 天事件" |

## 7. 实现排期估算

后端表+迁移 0.5d / 触发+归纳 1d / context 组装改造 0.5d / 评测 m 组 0.5d ≈ **2.5 人日**。
不改前端；对现有 12 条黄金会话零影响（seed 后首次触发即生成画像）。
