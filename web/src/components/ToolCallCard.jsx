import { useState } from 'react'
import { Illo } from './v4'

/** tool → { icon (Illo name), label, tone }（V4 跟随主题）*/
const TOOL_META = {
  retrieve_vet_knowledge: { icon: 'leaf', label: '检索兽医知识库', tone: 'second' },
  query_pet_history: { icon: 'moon', label: '查询历史', tone: 'mute' },
  save_pet_event: { icon: 'star', label: '保存事件', tone: 'accent' },
  update_pet_event: { icon: 'sparkle', label: '更新事件', tone: 'accent' },
  reanalyze_image: { icon: 'camera', label: '重新看图', tone: 'second' },
  find_nearby_clinic: { icon: 'paw', label: '查找附近医院', tone: 'warn' },
  schedule_reminder: { icon: 'bell', label: '设置提醒', tone: 'warn' },
  send_alert_email: { icon: 'cloud', label: '发送邮件提醒', tone: 'mute' },
}

const TONE_FG = {
  accent: 'var(--v4-accent)',
  second: 'var(--v4-second)',
  warn: 'var(--v4-warn)',
  mute: 'var(--v4-mute)',
}

/**
 * 渲染一次 tool 调用（args + result 折叠）。
 * @param {{ tool: string, args: object, result?: object, summary?: string, status: 'running'|'done'|'error' }} props
 */
export default function ToolCallCard({ tool, args, result, summary, status }) {
  const [open, setOpen] = useState(false)
  const meta = TOOL_META[tool] || { icon: 'paw', label: tool, tone: 'mute' }
  const fg = TONE_FG[meta.tone]
  const argsCompact = JSON.stringify(args || {}, null, 0)
  const argsShort = argsCompact.length > 80 ? argsCompact.slice(0, 80) + '…' : argsCompact

  return (
    <div
      className="rounded-xl my-1.5 border"
      style={{
        background: 'var(--v4-tint)',
        borderColor: 'var(--v4-line)',
        boxShadow: 'var(--v4-shadow-sm)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left rounded-xl transition"
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v4-accent-soft)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0"
          style={{ background: 'var(--v4-card)' }}
        >
          <Illo name={meta.icon} size={14} color={fg} />
        </span>
        <span className="text-xs font-medium" style={{ color: 'var(--v4-ink)' }}>
          {meta.label}
        </span>
        <code
          className="text-[10px] font-mono truncate flex-1 mx-1"
          style={{ color: 'var(--v4-faint)' }}
        >
          {argsShort}
        </code>
        {status === 'running' && (
          <span
            className="inline-block w-2 h-2 rounded-full animate-pulse"
            style={{ background: 'var(--v4-accent)' }}
          />
        )}
        {status === 'done' && (
          <span className="text-xs" style={{ color: 'var(--v4-second)' }}>
            ✓
          </span>
        )}
        {status === 'error' && (
          <span className="text-xs" style={{ color: 'var(--v4-warn)' }}>
            ✕
          </span>
        )}
        {summary && (
          <span
            className="text-[10px] font-mono ml-1"
            style={{ color: 'var(--v4-faint)' }}
          >
            {summary.slice(0, 30)}
          </span>
        )}
        <span className="text-xs ml-1" style={{ color: 'var(--v4-faint)' }}>
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div>
            <p
              className="text-[10px] mb-0.5 uppercase tracking-wide"
              style={{ color: 'var(--v4-faint)' }}
            >
              args
            </p>
            <pre
              className="text-xs rounded p-2 overflow-x-auto whitespace-pre-wrap border"
              style={{
                background: 'var(--v4-card)',
                borderColor: 'var(--v4-line)',
                color: 'var(--v4-mute)',
              }}
            >
              {JSON.stringify(args || {}, null, 2)}
            </pre>
          </div>
          {result && (
            <div>
              <p
                className="text-[10px] mb-0.5 uppercase tracking-wide"
                style={{ color: 'var(--v4-faint)' }}
              >
                result
              </p>
              <pre
                className="text-xs rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-64 border"
                style={{
                  background: 'var(--v4-card)',
                  borderColor: 'var(--v4-line)',
                  color: 'var(--v4-mute)',
                }}
              >
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
