import { Illo } from './v4'

const EVENT_LABEL = {
  bcs: { icon: 'scale', label: 'BCS 体态' },
  symptom: { icon: 'drop', label: '症状' },
  vaccine: { icon: 'syringe', label: '疫苗' },
  grooming: { icon: 'bath', label: '洗澡美容' },
  photo: { icon: 'camera', label: '拍照' },
  feeding: { icon: 'fish', label: '饮食' },
  weight: { icon: 'scale', label: '称重' },
  emotion: { icon: 'heart', label: '情绪' },
  pain_fgs: { icon: 'sparkle', label: '疼痛评估' },
  milestone: { icon: 'crown', label: '里程碑' },
  note: { icon: 'leaf', label: '备忘' },
}

/** 严重度 → V4 token { bg, color } */
function severityStyle(sev) {
  switch (sev) {
    case 'critical':
    case 'high':
      return { bg: 'var(--v4-warn-soft)', color: 'var(--v4-warn)' }
    case 'medium':
      return { bg: 'var(--v4-accent-soft)', color: 'var(--v4-accent-deep)' }
    case 'low':
    default:
      return { bg: 'var(--v4-tint)', color: 'var(--v4-mute)' }
  }
}

/** 按 event_type 渲染 payload 关键字段，避免直接 dump JSON */
function renderPayload(eventType, payload) {
  if (!payload || Object.keys(payload).length === 0) return null

  switch (eventType) {
    case 'symptom': {
      const sev = payload.severity
      const sevStyle = severityStyle(sev)
      const extras = Object.entries(payload).filter(
        ([k]) => k !== 'symptom_desc' && k !== 'severity'
      )
      return (
        <div className="text-sm space-y-1" style={{ color: 'var(--v4-ink)' }}>
          {payload.symptom_desc && <p className="font-medium">{payload.symptom_desc}</p>}
          <div className="flex flex-wrap gap-1.5 items-center">
            {sev && (
              <span
                className="px-1.5 py-0.5 rounded text-xs"
                style={{ background: sevStyle.bg, color: sevStyle.color }}
              >
                严重度: {sev}
              </span>
            )}
            {extras.map(([k, v]) => (
              <span key={k} className="text-xs" style={{ color: 'var(--v4-mute)' }}>
                · {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </span>
            ))}
          </div>
        </div>
      )
    }
    case 'emotion':
      return (
        <p className="text-sm" style={{ color: 'var(--v4-ink)' }}>
          主导情绪: <strong>{payload.main_emotion || '?'}</strong>
          {typeof payload.confidence === 'number' && (
            <span className="text-xs ml-2" style={{ color: 'var(--v4-faint)' }}>
              置信 {Math.round(payload.confidence * 100)}%
            </span>
          )}
        </p>
      )
    case 'bcs':
      return (
        <div className="text-sm" style={{ color: 'var(--v4-ink)' }}>
          <p>
            评分:{' '}
            <strong className="text-base" style={{ color: 'var(--v4-second)' }}>
              {payload.bcs_score}
            </strong>
            <span className="text-xs ml-1" style={{ color: 'var(--v4-faint)' }}>
              / 9
            </span>
          </p>
          {payload.rationale && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--v4-mute)' }}>
              {payload.rationale}
            </p>
          )}
        </div>
      )
    case 'pain_fgs':
      return (
        <div className="text-sm" style={{ color: 'var(--v4-ink)' }}>
          <p>
            总分: <strong>{payload.total_score}</strong>
            <span className="text-xs ml-1" style={{ color: 'var(--v4-faint)' }}>
              / 10
            </span>
            {typeof payload.normalized === 'number' && (
              <span className="text-xs ml-2" style={{ color: 'var(--v4-faint)' }}>
                归一化 {payload.normalized}
              </span>
            )}
          </p>
        </div>
      )
    case 'vaccine':
      return (
        <p className="text-sm" style={{ color: 'var(--v4-ink)' }}>
          {payload.vaccine_name || payload.name || '疫苗记录'}
          {payload.brand && (
            <span className="text-xs ml-2" style={{ color: 'var(--v4-faint)' }}>
              {payload.brand}
            </span>
          )}
        </p>
      )
    case 'feeding':
    case 'grooming':
      return (
        <p className="text-sm" style={{ color: 'var(--v4-ink)' }}>
          {payload.description || payload.note_text || JSON.stringify(payload)}
        </p>
      )
    default: {
      const entries = Object.entries(payload).filter(([, v]) => v != null && v !== '')
      if (entries.length === 0) return null
      return (
        <div className="text-xs space-y-0.5" style={{ color: 'var(--v4-mute)' }}>
          {entries.slice(0, 5).map(([k, v]) => (
            <p key={k}>
              <span style={{ color: 'var(--v4-faint)' }}>{k}:</span>{' '}
              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </p>
          ))}
        </div>
      )
    }
  }
}

/** @param {{ events: any[], onDelete?: (id:number)=>void }} props */
export default function EventList({ events, onDelete }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-center py-8" style={{ color: 'var(--v4-faint)' }}>
        还没有事件记录。
      </p>
    )
  }

  return (
    <ol
      className="relative border-l-2 ml-3 space-y-4 pl-5"
      style={{ borderColor: 'var(--v4-line)' }}
    >
      {events.map((ev) => {
        const meta = EVENT_LABEL[ev.event_type] || { icon: 'leaf', label: ev.event_type }
        return (
          <li key={ev.id} className="relative">
            <span
              className="absolute -left-[35px] top-1 w-7 h-7 rounded-full border-2 flex items-center justify-center"
              style={{
                background: 'var(--v4-card)',
                borderColor: 'var(--v4-accent)',
              }}
            >
              <Illo name={meta.icon} size={14} color="var(--v4-accent)" />
            </span>
            <div
              className="rounded-lg border p-3 shadow-sm"
              style={{ background: 'var(--v4-card)', borderColor: 'var(--v4-line)' }}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="font-medium text-sm" style={{ color: 'var(--v4-ink)' }}>
                  {meta.label}
                </span>
                <time className="text-xs" style={{ color: 'var(--v4-faint)' }}>
                  {new Date(ev.happened_at).toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
              {ev.event_type === 'weight' && typeof ev.payload?.weight_kg === 'number' ? (
                <p className="text-sm" style={{ color: 'var(--v4-ink)' }}>
                  <strong className="text-base" style={{ color: 'var(--v4-second)' }}>
                    {ev.payload.weight_kg} kg
                  </strong>
                  {typeof ev.payload.previous === 'number' && (
                    <span className="text-xs ml-2" style={{ color: 'var(--v4-faint)' }}>
                      （上次 {ev.payload.previous} kg
                      {typeof ev.payload.delta === 'number' && ev.payload.delta !== 0 && (
                        <>
                          ,{' '}
                          <span
                            style={{
                              color:
                                ev.payload.delta > 0 ? 'var(--v4-warn)' : 'var(--v4-second)',
                            }}
                          >
                            {ev.payload.delta > 0 ? '+' : ''}
                            {ev.payload.delta} kg
                          </span>
                        </>
                      )}
                      ）
                    </span>
                  )}
                </p>
              ) : ev.event_type === 'milestone' && ev.payload?.title ? (
                <div className="text-sm" style={{ color: 'var(--v4-ink)' }}>
                  <p className="font-medium inline-flex items-center gap-1">
                    <Illo name="crown" size={14} color="var(--v4-warn)" />
                    {ev.payload.title}
                  </p>
                  {ev.payload.description && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--v4-mute)' }}>
                      {ev.payload.description}
                    </p>
                  )}
                </div>
              ) : ev.event_type === 'note' && ev.payload?.text ? (
                <p className="text-sm" style={{ color: 'var(--v4-ink)' }}>
                  {ev.payload.text}
                </p>
              ) : (
                renderPayload(ev.event_type, ev.payload)
              )}
              {ev.note && (
                <p className="text-xs mt-1.5 inline-flex items-center gap-1" style={{ color: 'var(--v4-mute)' }}>
                  <Illo name="leaf" size={10} color="var(--v4-mute)" />
                  {ev.note}
                </p>
              )}
              {ev.image_url && (
                <img
                  src={ev.image_url}
                  alt=""
                  className="mt-2 rounded max-h-32 object-contain"
                  style={{ background: 'var(--v4-tint)' }}
                />
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(ev.id)}
                  className="mt-2 text-xs transition"
                  style={{ color: 'var(--v4-warn)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.7')}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                >
                  删除
                </button>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
