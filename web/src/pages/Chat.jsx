import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, streamChat } from '../api'
import ChatInput from '../components/ChatInput'
import {
  AssistantMessage,
  AssistantThinking,
  UserMessage,
} from '../components/MessageCard'
import TaskBadge from '../components/TaskBadge'
import ToolCallCard from '../components/ToolCallCard'
import VLMCard from '../components/VLMCard'
import Avatar from '../components/Avatar'
import { useToast } from '../components/Toast'
import { usePets } from '../context/PetContext'
import useSession from '../hooks/useSession'

/**
 * @typedef {Object} QuickPrompt
 * @property {string} label
 * @property {string} text       预填到输入框的文字
 * @property {string} hint       说明
 * @property {boolean} autoSend  true 直接发送；false 只填充输入框 + toast 提醒
 * @property {string} [reminder] autoSend=false 时的 toast 文案
 */

/** @type {QuickPrompt[]} */
const QUICK_PROMPTS = [
  {
    label: '📸 评估体态',
    text: '看看它的体态评分怎么样',
    hint: '需上传侧身全身照',
    autoSend: false,
    reminder: '请上传一张猫/狗的侧身全身照再发送，BCS 评分需要看到肋骨/腰部',
  },
  {
    label: '🤒 描述症状',
    text: '我家猫今天吐了 2 次，没什么精神',
    hint: '文字咨询',
    autoSend: true,
  },
  {
    label: '😺 情绪解读',
    text: '它最近躲着我，是不是不开心？',
    hint: '可附张照片更准',
    autoSend: true,
  },
  {
    label: '💉 疫苗提醒',
    text: '帮我查下下次该打什么疫苗',
    hint: '日程',
    autoSend: true,
  },
  {
    label: '🏥 找医院',
    text: '我在北京海淀，附近有什么宠物医院？',
    hint: '把地址改成你所在城市',
    autoSend: false,
    reminder: '把示例里的「北京海淀」换成你所在城市/区再发送',
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
  const { sessionId, newSession } = useSession(activePet?.id)
  const toast = useToast()

  /** @type {[UIBlock[], Function]} */
  const [blocks, setBlocks] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
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
                // 历史里的 duplicate/skipped 也不展示（同实时流逻辑）
                if (tc.result?.duplicate === true || tc.result?.skipped === true) {
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

  // 自动滚到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
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
              const key = runningToolIds[ev.tool + '-' + ev.iter]
              // duplicate / skipped 视觉噪声——直接从 UI 移除（数据已审计在 db）
              const isNoise = ev.result?.duplicate === true || ev.result?.skipped === true
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

  // 快速预设点击：autoSend=true 直接发；否则填充输入框 + toast 提醒
  const handleQuickPick = useCallback(
    (p) => {
      if (p.autoSend) {
        handleSubmit({ text: p.text, image: null })
      } else {
        setInputDraft(p.text)
        setInputDraftSeed((n) => n + 1)
        toast(p.reminder || '请补充信息后发送', { kind: 'info', durationMs: 5000 })
      }
    },
    [handleSubmit, toast]
  )

  // 空 / 无宠物 时
  if (petsLoading) {
    return <p className="text-sm text-slate-400 text-center py-10">加载中…</p>
  }
  if (pets.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center shadow-sm">
        <span className="text-5xl">🐾</span>
        <h2 className="text-xl font-semibold text-slate-800 mt-3 mb-1">和 PetPal 聊天前</h2>
        <p className="text-sm text-slate-500 mb-6">先建一只宠物档案，agent 才能基于它给出建议</p>
        <Link
          to="/pets/new"
          className="inline-block bg-amber-500 hover:bg-amber-600 text-white px-5 py-2.5 rounded-xl transition"
        >
          + 新建宠物
        </Link>
      </div>
    )
  }

  const isEmpty = blocks.length === 0

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 60px - 60px)' }}>
      {/* session 工具栏 */}
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-slate-200">
        <Avatar pet={activePet} size={36} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-700">{activePet.name}</p>
          <p className="text-[10px] text-slate-400 font-mono truncate">
            session: {sessionId?.slice(0, 8)}…
          </p>
        </div>
        <button
          type="button"
          onClick={handleNewSession}
          disabled={isStreaming}
          className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-40 transition"
        >
          + 新对话
        </button>
      </div>

      {/* 消息流 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto pb-4"
        style={{ minHeight: '300px' }}
      >
        {historyLoading && (
          <p className="text-xs text-slate-400 text-center py-2">加载历史中…</p>
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

        {isStreaming && (
          <div className="text-xs text-slate-400 text-center py-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse mr-1" />
            思考中…
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="mt-auto -mx-6 -mb-20">
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

/** @param {{ onQuickPick: (p: QuickPrompt) => void }} props */
function EmptyHero({ onQuickPick }) {
  return (
    <div className="text-center py-8">
      <span className="text-4xl">🐾</span>
      <h2 className="text-lg font-semibold text-slate-800 mt-2">和 PetPal 聊聊</h2>
      <p className="text-sm text-slate-500 mt-1 mb-6">
        多模态 agent：拍照 / 文字 / 询问医院 / 行为分析都可以
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md mx-auto">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onQuickPick(p)}
            className="text-left bg-white border border-slate-200 rounded-xl p-3 hover:border-amber-300 hover:shadow-md transition group"
          >
            <p className="text-sm font-medium text-slate-700 group-hover:text-amber-600 transition">
              {p.label}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {p.autoSend ? p.hint : `📎 ${p.hint}`}
            </p>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 mt-4">
        含 📎 的预设点击后只填到输入框，需要你补图片或改地址后再发送
      </p>
    </div>
  )
}
