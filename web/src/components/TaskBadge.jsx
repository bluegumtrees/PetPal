import { Illo } from './v4'

/** task → { label, icon, tint, fg }（用 CSS vars 让主题切换跟随）*/
const TASK_META = {
  chat: {
    label: 'chat',
    icon: 'cloud',
    tint: 'var(--v4-tint)',
    fg: 'var(--v4-mute)',
  },
  symptom: {
    label: 'symptom',
    icon: 'drop',
    tint: 'var(--v4-warn-soft)',
    fg: 'var(--v4-warn)',
  },
  emotion: {
    label: 'emotion',
    icon: 'heart',
    tint: 'var(--v4-accent-soft)',
    fg: 'var(--v4-accent-deep)',
  },
  bcs: {
    label: 'bcs',
    icon: 'scale',
    tint: 'var(--v4-second-soft)',
    fg: 'var(--v4-second)',
  },
  pain_fgs: {
    label: 'pain_fgs',
    icon: 'sparkle',
    tint: 'var(--v4-warn-soft)',
    fg: 'var(--v4-warn)',
  },
}

/** @param {{ task: string }} props */
export default function TaskBadge({ task }) {
  const m = TASK_META[task] || {
    label: task,
    icon: 'paw',
    tint: 'var(--v4-tint)',
    fg: 'var(--v4-mute)',
  }
  return (
    <div className="flex items-center justify-center my-2">
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
        style={{ background: m.tint, color: m.fg }}
      >
        <Illo name={m.icon} size={12} color={m.fg} />
        <span className="font-mono font-semibold">{m.label}</span>
      </span>
    </div>
  )
}
