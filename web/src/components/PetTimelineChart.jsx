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
import { V4Btn, V4Card, Illo } from './v4'

// Chart 颜色用固定 V4 风格调色（保持稳定，不随主题切换抖动）
const TABS = [
  { key: 'bcs', label: 'BCS 体态', unit: '', yDomain: [1, 9], color: '#e98469' },
  { key: 'weight', label: '体重', unit: 'kg', yDomain: ['auto', 'auto'], color: '#7cbca5' },
  { key: 'pain_fgs', label: 'FGS 疼痛', unit: '', yDomain: [0, 10], color: '#d97757' },
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

// 网格线和轴用半透明黑——适配深色/浅色主题
const GRID_STROKE = 'rgba(120, 120, 120, 0.18)'
const AXIS_STROKE = 'rgba(120, 120, 120, 0.32)'
const AXIS_TICK_FILL = 'rgba(120, 120, 120, 0.75)'

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
    <div
      className="backdrop-blur rounded-lg shadow-lg px-3 py-2 text-xs border"
      style={{
        background: 'color-mix(in oklch, var(--v4-card) 95%, transparent)',
        borderColor: 'var(--v4-line)',
      }}
    >
      <div style={{ color: 'var(--v4-faint)' }}>{dateStr}</div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-base font-semibold" style={{ color: tab.color }}>
          {row.y}
        </span>
        {tab.unit && <span style={{ color: 'var(--v4-mute)' }}>{tab.unit}</span>}
        {typeof delta === 'number' && delta !== 0 && (
          <span
            className="text-[11px] font-medium"
            style={{ color: delta > 0 ? 'var(--v4-warn)' : 'var(--v4-second)' }}
          >
            {delta > 0 ? '+' : ''}
            {delta}
            {tab.unit}
          </span>
        )}
      </div>
      {typeof previous === 'number' && (
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--v4-faint)' }}>
          上次 {previous}
          {tab.unit}
        </div>
      )}
      <div className="text-[10px] mt-1" style={{ color: 'var(--v4-faint)' }}>
        点击数据点查看详情
      </div>
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
    <V4Card padding="p-6" className="shadow-sm rounded-2xl">
      <div className="flex items-center justify-between mb-4">
        <h3
          className="text-xs uppercase tracking-wider font-medium inline-flex items-center gap-2"
          style={{ color: 'var(--v4-faint)' }}
        >
          <Illo name="scale" size={12} color="var(--v4-accent)" />
          时序对比
        </h3>
        <div className="flex gap-1 text-xs">
          {WINDOWS.map((w) => {
            const active = windowKey === w.key
            return (
              <button
                key={w.key}
                type="button"
                onClick={() => setWindowKey(w.key)}
                className="px-2.5 py-1 rounded-md transition"
                style={{
                  background: active ? 'var(--v4-accent)' : 'var(--v4-tint)',
                  color: active ? 'white' : 'var(--v4-mute)',
                  fontWeight: active ? 600 : 500,
                }}
              >
                {w.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex gap-1 mb-5 border-b" style={{ borderColor: 'var(--v4-line)' }}>
        {TABS.map((t) => {
          const active = tabKey === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTabKey(t.key)}
              className="px-3 py-2 text-sm transition border-b-2 -mb-px"
              style={{
                borderColor: active ? 'var(--v4-accent)' : 'transparent',
                color: active ? 'var(--v4-ink)' : 'var(--v4-mute)',
                fontWeight: active ? 600 : 500,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* 体重 tab 顶部：inline 称重输入条 */}
      {tabKey === 'weight' && (
        <div
          className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5"
          style={{
            background: 'var(--v4-second-soft)',
            borderColor: 'color-mix(in oklch, var(--v4-second) 30%, transparent)',
          }}
        >
          <span
            className="text-xs whitespace-nowrap"
            style={{ color: 'var(--v4-mute)' }}
          >
            {currentWeight != null ? (
              <>
                当前{' '}
                <strong style={{ color: 'var(--v4-ink)' }}>{currentWeight} kg</strong>
              </>
            ) : (
              <span style={{ color: 'var(--v4-faint)' }}>尚未记录体重</span>
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
            className="flex-1 min-w-[100px] max-w-[140px] border rounded-md px-2.5 py-1 text-sm focus:outline-none disabled:opacity-50"
            style={{
              background: 'var(--v4-card)',
              borderColor: 'var(--v4-line)',
              color: 'var(--v4-ink)',
            }}
          />
          <V4Btn
            variant="primary"
            size="sm"
            onClick={handleWeightSubmit}
            disabled={weightSubmitting || !weightInput}
            icon="sparkle"
          >
            {weightSubmitting ? '保存中…' : '记录'}
          </V4Btn>
          {weightError && (
            <span
              className="text-xs basis-full"
              style={{ color: 'var(--v4-warn)' }}
            >
              {weightError}
            </span>
          )}
        </div>
      )}

      {loading && (
        <p className="text-sm text-center py-12" style={{ color: 'var(--v4-faint)' }}>
          加载中…
        </p>
      )}
      {!loading && error && (
        <p className="text-sm text-center py-12" style={{ color: 'var(--v4-warn)' }}>
          {error}
        </p>
      )}
      {!loading && !error && chartData.length === 0 && (
        <p className="text-sm text-center py-12" style={{ color: 'var(--v4-faint)' }}>
          {EMPTY_HINT[tab.key]}
          {win.days && (
            <>
              <br />
              <span className="text-xs" style={{ color: 'var(--v4-faint)' }}>
                （当前窗口：{win.label}，可切换到「全部」看更多）
              </span>
            </>
          )}
        </p>
      )}
      {!loading && !error && chartData.length > 0 && (
        <div className="relative w-full" style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={formatX}
                stroke={AXIS_STROKE}
                fontSize={11}
                tick={{ fill: AXIS_TICK_FILL }}
                tickMargin={8}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={tab.yDomain}
                stroke={AXIS_STROKE}
                fontSize={11}
                tick={{ fill: AXIS_TICK_FILL }}
                unit={tab.unit}
                width={44}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={<HoverTooltip tab={tab} />}
                cursor={{ stroke: AXIS_STROKE, strokeDasharray: '4 4' }}
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
            <div
              className="absolute top-2 right-2 rounded-lg shadow-xl p-3 text-xs w-[220px] z-10 border"
              style={{
                background: 'var(--v4-card)',
                borderColor: 'var(--v4-line)',
              }}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="text-[11px]" style={{ color: 'var(--v4-faint)' }}>
                    {new Date(selectedPoint.ts).toLocaleString('zh-CN', {
                      year: 'numeric', month: '2-digit', day: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-lg font-semibold" style={{ color: tab.color }}>
                      {selectedPoint.value}
                    </span>
                    {tab.unit && (
                      <span className="text-xs" style={{ color: 'var(--v4-mute)' }}>
                        {tab.unit}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPoint(null)}
                  className="leading-none transition"
                  style={{ color: 'var(--v4-faint)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--v4-ink)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--v4-faint)')}
                  aria-label="close"
                >
                  ✕
                </button>
              </div>

              {selectedPoint.extra?.rationale && (
                <div
                  className="mb-2 line-clamp-3 leading-relaxed"
                  style={{ color: 'var(--v4-mute)' }}
                >
                  💬 {selectedPoint.extra.rationale}
                </div>
              )}
              {!selectedPoint.extra?.rationale && selectedPoint.note && (
                <div
                  className="mb-2 line-clamp-3 leading-relaxed"
                  style={{ color: 'var(--v4-mute)' }}
                >
                  📝 {selectedPoint.note}
                </div>
              )}

              <div className="flex gap-1.5 mt-2">
                {selectedPoint.image_url && (
                  <button
                    type="button"
                    onClick={() => setLightboxSrc(selectedPoint.image_url)}
                    className="flex-1 px-2.5 py-1.5 rounded-md transition text-[11px]"
                    style={{
                      background: 'var(--v4-tint)',
                      color: 'var(--v4-ink)',
                    }}
                  >
                    🖼 查看原图
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDeletePoint}
                  disabled={deleting}
                  className="flex-1 px-2.5 py-1.5 rounded-md transition text-[11px] disabled:opacity-50"
                  style={{
                    background: 'var(--v4-warn-soft)',
                    color: 'var(--v4-warn)',
                  }}
                >
                  {deleting ? '删除中…' : '🗑 删除'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {chartData.length > 0 && (
        <p className="text-[11px] mt-3 text-center" style={{ color: 'var(--v4-faint)' }}>
          {tabKey === 'weight'
            ? `共 ${chartData.length} 次称重 · 最近一次 ${latestPoint?.y} kg`
            : `共 ${chartData.length} 次评估 · 点击数据点查看详情`}
        </p>
      )}

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc('')} />}
    </V4Card>
  )
}
