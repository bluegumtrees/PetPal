import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api'
import Lightbox from './Lightbox'

const TABS = [
  { key: 'bcs', label: 'BCS 体态', unit: '', yDomain: [1, 9], color: '#f59e0b' },
  { key: 'weight', label: '体重', unit: 'kg', yDomain: ['auto', 'auto'], color: '#10b981' },
  { key: 'pain_fgs', label: 'FGS 疼痛', unit: '', yDomain: [0, 10], color: '#ef4444' },
]

const WINDOWS = [
  { key: '7', label: '近 7 天', days: 7 },
  { key: '30', label: '近 30 天', days: 30 },
  { key: 'all', label: '全部', days: null },
]

const EMPTY_HINT = {
  bcs: '还没有 BCS 评估记录。让 PetPal 评估体态后会自动出现在这里。',
  weight: '还没有体重记录。在上方输入当前体重即可记录第一笔。',
  pain_fgs: '还没有 FGS 疼痛评估。让 PetPal 做 FGS 评估后会自动出现。',
}

function formatX(ts) {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function HoverTooltip({ active, payload, tab }) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload
  const p = row.point
  if (!p) return null
  const dateStr = new Date(p.ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  const delta = p.extra?.delta
  const previous = p.extra?.previous

  return (
    <div className="bg-white/95 backdrop-blur border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <div className="text-slate-400">{dateStr}</div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-base font-semibold" style={{ color: tab.color }}>
          {row.y}
        </span>
        {tab.unit && <span className="text-slate-500">{tab.unit}</span>}
        {typeof delta === 'number' && delta !== 0 && (
          <span className={`text-[11px] font-medium ${delta > 0 ? 'text-orange-600' : 'text-blue-600'}`}>
            {delta > 0 ? '+' : ''}{delta}{tab.unit}
          </span>
        )}
      </div>
      {typeof previous === 'number' && (
        <div className="text-slate-400 text-[11px] mt-0.5">上次 {previous}{tab.unit}</div>
      )}
      <div className="text-[10px] text-slate-300 mt-1">点击数据点查看详情</div>
    </div>
  )
}

/** @param {{ petId: number, currentWeight?: number | null, refreshKey?: number, onWeightLogged?: () => void }} props */
export default function PetTimelineChart({ petId, currentWeight, refreshKey = 0, onWeightLogged }) {
  const [tabKey, setTabKey] = useState('bcs')
  const [windowKey, setWindowKey] = useState('all')
  const [points, setPoints] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lightboxSrc, setLightboxSrc] = useState('')
  const [internalRefresh, setInternalRefresh] = useState(0)
  const [selectedPoint, setSelectedPoint] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // inline 称重
  const [weightInput, setWeightInput] = useState('')
  const [weightSubmitting, setWeightSubmitting] = useState(false)
  const [weightError, setWeightError] = useState('')

  const tab = TABS.find((t) => t.key === tabKey)
  const win = WINDOWS.find((w) => w.key === windowKey)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setSelectedPoint(null)
    const params = new URLSearchParams({
      pet_id: String(petId),
      metric: tab.key,
    })
    if (win.days != null) params.set('days_back', String(win.days))
    api(`/api/events/timeline?${params.toString()}`)
      .then((data) => {
        if (!cancelled) setPoints(data.points || [])
      })
      .catch((e) => {
        if (!cancelled) setError(String(e.message || e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [petId, tab.key, win.days, refreshKey, internalRefresh])

  const chartData = useMemo(
    () =>
      points.map((p) => ({
        ts: new Date(p.ts).getTime(),
        y: p.value,
        point: p,
      })),
    [points]
  )

  async function handleWeightSubmit() {
    setWeightError('')
    const w = parseFloat(weightInput)
    if (isNaN(w) || w <= 0 || w > 100) {
      setWeightError('请输入有效体重（0–100 kg）')
      return
    }
    if (currentWeight != null && Math.abs(w - currentWeight) < 0.001) {
      setWeightError('与上次体重相同，无需记录')
      return
    }
    setWeightSubmitting(true)
    try {
      await api(`/api/pets/${petId}`, {
        method: 'PATCH',
        body: { weight_kg: w },
      })
      setWeightInput('')
      setInternalRefresh((k) => k + 1)
      if (onWeightLogged) onWeightLogged()
    } catch (e) {
      setWeightError(String(e.message || e))
    } finally {
      setWeightSubmitting(false)
    }
  }

  async function handleDeletePoint() {
    if (!selectedPoint) return
    const isSoft = tab.key !== 'weight'
    const confirmMsg = isSoft
      ? '从时序图删除这次评估？\n（聊天记录会保留，仅时序图不再显示）'
      : '删除这次称重记录？\n（同时会从事件时间线消失）'
    if (!window.confirm(confirmMsg)) return
    setDeleting(true)
    try {
      const params = new URLSearchParams({
        metric: tab.key,
        id: String(selectedPoint.id),
      })
      await api(`/api/events/timeline/point?${params.toString()}`, { method: 'DELETE' })
      setSelectedPoint(null)
      setInternalRefresh((k) => k + 1)
      if (tab.key === 'weight' && onWeightLogged) onWeightLogged()
    } catch (e) {
      window.alert(`删除失败：${e.message || e}`)
    } finally {
      setDeleting(false)
    }
  }

  // 自定义 dot：扩大点击命中区 + 直接绑 onClick（不依赖 LineChart 事件冒泡）
  const renderDot = (props) => {
    const { cx, cy, payload, index } = props
    if (cx == null || cy == null) return null
    const isSelected = selectedPoint && payload?.point?.id === selectedPoint.id
    return (
      <g key={`dot-${index}`} style={{ cursor: 'pointer' }}>
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          onClick={(e) => {
            e.stopPropagation()
            setSelectedPoint(payload?.point || null)
          }}
        />
        <circle
          cx={cx}
          cy={cy}
          r={isSelected ? 6 : 4}
          fill={tab.color}
          stroke={isSelected ? '#fff' : 'none'}
          strokeWidth={isSelected ? 2 : 0}
          pointerEvents="none"
        />
      </g>
    )
  }

  const latestPoint = chartData.length > 0 ? chartData[chartData.length - 1] : null

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs uppercase tracking-wider text-slate-400 font-medium">
          时序对比
        </h3>
        <div className="flex gap-1 text-xs">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWindowKey(w.key)}
              className={`px-2.5 py-1 rounded-md transition ${
                windowKey === w.key
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTabKey(t.key)}
            className={`px-3 py-2 text-sm transition border-b-2 -mb-px ${
              tabKey === t.key
                ? 'border-amber-500 text-slate-800 font-medium'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 体重 tab 顶部：inline 称重输入条 */}
      {tabKey === 'weight' && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50/60 border border-emerald-100 px-3 py-2.5">
          <span className="text-xs text-slate-600 whitespace-nowrap">
            {currentWeight != null ? (
              <>当前 <strong className="text-slate-800">{currentWeight} kg</strong></>
            ) : (
              <span className="text-slate-500">尚未记录体重</span>
            )}
          </span>
          <input
            type="number"
            step="0.1"
            placeholder="新体重 kg"
            value={weightInput}
            onChange={(e) => {
              setWeightInput(e.target.value)
              if (weightError) setWeightError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !weightSubmitting) handleWeightSubmit()
            }}
            disabled={weightSubmitting}
            className="flex-1 min-w-[100px] max-w-[140px] border border-slate-300 rounded-md px-2.5 py-1 text-sm focus:outline-none focus:border-emerald-400 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleWeightSubmit}
            disabled={weightSubmitting || !weightInput}
            className="px-3 py-1 rounded-md bg-emerald-500 text-white text-xs hover:bg-emerald-600 transition disabled:opacity-50"
          >
            {weightSubmitting ? '保存中…' : '+ 记录'}
          </button>
          {weightError && (
            <span className="text-xs text-red-600 basis-full">{weightError}</span>
          )}
        </div>
      )}

      {loading && <p className="text-sm text-slate-400 text-center py-12">加载中…</p>}
      {!loading && error && (
        <p className="text-sm text-red-500 text-center py-12">{error}</p>
      )}
      {!loading && !error && chartData.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-12">
          {EMPTY_HINT[tab.key]}
          {win.days && (
            <>
              <br />
              <span className="text-xs text-slate-300">（当前窗口：{win.label}，可切换到「全部」看更多）</span>
            </>
          )}
        </p>
      )}
      {!loading && !error && chartData.length > 0 && (
        <div className="relative w-full" style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={formatX}
                stroke="#cbd5e1"
                fontSize={11}
                tick={{ fill: '#64748b' }}
                tickMargin={8}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={tab.yDomain}
                stroke="#cbd5e1"
                fontSize={11}
                tick={{ fill: '#64748b' }}
                unit={tab.unit}
                width={44}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={<HoverTooltip tab={tab} />}
                cursor={{ stroke: '#cbd5e1', strokeDasharray: '4 4' }}
              />
              <Line
                type="monotone"
                dataKey="y"
                stroke={tab.color}
                strokeWidth={2}
                dot={renderDot}
                activeDot={false}
                animationDuration={400}
              />
            </LineChart>
          </ResponsiveContainer>

          {/* 点击 dot 弹出操作浮层（绝对定位在图表右上角，固定位置） */}
          {selectedPoint && (
            <div className="absolute top-2 right-2 bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-xs w-[220px] z-10">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="text-slate-400 text-[11px]">
                    {new Date(selectedPoint.ts).toLocaleString('zh-CN', {
                      year: 'numeric', month: '2-digit', day: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-lg font-semibold" style={{ color: tab.color }}>
                      {selectedPoint.value}
                    </span>
                    {tab.unit && <span className="text-slate-500 text-xs">{tab.unit}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPoint(null)}
                  className="text-slate-400 hover:text-slate-600 leading-none"
                  aria-label="close"
                >
                  ✕
                </button>
              </div>

              {selectedPoint.extra?.rationale && (
                <div className="text-slate-500 mb-2 line-clamp-3 leading-relaxed">
                  💬 {selectedPoint.extra.rationale}
                </div>
              )}
              {!selectedPoint.extra?.rationale && selectedPoint.note && (
                <div className="text-slate-500 mb-2 line-clamp-3 leading-relaxed">
                  📝 {selectedPoint.note}
                </div>
              )}

              <div className="flex gap-1.5 mt-2">
                {selectedPoint.image_url && (
                  <button
                    type="button"
                    onClick={() => setLightboxSrc(selectedPoint.image_url)}
                    className="flex-1 px-2.5 py-1.5 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 transition text-[11px]"
                  >
                    🖼 查看原图
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDeletePoint}
                  disabled={deleting}
                  className="flex-1 px-2.5 py-1.5 rounded-md bg-red-50 text-red-600 hover:bg-red-100 transition text-[11px] disabled:opacity-50"
                >
                  {deleting ? '删除中…' : '🗑 删除'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {chartData.length > 0 && (
        <p className="text-[11px] text-slate-400 mt-3 text-center">
          {tabKey === 'weight'
            ? `共 ${chartData.length} 次称重 · 最近一次 ${latestPoint?.y} kg`
            : `共 ${chartData.length} 次评估 · 点击数据点查看详情`}
        </p>
      )}

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc('')} />}
    </section>
  )
}
