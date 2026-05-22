import { useState } from 'react'
import { Illo } from './v4'

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
      <div
        className="rounded-lg p-3 text-xs my-2 border"
        style={{
          background: 'var(--v4-warn-soft)',
          borderColor: 'var(--v4-warn)',
          color: 'var(--v4-warn)',
        }}
      >
        VLM 失败: {output._error}
      </div>
    )
  }

  // badge 颜色：alert=warn / warn=accent / info=mute
  const badgeStyle = badge
    ? badge.kind === 'alert'
      ? { background: 'var(--v4-warn)', color: 'white' }
      : badge.kind === 'warn'
      ? { background: 'var(--v4-accent)', color: 'white' }
      : { background: 'var(--v4-card)', color: 'var(--v4-accent-deep)' }
    : null

  return (
    <div
      className="rounded-xl my-2 border"
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
        style={{ color: 'var(--v4-ink)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v4-accent-soft)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <Illo name="camera" size={14} color="var(--v4-accent)" />
        <span className="text-xs font-medium" style={{ color: 'var(--v4-accent-deep)' }}>
          VLM 分析（{task}）
        </span>
        {badge && (
          <span
            className="ml-2 px-2 py-0.5 rounded text-[10px] font-mono"
            style={badgeStyle}
          >
            {badge.label}
          </span>
        )}
        <span className="flex-1" />
        <span className="text-xs" style={{ color: 'var(--v4-faint)' }}>
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <pre
          className="text-xs px-3 pb-3 overflow-x-auto whitespace-pre-wrap"
          style={{ color: 'var(--v4-mute)' }}
        >
          {JSON.stringify(output, null, 2)}
        </pre>
      )}
    </div>
  )
}
