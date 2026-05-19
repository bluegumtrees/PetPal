import { useEffect, useState } from 'react'
import { api } from '../api'

const TYPES = [
  { key: 'vaccine', label: '💉 疫苗' },
  { key: 'grooming', label: '🛁 洗澡' },
  { key: 'symptom', label: '🤒 症状' },
]

function nowLocalDatetimeValue() {
  const d = new Date()
  const tzOff = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tzOff).toISOString().slice(0, 16)
}

/** @param {{ petId: number, onClose: () => void, onSubmitted: () => void }} props */
export default function AddEventModal({ petId, onClose, onSubmitted }) {
  const [type, setType] = useState('vaccine')
  const [vaccineName, setVaccineName] = useState('')
  const [symptomDesc, setSymptomDesc] = useState('')
  const [note, setNote] = useState('')
  const [happenedAt, setHappenedAt] = useState(nowLocalDatetimeValue)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  async function handleSubmit() {
    setError('')
    setSubmitting(true)
    try {
      const payload = {}
      if (type === 'vaccine') {
        if (!vaccineName.trim()) throw new Error('请填写疫苗名称')
        payload.vaccine_name = vaccineName.trim()
      }
      if (type === 'symptom') {
        if (!symptomDesc.trim()) throw new Error('请填写症状描述')
        payload.symptom_desc = symptomDesc.trim()
        payload.severity = 'medium'
        payload.source = 'manual'
      }
      // grooming 只有时间和备注，payload 空对象即可
      await api('/api/events', {
        method: 'POST',
        body: {
          pet_id: petId,
          event_type: type,
          payload,
          note: note.trim() || null,
          happened_at: new Date(happenedAt).toISOString(),
        },
      })
      onSubmitted()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-medium text-slate-800">添加事件</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="close"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setType(t.key)
                setError('')
              }}
              className={`px-2 py-2 rounded-lg text-xs transition ${
                type === t.key
                  ? 'bg-amber-100 text-amber-700 border-2 border-amber-300'
                  : 'bg-slate-50 text-slate-600 border-2 border-transparent hover:bg-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {type === 'vaccine' && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">疫苗名称</label>
              <input
                type="text"
                value={vaccineName}
                onChange={(e) => setVaccineName(e.target.value)}
                placeholder="例如 猫三联 / 狂犬"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400"
                autoFocus
              />
            </div>
          )}

          {type === 'symptom' && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">症状描述</label>
              <textarea
                value={symptomDesc}
                onChange={(e) => setSymptomDesc(e.target.value)}
                placeholder="例如：早上吐了两次黄水"
                rows={3}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 resize-none"
                autoFocus
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-500 mb-1">发生时间</label>
            <input
              type="datetime-local"
              value={happenedAt}
              onChange={(e) => setHappenedAt(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">备注（可选）</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="备注信息"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400"
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-5 py-2 rounded-lg text-sm bg-amber-500 text-white hover:bg-amber-600 transition disabled:opacity-50"
          >
            {submitting ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
