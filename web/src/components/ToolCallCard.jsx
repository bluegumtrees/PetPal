import { useState } from 'react'

const TOOL_META = {
  retrieve_vet_knowledge: { icon: '📚', label: '检索兽医知识库' },
  query_pet_history:      { icon: '📜', label: '查询历史' },
  save_pet_event:         { icon: '💾', label: '保存事件' },
  reanalyze_image:        { icon: '🔍', label: '重新看图' },
  find_nearby_clinic:     { icon: '🏥', label: '查找附近医院' },
  send_alert_email:       { icon: '📧', label: '发送邮件提醒' },
}

/**
 * 渲染一次 tool 调用（args + result 折叠）。
 * @param {{ tool: string, args: object, result?: object, summary?: string, status: 'running'|'done'|'error' }} props
 */
export default function ToolCallCard({ tool, args, result, summary, status }) {
  const [open, setOpen] = useState(false)
  const meta = TOOL_META[tool] || { icon: '🔧', label: tool }
  const argsCompact = JSON.stringify(args || {}, null, 0)
  const argsShort = argsCompact.length > 80 ? argsCompact.slice(0, 80) + '…' : argsCompact

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl my-1.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-100 rounded-xl transition"
      >
        <span>{meta.icon}</span>
        <span className="text-xs font-medium text-slate-700">{meta.label}</span>
        <code className="text-[10px] text-slate-500 font-mono truncate flex-1 mx-1">
          {argsShort}
        </code>
        {status === 'running' && (
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        )}
        {status === 'done' && (
          <span className="text-xs text-emerald-600">✓</span>
        )}
        {status === 'error' && (
          <span className="text-xs text-red-500">✕</span>
        )}
        {summary && (
          <span className="text-[10px] text-slate-400 font-mono ml-1">{summary.slice(0, 30)}</span>
        )}
        <span className="text-xs text-slate-400 ml-1">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div>
            <p className="text-[10px] text-slate-500 mb-0.5 uppercase tracking-wide">args</p>
            <pre className="text-xs text-slate-700 bg-white border border-slate-200 rounded p-2 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(args || {}, null, 2)}
            </pre>
          </div>
          {result && (
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5 uppercase tracking-wide">result</p>
              <pre className="text-xs text-slate-700 bg-white border border-slate-200 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-64">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
