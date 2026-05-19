const TASK_META = {
  chat:     { label: 'chat',     emoji: '💬', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  symptom:  { label: 'symptom',  emoji: '🤒', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  emotion:  { label: 'emotion',  emoji: '😺', cls: 'bg-pink-50 text-pink-700 border-pink-200' },
  bcs:      { label: 'bcs',      emoji: '⚖️', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  pain_fgs: { label: 'pain_fgs', emoji: '🩺', cls: 'bg-red-50 text-red-700 border-red-200' },
}

/** @param {{ task: string }} props */
export default function TaskBadge({ task }) {
  const m = TASK_META[task] || { label: task, emoji: '🏷', cls: 'bg-slate-100 text-slate-600 border-slate-200' }
  return (
    <div className="flex items-center justify-center my-2">
      <span className={'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs border ' + m.cls}>
        <span>{m.emoji}</span>
        <span className="font-mono">{m.label}</span>
      </span>
    </div>
  )
}
