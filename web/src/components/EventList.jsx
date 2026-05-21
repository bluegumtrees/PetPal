const EVENT_LABEL = {
  bcs: { icon: '⚖️', label: 'BCS 体态' },
  symptom: { icon: '🤒', label: '症状' },
  vaccine: { icon: '💉', label: '疫苗' },
  grooming: { icon: '🛁', label: '洗澡美容' },
  photo: { icon: '📸', label: '拍照' },
  feeding: { icon: '🍖', label: '饮食' },
  weight: { icon: '📊', label: '称重' },
  emotion: { icon: '😺', label: '情绪' },
  pain_fgs: { icon: '🩺', label: '疼痛评估' },
  milestone: { icon: '🏆', label: '里程碑' },
  note: { icon: '📝', label: '备忘' },
}

const SEVERITY_STYLE = {
  critical: 'text-red-700 bg-red-50 border-red-200',
  high: 'text-orange-700 bg-orange-50 border-orange-200',
  medium: 'text-amber-700 bg-amber-50 border-amber-200',
  low: 'text-slate-600 bg-slate-50 border-slate-200',
}

/** 按 event_type 渲染 payload 关键字段，避免直接 dump JSON */
function renderPayload(eventType, payload) {
  if (!payload || Object.keys(payload).length === 0) return null

  switch (eventType) {
    case 'symptom': {
      const sev = payload.severity
      const sevStyle = SEVERITY_STYLE[sev] || SEVERITY_STYLE.low
      // 取除 symptom_desc / severity 之外的字段当补充细节
      const extras = Object.entries(payload).filter(
        ([k]) => k !== 'symptom_desc' && k !== 'severity'
      )
      return (
        <div className="text-sm text-slate-700 space-y-1">
          {payload.symptom_desc && <p className="font-medium">{payload.symptom_desc}</p>}
          <div className="flex flex-wrap gap-1.5 items-center">
            {sev && (
              <span className={`px-1.5 py-0.5 rounded text-xs border ${sevStyle}`}>
                严重度: {sev}
              </span>
            )}
            {extras.map(([k, v]) => (
              <span key={k} className="text-xs text-slate-500">
                · {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </span>
            ))}
          </div>
        </div>
      )
    }
    case 'emotion':
      return (
        <p className="text-sm text-slate-700">
          主导情绪: <strong>{payload.main_emotion || '?'}</strong>
          {typeof payload.confidence === 'number' && (
            <span className="text-xs text-slate-400 ml-2">
              置信 {Math.round(payload.confidence * 100)}%
            </span>
          )}
        </p>
      )
    case 'bcs':
      return (
        <div className="text-sm text-slate-700">
          <p>
            评分: <strong className="text-base text-emerald-700">{payload.bcs_score}</strong>
            <span className="text-xs text-slate-400 ml-1">/ 9</span>
          </p>
          {payload.rationale && (
            <p className="text-xs text-slate-500 mt-0.5">{payload.rationale}</p>
          )}
        </div>
      )
    case 'pain_fgs':
      return (
        <div className="text-sm text-slate-700">
          <p>
            总分: <strong>{payload.total_score}</strong>
            <span className="text-xs text-slate-400 ml-1">/ 10</span>
            {typeof payload.normalized === 'number' && (
              <span className="text-xs text-slate-400 ml-2">归一化 {payload.normalized}</span>
            )}
          </p>
        </div>
      )
    case 'vaccine':
      return (
        <p className="text-sm text-slate-700">
          {payload.vaccine_name || payload.name || '疫苗记录'}
          {payload.brand && <span className="text-xs text-slate-400 ml-2">{payload.brand}</span>}
        </p>
      )
    case 'feeding':
    case 'grooming':
      return (
        <p className="text-sm text-slate-700">
          {payload.description || payload.note_text || JSON.stringify(payload)}
        </p>
      )
    default: {
      // 通用兜底：把字段平铺成 "key: value" 一行一条，不再 dump JSON
      const entries = Object.entries(payload).filter(([, v]) => v != null && v !== '')
      if (entries.length === 0) return null
      return (
        <div className="text-xs text-slate-600 space-y-0.5">
          {entries.slice(0, 5).map(([k, v]) => (
            <p key={k}>
              <span className="text-slate-400">{k}:</span>{' '}
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
      <p className="text-sm text-slate-400 text-center py-8">
        还没有事件记录。在 P4 接入 agent 后，VLM 分析结果会自动写入这里。
      </p>
    )
  }

  return (
    <ol className="relative border-l-2 border-slate-200 ml-3 space-y-4 pl-5">
      {events.map((ev) => {
        const meta = EVENT_LABEL[ev.event_type] || { icon: '📝', label: ev.event_type }
        return (
          <li key={ev.id} className="relative">
            <span className="absolute -left-[35px] top-1 w-6 h-6 rounded-full bg-white border-2 border-amber-300 flex items-center justify-center text-xs">
              {meta.icon}
            </span>
            <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="font-medium text-sm text-slate-800">{meta.label}</span>
                <time className="text-xs text-slate-400">
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
                <p className="text-sm text-slate-700">
                  <strong className="text-base text-emerald-700">{ev.payload.weight_kg} kg</strong>
                  {typeof ev.payload.previous === 'number' && (
                    <span className="text-xs text-slate-400 ml-2">
                      （上次 {ev.payload.previous} kg
                      {typeof ev.payload.delta === 'number' && ev.payload.delta !== 0 && (
                        <>
                          ,{' '}
                          <span className={ev.payload.delta > 0 ? 'text-orange-600' : 'text-blue-600'}>
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
                <div className="text-sm text-slate-700">
                  <p className="font-medium">🏆 {ev.payload.title}</p>
                  {ev.payload.description && (
                    <p className="text-xs text-slate-500 mt-0.5">{ev.payload.description}</p>
                  )}
                </div>
              ) : ev.event_type === 'note' && ev.payload?.text ? (
                <p className="text-sm text-slate-700">{ev.payload.text}</p>
              ) : (
                renderPayload(ev.event_type, ev.payload)
              )}
              {ev.note && <p className="text-xs text-slate-500 mt-1.5">📝 {ev.note}</p>}
              {ev.image_url && (
                <img
                  src={ev.image_url}
                  alt=""
                  className="mt-2 rounded max-h-32 object-contain"
                />
              )}
              {onDelete && (
                <button
                  onClick={() => onDelete(ev.id)}
                  className="mt-2 text-xs text-red-500 hover:text-red-700"
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
