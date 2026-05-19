import { useState } from 'react'

/**
 * 把 VLM 输出格式化为简短标签，供缩略图叠加。
 * @param {string} task
 * @param {object} output
 * @returns {{ label: string, kind: 'info'|'warn'|'alert' } | null}
 */
export function vlmBadge(task, output) {
  if (!output || output._error) return null
  try {
    if (task === 'symptom') {
      const sev = output.severity
      const first = (output.possible_symptoms || [])[0]
      if (!first) return null
      const kind = sev === 'high' ? 'alert' : sev === 'medium' ? 'warn' : 'info'
      return { label: `${sev || '?'} · ${first}`, kind }
    }
    if (task === 'emotion') {
      const top = (output.candidate_emotions || [])[0]
      if (!top) return null
      const pct = Math.round((top.confidence || 0) * 100)
      return { label: `${pct}% ${top.emotion}`, kind: 'info' }
    }
    if (task === 'bcs') {
      const score = output.bcs_score
      if (score == null) return null
      const desc = score >= 7 ? '偏胖' : score <= 3 ? '偏瘦' : score === 5 ? '理想' : score === 4 ? '略瘦' : '略胖'
      const kind = score >= 8 || score <= 2 ? 'alert' : score >= 7 || score <= 3 ? 'warn' : 'info'
      return { label: `BCS ${score} ${desc}`, kind }
    }
    if (task === 'pain_fgs') {
      const score = output.total_score
      const norm = output.normalized
      if (score == null) return null
      const desc = norm > 0.39 ? '需镇痛干预' : '无显著疼痛'
      const kind = norm > 0.39 ? 'alert' : 'info'
      return { label: `FGS ${score}/10 · ${desc}`, kind }
    }
  } catch {
    return null
  }
  return null
}

/** @param {{ task: string, output: object }} props */
export default function VLMCard({ task, output }) {
  const [open, setOpen] = useState(false)
  const badge = vlmBadge(task, output)

  if (output?._error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 my-2">
        VLM 失败: {output._error}
      </div>
    )
  }

  return (
    <div className="bg-violet-50 border border-violet-200 rounded-xl my-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-violet-100 rounded-xl transition"
      >
        <span>📷</span>
        <span className="text-xs font-medium text-violet-700">VLM 分析（{task}）</span>
        {badge && (
          <span
            className={
              'ml-2 px-2 py-0.5 rounded text-[10px] font-mono ' +
              (badge.kind === 'alert'
                ? 'bg-red-100 text-red-700'
                : badge.kind === 'warn'
                ? 'bg-orange-100 text-orange-700'
                : 'bg-white text-violet-600')
            }
          >
            {badge.label}
          </span>
        )}
        <span className="flex-1" />
        <span className="text-xs text-violet-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <pre className="text-xs text-slate-700 px-3 pb-3 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(output, null, 2)}
        </pre>
      )}
    </div>
  )
}
