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
              ) : (
                Object.keys(ev.payload || {}).length > 0 && (
                  <pre className="text-xs text-slate-600 bg-slate-50 rounded p-2 overflow-x-auto">
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                )
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
