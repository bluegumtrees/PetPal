# 黄金演示账号（demo@petpal.local）

演示账号的全部内容由本目录声明式管理，随时可一键恢复出厂状态。

## 组成

| 文件 | 角色 |
|---|---|
| `bundle.json` | **生产数据包**（seed 的唯一输入）：2 宠物 + 56 事件 + 8 提醒 + 12 会话 |
| `conversations.json` | 12 条会话的原始录制存档（真跑 agent 导出，未修饰） |
| `manifest.yaml` | 内容剧本（人读的设计文档：故事线 / 时间轴 / 录制脚本） |
| `assets/` | 14 张照片（Pixabay 内容许可 + 1 张自有），来源见 `SOURCES.md` |

会话内容为真实 agent 录制（工具调用、RAG 结果、VLM 输出均为真），仅对
`bundle.json` 中 S5 的一处时间指代和一处中英混杂做了两行后期修正
（原始版本保留在 `conversations.json`）。

## 一键重置（面试 / 发简历前跑一遍）

所有时间戳相对运行时刻铺开（跨度 T-168 天 → T+22 天，最近活动 = 昨天），
每次重置账号都是「一直在用」的新鲜状态；路人在 demo 账号里乱发的消息也会被清掉。

```bash
# ECS 上，仓库根目录
git pull
docker compose exec backend python scripts/seed_demo.py
docker compose restart backend     # 让 APScheduler 重新注册未来提醒
```

> 首次部署本功能需要重建镜像（包含 planner 空回复兜底修复）：
> `docker compose up -d --build`

## 账号内容速览

- **蛋蛋**（暹罗）：绝育术后 FGS 疼痛跟踪 4→1→0（对照 0.39 临床阈值）、
  换粮呕吐多轮会话（RAG→存档→追图 VLM→事件追加→急诊红线）、
  BCS×2、情绪解读、体重 8 点、疫苗/驱虫/洗澡与里程碑
- **点点**（金毛）：半年减肥 35.2→30.5 kg（体重曲线 10 点）、
  误食巧克力急救（急诊 RAG + 附近医院）、游泳里程碑、BCS 评估
- 提醒：3 条已触发（含 dry-run 邮件预览）+ 5 条未来

## 重录 / 增改内容

1. 改 `manifest.yaml` 剧本；
2. 用会话录制工具按剧本真跑 agent（任意 HTTP 客户端调
   `/api/agent/chat/stream`，每景多录几次挑最好的）；
3. 导出会话消息合入 `bundle.json`（day/time 对齐剧本，图片 URL→asset 映射）；
4. 重新跑 `seed_demo.py` 验证。
