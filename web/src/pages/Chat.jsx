import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, streamChat } from '../api'
import ChatInput from '../components/ChatInput'
import {
  AssistantMessage,
  AssistantThinking,
  UserMessage,
} from '../components/MessageCard'
import SessionList from '../components/SessionList'
import TaskBadge from '../components/TaskBadge'
import ToolCallCard from '../components/ToolCallCard'
import VLMCard from '../components/VLMCard'
import Avatar from '../components/Avatar'
import { useToast } from '../components/Toast'
import { usePets } from '../context/PetContext'
import { useProvideSidebarProps } from '../context/SidebarContext'
import useSession from '../hooks/useSession'
import { V4Btn, V4Card, Illo } from '../components/v4'

/**
 * @typedef {Object} QuickPrompt
 * @property {string} label
 * @property {string} text       预填到输入框的文字
 * @property {string} hint       hint 文案（有 reminder 时前缀 📎 标记需要补内容）
 * @property {string} [reminder] 点击后的 toast 提示（一般用于需要补图/改地址的场景）
 */

/** @type {QuickPrompt[]}
 *  6 卡 2×3 布局：
 *    Row 1 健康咨询（文字 / 文字+图）：描述症状 | 评估体态
 *    Row 2 VLM 多模态（强制需图）：解读情绪 | 评估疼痛
 *    Row 3 实用工具：日程提醒 | 找医院
 *  全部不 autoSend，点击都只填到输入框，按需修改后发送；含 reminder 的弹提示 */
const QUICK_PROMPTS = [
  // Row 1: 健康咨询
  {
    label: '🤒 描述症状',
    text: '我家猫今天吐了 2 次，没什么精神',
    hint: '文字 / 可附图',
  },
  {
    label: '📸 评估体态',
    text: '看看它的体态评分怎么样',
    hint: '需上传侧身全身照',
    reminder: '请上传一张猫/狗的侧身全身照再发送，BCS 评分需要看到肋骨/腰部轮廓',
  },
  // Row 2: VLM 多模态（强制需图）
  {
    label: '😺 解读情绪',
    text: '看看它现在的情绪状态',
    hint: '需上传照片',
    reminder: '请上传一张能看清面部和姿态的照片，情绪靠 body signals 推断',
  },
  {
    label: '🤕 评估疼痛',
    text: '看看它是不是有疼痛迹象',
    hint: '需上传猫脸照',
    reminder: '请上传一张清晰猫脸照（耳/眼/口/胡须/头位），FGS 仅适用于猫',
  },
  // Row 3: 实用工具
  {
    label: '🔔 日程提醒',
    text: '帮我设个周三上午 9 点的疫苗提醒',
    hint: '疫苗 / 驱虫 / 洗澡 等',
  },
  {
    label: '🏥 找医院',
    text: '我在上海松江，附近有什么宠物医院？',
    hint: '把地址改成你所在城市',
    reminder: '把示例里的「上海松江」换成你所在城市/区再发送',
  },
]

/**
 * @typedef {Object} UIBlock  UI 上的一个"块"，按时间顺序构成消息流
 * @property {string} id
 * @property {'user'|'task'|'vlm'|'tool'|'thinking'|'assistant'} kind
 * @property {any} data
 */

export default function Chat() {
  const { activePet, pets, loading: petsLoading } = usePets()
  const { sessionId, newSession, switchTo } = useSession(activePet?.id)
  const toast = useToast()
  const [showHistory, setShowHistory] = useState(false)

  /** @type {[UIBlock[], Function]} */
  const [blocks, setBlocks] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  // 等待态：阶段文案跟着 SSE 事件走 + 计时（首 token 前 10-20s 不再是干等）
  const [streamStage, setStreamStage] = useState('')
  const [streamStartAt, setStreamStartAt] = useState(0)
  const abortRef = useRef(null)
  const scrollRef = useRef(null)

  // 加载历史
  useEffect(() => {
    if (!sessionId) {
      setBlocks([])
      return
    }
    setHistoryLoading(true)
    api(`/api/sessions/${sessionId}/messages`)
      .then((msgs) => {
        const restored = []
        for (const m of msgs) {
          if (m.role === 'user') {
            restored.push({
              id: 'h-' + m.id,
              kind: 'user',
              data: {
                content: m.content,
                imageUrl: m.image_url,
                task: m.task,
                vlmOutput: m.vlm_output || null,  // 后端持久化的 VLM 输出，可以重建徽章
              },
            })
            if (m.task) {
              restored.push({ id: 'h-task-' + m.id, kind: 'task', data: { task: m.task } })
            }
            // 如果 user msg 附了图 + VLM 输出，还原 VLMCard
            if (m.vlm_output && m.task) {
              restored.push({
                id: 'h-vlm-' + m.id,
                kind: 'vlm',
                data: { task: m.task, output: m.vlm_output },
              })
            }
          } else if (m.role === 'assistant') {
            // 实时流顺序：先 content（thinking）→ 再 tool_calls
            // 历史还原要保持同样顺序，否则刷新后 thinking 跑到 tool 后面
            if (m.content && m.content.trim()) {
              restored.push({
                id: 'h-' + m.id,
                kind: m.is_intermediate ? 'thinking' : 'assistant',
                data: { content: m.content },
              })
            }
            if (m.tool_calls && m.tool_calls.length > 0) {
              for (let i = 0; i < m.tool_calls.length; i++) {
                const tc = m.tool_calls[i]
                // 历史里的 duplicate/skipped/cached 也不展示（同实时流逻辑）
                if (tc.result?.duplicate === true || tc.result?.skipped === true || tc.result?.cached === true) {
                  continue
                }
                restored.push({
                  id: `h-tc-${m.id}-${i}`,
                  kind: 'tool',
                  data: {
                    tool: tc.tool,
                    args: tc.args,
                    summary: tc.result_summary,
                    status: 'done',
                    result: tc.result || null,
                  },
                })
              }
            }
          }
        }
        setBlocks(restored)
      })
      .catch(() => setBlocks([]))
      .finally(() => setHistoryLoading(false))
  }, [sessionId])

  // 自动滚到底（scrollIntoView 会用最近的可滚动祖先，这里就是 messages div）
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'auto', block: 'end' })
    }
  }, [blocks])

  // 输入框初始值（由 quick-pick 注入；每次注入 seed+1 强制重挂载）
  const [inputDraft, setInputDraft] = useState('')
  const [inputDraftSeed, setInputDraftSeed] = useState(0)

  const handleNewSession = useCallback(() => {
    if (isStreaming) {
      toast('请等当前对话完成后再开新对话', { kind: 'error' })
      return
    }
    newSession()
    setBlocks([])
    toast('已开始新对话', { kind: 'success' })
  }, [newSession, isStreaming, toast])

  // 把 sidebar 控制 props 注入 SidebarContext（移动端 Header 抽屉读取）
  useProvideSidebarProps({
    currentSessionId: sessionId,
    onSelectSession: useCallback(
      (sid) => {
        if (isStreaming) {
          toast('请等当前对话完成', { kind: 'error' })
          return
        }
        switchTo(sid)
        setBlocks([])
      },
      [isStreaming, switchTo, toast]
    ),
    onCurrentSessionDeleted: useCallback(() => {
      newSession()
      setBlocks([])
      toast('当前对话已删除，已开新对话', { kind: 'success' })
    }, [newSession, toast]),
    onNewSession: handleNewSession,
  })

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }, [])

  // 发送（核心）
  const handleSubmit = useCallback(
    async ({ text, image }) => {
      if (!activePet) {
        toast('请先选择或创建一只宠物', { kind: 'error' })
        return
      }
      if (!sessionId) return

      // 1. 在 UI 立刻插入 user 消息（带本地图预览）
      const localImageUrl = image ? URL.createObjectURL(image) : null
      const userBlockId = 'u-' + Date.now()
      setBlocks((b) => [
        ...b,
        {
          id: userBlockId,
          kind: 'user',
          data: {
            content: text,
            imageUrl: localImageUrl,
            task: null,
            vlmOutput: null,
          },
        },
      ])

      setIsStreaming(true)
      setStreamStage('正在识别任务类型…')
      setStreamStartAt(Date.now())
      const hasImage = !!image
      const ctrl = new AbortController()
      abortRef.current = ctrl

      // 当前流中正在 running 的 tool block id (按 iter+tool 唯一)
      const runningToolIds = {}

      try {
        await streamChat(
          { petId: activePet.id, sessionId, text, image },
          (ev) => {
            const t = ev.type

            if (t === 'task_classified') {
              setStreamStage(hasImage ? '正在用 VLM 分析图片…' : '正在读取档案与近况，规划下一步…')
              setBlocks((b) => {
                // 给刚才的 user block 补 task 字段
                const next = b.map((x) =>
                  x.id === userBlockId
                    ? { ...x, data: { ...x.data, task: ev.task } }
                    : x
                )
                next.push({ id: 'task-' + Date.now(), kind: 'task', data: { task: ev.task } })
                return next
              })
            } else if (t === 'vlm_done') {
              setStreamStage('图片分析完成，agent 决策中…')
              setBlocks((b) => {
                const next = b.map((x) =>
                  x.id === userBlockId
                    ? { ...x, data: { ...x.data, vlmOutput: ev.output } }
                    : x
                )
                next.push({
                  id: 'vlm-' + Date.now(),
                  kind: 'vlm',
                  data: { task: null, output: ev.output },
                })
                return next
              })
              // 把当前 task 注入 vlm block（前面已存在 task block 时取它的 task）
              setBlocks((b) => {
                const taskBlock = [...b].reverse().find((x) => x.kind === 'task')
                if (!taskBlock) return b
                return b.map((x) =>
                  x.kind === 'vlm' && !x.data.task
                    ? { ...x, data: { ...x.data, task: taskBlock.data.task } }
                    : x
                )
              })
            } else if (t === 'tool_call') {
              setStreamStage('正在执行工具…')
              const key = `${ev.iter}-${ev.tool}-${Date.now()}`
              runningToolIds[ev.tool + '-' + ev.iter] = key
              setBlocks((b) => [
                ...b,
                {
                  id: 'tc-' + key,
                  kind: 'tool',
                  data: {
                    tool: ev.tool,
                    args: ev.args,
                    status: 'running',
                    result: null,
                    summary: null,
                  },
                },
              ])
            } else if (t === 'tool_result') {
              setStreamStage('整理工具结果，继续推理…')
              const key = runningToolIds[ev.tool + '-' + ev.iter]
              // duplicate / skipped / cached 视觉噪声——直接从 UI 移除（数据已审计在 db）
              const isNoise = ev.result?.duplicate === true || ev.result?.skipped === true || ev.result?.cached === true
              if (isNoise) {
                setBlocks((b) => b.filter((x) => x.id !== 'tc-' + key))
              } else {
                setBlocks((b) =>
                  b.map((x) =>
                    x.id === 'tc-' + key
                      ? {
                          ...x,
                          data: {
                            ...x.data,
                            status: ev.result?.error || ev.result?.ok === false ? 'error' : 'done',
                            result: ev.result,
                            summary: ev.summary,
                          },
                        }
                      : x
                  )
                )
              }
            } else if (t === 'assistant_thinking') {
              setStreamStage('agent 思考中…')
              setBlocks((b) => [
                ...b,
                { id: 'th-' + Date.now(), kind: 'thinking', data: { content: ev.content } },
              ])
            } else if (t === 'final_answer') {
              setBlocks((b) => [
                ...b,
                { id: 'a-' + Date.now(), kind: 'assistant', data: { content: ev.content } },
              ])
            } else if (t === 'error') {
              toast('Agent 出错: ' + ev.detail, { kind: 'error' })
            } else if (t === 'max_iter_reached') {
              toast('达到最大推理步数，请简化问题', { kind: 'error' })
            }
            // 'start' / 'iter_start' / 'done' / 'vlm_start' 不另起块
          },
          ctrl.signal
        )
      } catch (e) {
        if (e.name !== 'AbortError') {
          toast('流式出错: ' + (e.message || e), { kind: 'error' })
        }
      } finally {
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [activePet, sessionId, toast]
  )

  // 快速预设点击：统一填到输入框；含 reminder 的弹 toast 提示
  const handleQuickPick = useCallback(
    (p) => {
      setInputDraft(p.text)
      setInputDraftSeed((n) => n + 1)
      if (p.reminder) {
        toast(p.reminder, { kind: 'info', durationMs: 5000 })
      }
    },
    [toast]
  )

  // 空 / 无宠物 时
  if (petsLoading) {
    return (
      <p className="text-sm text-center py-10" style={{ color: 'var(--v4-faint)' }}>
        加载中…
      </p>
    )
  }
  if (pets.length === 0) {
    return (
      <V4Card padding="p-10" className="text-center shadow-sm rounded-2xl">
        <div
          className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-3"
          style={{ background: 'var(--v4-accent-soft)' }}
        >
          <Illo name="paw" size={36} color="var(--v4-accent-deep)" />
        </div>
        <h2 className="text-xl font-semibold mb-1" style={{ color: 'var(--v4-ink)' }}>
          和 PetPal 聊天前
        </h2>
        <p className="text-sm mb-6" style={{ color: 'var(--v4-mute)' }}>
          先建一只宠物档案，agent 才能基于它给出建议
        </p>
        <Link to="/pets/new">
          <V4Btn variant="primary" size="lg" icon="sparkle">
            + 新建宠物
          </V4Btn>
        </Link>
      </V4Card>
    )
  }

  const isEmpty = blocks.length === 0

  return (
    // 固定高度 = 视口 - 顶部Header(60) - main的上下padding (移动:p-3=24; sm+:p-6=48)
    // 内部用 flex column：toolbar shrink-0 | messages flex-1 overflow-y-auto | input shrink-0
    <div className="flex flex-col h-[calc(100dvh-84px)] sm:h-[calc(100dvh-108px)]">
      {/* session 工具栏（移到 scrollable 区域内部，跟随消息一起滚走，给 messages 让位）*/}
      <div className="flex-1 overflow-y-auto scrollbar-hide pb-4 min-h-0">
      <div
        className="relative flex items-center gap-3 mb-4 pb-3 border-b"
        style={{ borderColor: 'var(--v4-line)' }}
      >
        <Avatar pet={activePet} size={36} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--v4-ink)' }}>
            {activePet.name}
          </p>
          <p className="text-[10px] font-mono truncate" style={{ color: 'var(--v4-faint)' }}>
            session: {sessionId?.slice(0, 8)}…
          </p>
        </div>
        {/* 桌面端「历史」弹层；移动端通过 hamburger 抽屉里的 Sidebar 看历史 */}
        <V4Btn
          variant="secondary"
          size="sm"
          icon="bell"
          data-session-list-trigger
          onClick={() => setShowHistory((v) => !v)}
          disabled={isStreaming}
          className="disabled:opacity-40 hidden md:inline-flex"
        >
          历史
        </V4Btn>
        <V4Btn
          variant="primary"
          size="sm"
          icon="sparkle"
          onClick={handleNewSession}
          disabled={isStreaming}
          className="disabled:opacity-40"
        >
          新对话
        </V4Btn>

        {showHistory && activePet && (
          <SessionList
            petId={activePet.id}
            currentSessionId={sessionId}
            onSelect={(sid) => {
              if (isStreaming) {
                toast('请等当前对话完成', { kind: 'error' })
                return
              }
              switchTo(sid)
              setBlocks([])
            }}
            onClose={() => setShowHistory(false)}
            onCurrentDeleted={() => {
              // 删的是当前会话：开一个新空白会话
              newSession()
              setBlocks([])
              toast('当前对话已删除，已开新对话', { kind: 'success' })
            }}
          />
        )}
      </div>

      {/* 消息流（与 toolbar 共享 scrollable 区域；toolbar 上滑后释放高度给 messages）*/}
        {historyLoading && (
          <p className="text-xs text-center py-2" style={{ color: 'var(--v4-faint)' }}>
            加载历史中…
          </p>
        )}

        {isEmpty && !historyLoading && (
          <EmptyHero onQuickPick={handleQuickPick} />
        )}

        {blocks.map((b) => {
          if (b.kind === 'user') {
            return (
              <UserMessage
                key={b.id}
                content={b.data.content}
                imageUrl={b.data.imageUrl}
                vlmTask={b.data.task}
                vlmOutput={b.data.vlmOutput}
              />
            )
          }
          if (b.kind === 'task') return <TaskBadge key={b.id} task={b.data.task} />
          if (b.kind === 'vlm') return <VLMCard key={b.id} task={b.data.task} output={b.data.output} />
          if (b.kind === 'tool') {
            return (
              <ToolCallCard
                key={b.id}
                tool={b.data.tool}
                args={b.data.args}
                result={b.data.result}
                summary={b.data.summary}
                status={b.data.status}
              />
            )
          }
          if (b.kind === 'thinking') return <AssistantThinking key={b.id} content={b.data.content} />
          if (b.kind === 'assistant') return <AssistantMessage key={b.id} content={b.data.content} />
          return null
        })}

        {isStreaming && <ThinkingCard stage={streamStage} startedAt={streamStartAt} />}
        {/* anchor for auto-scroll-to-bottom (window-level scroll) */}
        <div ref={scrollRef} />
      </div>

      {/* 输入区：shrink-0 在 flex column 底部固定，不会被消息流挤压 */}
      <div className="shrink-0 -mx-3 sm:-mx-6">
        <ChatInput
          key={'in-' + inputDraftSeed}
          initialText={inputDraft}
          onSubmit={handleSubmit}
          disabled={isStreaming || !sessionId}
          isStreaming={isStreaming}
          onCancel={handleCancel}
        />
      </div>
    </div>
  )
}

/** 流式等待卡：阶段文案 + 已思考秒数。
 *  Qwen3 + RAG 首 token 前常有 10-20s，静默等待像卡死；
 *  这里把过程透明化（路由 → VLM → 工具 → 推理），演示时也有话可讲。
 *  @param {{ stage: string, startedAt: number }} props */
function ThinkingCard({ stage, startedAt }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const seconds = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0

  return (
    <div
      className="flex items-center gap-3 rounded-xl border px-4 py-3 mb-3 max-w-md"
      style={{ background: 'var(--v4-card)', borderColor: 'var(--v4-line)' }}
    >
      <span className="flex items-end gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block w-2 h-2 rounded-full animate-bounce motion-reduce:animate-none"
            style={{ background: 'var(--v4-accent)', animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: 'var(--v4-ink)' }}>
          {stage || '思考中…'}
        </p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--v4-faint)' }}>
          已思考 {seconds} 秒 · 多轮工具编排通常需要 20-60 秒
        </p>
      </div>
    </div>
  )
}

/** @param {{ onQuickPick: (p: QuickPrompt) => void }} props */
function EmptyHero({ onQuickPick }) {
  return (
    <div className="text-center py-8">
      <div
        className="inline-flex items-center justify-center w-16 h-16 rounded-full shadow-sm"
        style={{ background: 'var(--v4-accent-soft)' }}
      >
        <Illo name="cat-face" size={48} color="white" secondary="white" />
      </div>
      <h2 className="text-lg font-semibold mt-3" style={{ color: 'var(--v4-ink)' }}>
        和 PetPal 聊聊
      </h2>
      <p className="text-sm mt-1 mb-6" style={{ color: 'var(--v4-mute)' }}>
        多模态 agent：拍照 / 文字 / 询问医院 / 行为分析都可以
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md mx-auto">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onQuickPick(p)}
            className="text-left rounded-xl p-3 border transition group hover:shadow-md backdrop-blur-sm"
            style={{
              background: 'color-mix(in oklch, var(--v4-card) 65%, transparent)',
              borderColor: 'var(--v4-line)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--v4-accent)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--v4-line)'
            }}
          >
            <p
              className="text-sm font-medium transition group-hover:underline"
              style={{ color: 'var(--v4-ink)' }}
            >
              {p.label}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--v4-faint)' }}>
              {p.reminder ? `📎 ${p.hint}` : p.hint}
            </p>
          </button>
        ))}
      </div>
      <p className="text-[10px] mt-4" style={{ color: 'var(--v4-faint)' }}>
        点击预设把示例填到输入框；含 📎 的需要补图片或修改后再发送
      </p>
    </div>
  )
}
