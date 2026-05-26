import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { usePets } from '../context/PetContext'
import Avatar from './Avatar'
import { V4Pill, Illo } from './v4'

const SPECIES_ZH = { cat: '猫', dog: '狗' }

function fmtAge(birthday) {
  if (!birthday) return null
  const b = new Date(birthday)
  const now = new Date()
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth())
  if (now.getDate() < b.getDate()) months -= 1
  if (months < 12) return `${months} 月龄`
  const years = Math.floor(months / 12)
  const rem = months % 12
  return rem === 0 ? `${years} 岁` : `${years}岁${rem}月`
}

function fmtRelativeFuture(iso) {
  if (!iso) return ''
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  const diffMs = d.getTime() - Date.now()
  const days = Math.round(diffMs / (24 * 3600 * 1000))
  if (Math.abs(days) < 1) {
    const hours = Math.round(diffMs / (3600 * 1000))
    if (hours > 0) return `${hours}h后`
    if (hours < 0) return `${-hours}h前`
    return '即将'
  }
  if (days > 0) return `${days}天后`
  return `${-days}天前`
}

const EVENT_ICON = {
  bcs: 'scale', weight: 'scale', symptom: 'drop', emotion: 'heart',
  pain_fgs: 'sparkle', vaccine: 'syringe', grooming: 'bath',
  milestone: 'crown', note: 'leaf', feeding: 'fish',
}

function eventTitle(e) {
  switch (e.event_type) {
    case 'symptom': return e.payload?.symptom_desc || '症状'
    case 'bcs': return `BCS ${e.payload?.bcs_score ?? '?'}`
    case 'weight': return `${e.payload?.weight_kg ?? '?'} kg`
    case 'emotion': return e.payload?.main_emotion || '情绪'
    case 'pain_fgs': return `FGS ${e.payload?.total_score}/10`
    case 'vaccine': return e.payload?.vaccine_name || '疫苗'
    case 'milestone': return e.payload?.title || '里程碑'
    case 'note': return e.payload?.text || '备忘'
    default: return e.event_type
  }
}

/** V2 风格三色卡：白底 + 浅色文字（柔和不突兀）*/
function StatCard({ tone, label, value, sub, iconName }) {
  const color = `var(--v4-${tone})`
  return (
    <div
      className="rounded-xl px-2 py-2.5 text-center"
      style={{
        background: 'var(--v4-card)',
        boxShadow: 'var(--v4-shadow-sm)',
      }}
    >
      <div className="flex items-center justify-center gap-1 text-[10px] mb-1" style={{ color }}>
        <Illo name={iconName} size={10} color={color} />
        {label}
      </div>
      <div className="text-lg font-bold leading-none" style={{ color }}>
        {value}
      </div>
      <div className="text-[9px] mt-0.5" style={{ color: 'var(--v4-mute)' }}>
        {sub}
      </div>
    </div>
  )
}

/** 右抽屉/侧栏：宠物状态面板（V2 反转配色：深底 panel + 白卡片 + 列表事件）
 *  compact=true：桌面端 docked 模式，省略顶部标题栏（关闭按钮已在 Header 里）*/
export default function PetStatusPanel({ onClose, onNavigate, compact = false }) {
  const { activePet } = usePets()
  const [events, setEvents] = useState([])
  const [reminders, setReminders] = useState([])
  const [loading, setLoading] = useState(true)
  // 本地"打勾"标记（视觉级，未真存——勾后视觉灰掉，下次加载恢复）
  const [checkedIds, setCheckedIds] = useState(() => new Set())

  const load = useCallback(async () => {
    if (!activePet) return
    setLoading(true)
    try {
      const [evs, rems] = await Promise.all([
        api(`/api/events?pet_id=${activePet.id}&limit=10`),
        api(`/api/reminders?pet_id=${activePet.id}`),
      ])
      setEvents(evs || [])
      setReminders(rems || [])
    } catch {
      // 静默
    } finally {
      setLoading(false)
    }
  }, [activePet?.id])

  useEffect(() => {
    load()
  }, [load])

  function toggleCheck(id) {
    setCheckedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!activePet) {
    return (
      <>
        {!compact && (
          <div
            className="flex items-center justify-between px-4 py-2.5 border-b shrink-0"
            style={{ borderColor: 'var(--v4-line)' }}
          >
            <h2 className="text-sm font-semibold" style={{ color: 'var(--v4-ink)' }}>
              宠物状态
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-xl leading-none p-1"
              style={{ color: 'var(--v4-faint)' }}
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <p className="text-sm" style={{ color: 'var(--v4-mute)' }}>
            还没有选定宠物
          </p>
        </div>
      </>
    )
  }

  const latestBcs = events.find((e) => e.event_type === 'bcs')
  const latestEmotion = events.find((e) => e.event_type === 'emotion')
  const pending = reminders.filter((r) => !r.notified).slice(0, 3)
  const recent = events.slice(0, 5)
  const age = fmtAge(activePet.birthday)

  return (
    <>
      {/* 顶部关闭（compact 模式隐藏：桌面端 docked 不需要标题栏，关闭按钮已在 Header）*/}
      {!compact && (
        <div
          className="flex items-center justify-between px-4 py-2.5 border-b shrink-0"
          style={{ borderColor: 'var(--v4-line)' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--v4-ink)' }}>
            宠物状态
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none p-1"
            style={{ color: 'var(--v4-faint)' }}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
      )}

      {/* 主区（panel 内部 scroll，隐藏滚动条但保留滚动功能） */}
      <div className="flex-1 overflow-y-auto scrollbar-hide px-3 py-3 pb-6 space-y-3">
        {/* 头像 + 信息（头像放大占左 ~1/3 panel 宽度，名字信息右排） */}
        <div className="flex items-center gap-3">
          <Avatar pet={activePet} size={96} className="shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold truncate" style={{ color: 'var(--v4-ink)' }}>
              {activePet.name}
            </h3>
            <p className="text-xs truncate mt-0.5" style={{ color: 'var(--v4-mute)' }}>
              {SPECIES_ZH[activePet.species] || activePet.species}
              {activePet.breed && <> · {activePet.breed}</>}
              {activePet.gender && <> · {activePet.gender === 'male' ? '公' : activePet.gender === 'female' ? '母' : ''}</>}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {age && <V4Pill tone="mute">{age}</V4Pill>}
              {activePet.neutered === true && <V4Pill tone="second">已绝育</V4Pill>}
              {pending.length > 0 && <V4Pill tone="warn">{pending.length} 待办</V4Pill>}
            </div>
          </div>
        </div>

        {/* 三色卡（白底 + 浅色文字）*/}
        <div className="grid grid-cols-3 gap-2">
          <StatCard
            tone="second"
            label="体态"
            iconName="leaf"
            value={latestBcs?.payload?.bcs_score ?? '—'}
            sub={latestBcs?.payload?.bcs_score ? '/ 9' : '未评估'}
          />
          <StatCard
            tone="accent"
            label="体重"
            iconName="scale"
            value={activePet.weight_kg || '—'}
            sub={activePet.weight_kg ? 'kg' : '未记录'}
          />
          <StatCard
            tone="warn"
            label="心情"
            iconName="heart"
            value={latestEmotion?.payload?.main_emotion || '—'}
            sub={latestEmotion?.payload?.main_emotion ? '最近' : '未评估'}
          />
        </div>

        {/* CTA */}
        <Link
          to={`/pets/${activePet.id}`}
          onClick={onNavigate}
          className="block w-full rounded-xl py-2 text-center text-sm font-semibold transition"
          style={{
            background: 'var(--v4-accent)',
            color: 'white',
            boxShadow: 'var(--v4-shadow-sm)',
          }}
        >
          查看完整档案 →
        </Link>

        {/* 要做的事（白底大卡 + checkbox 打勾）*/}
        {(pending.length > 0 || loading) && (
          <div>
            <div
              className="text-[10px] uppercase tracking-wider font-semibold mb-1.5 inline-flex items-center gap-1 px-1"
              style={{ color: 'var(--v4-faint)' }}
            >
              <Illo name="bell" size={9} color="var(--v4-accent)" />
              要做的事 · {pending.length}
            </div>
            <div
              className="rounded-xl p-1"
              style={{ background: 'var(--v4-card)', boxShadow: 'var(--v4-shadow-sm)' }}
            >
              {pending.map((r, i) => {
                const checked = checkedIds.has(r.id)
                return (
                  <label
                    key={r.id}
                    className="flex items-center gap-2.5 px-2 py-2 cursor-pointer transition rounded-lg"
                    style={{
                      borderTop: i > 0 ? '1px solid var(--v4-line)' : 'none',
                      opacity: checked ? 0.5 : 1,
                    }}
                  >
                    {/* 左侧图标 */}
                    <span
                      className="inline-flex items-center justify-center w-7 h-7 rounded-full shrink-0"
                      style={{ background: 'var(--v4-accent-soft)' }}
                    >
                      <Illo name="syringe" size={12} color="var(--v4-accent)" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div
                        className={'text-[13px] font-medium truncate ' + (checked ? 'line-through' : '')}
                        style={{ color: 'var(--v4-ink)' }}
                      >
                        {r.message || r.reminder_type}
                      </div>
                      <div className="text-[10px]" style={{ color: 'var(--v4-mute)' }}>
                        {fmtRelativeFuture(r.scheduled_at)}
                      </div>
                    </div>
                    {/* 右侧 checkbox */}
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCheck(r.id)}
                      className="w-4 h-4 rounded shrink-0 cursor-pointer"
                      style={{ accentColor: 'var(--v4-accent)' }}
                    />
                  </label>
                )
              })}
            </div>
          </div>
        )}

        {/* 小日记（融入背景，无卡片）*/}
        {recent.length > 0 && (
          <div>
            <div
              className="text-[10px] uppercase tracking-wider font-semibold mb-1 inline-flex items-center gap-1 px-1"
              style={{ color: 'var(--v4-faint)' }}
            >
              <Illo name="star" size={9} color="var(--v4-second)" />
              {activePet.name} 的小日记
            </div>
            <ul>
              {recent.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-2 px-1 py-1.5"
                >
                  <Illo
                    size={11}
                    color="var(--v4-accent)"
                    name={EVENT_ICON[e.event_type] || 'leaf'}
                  />
                  <span className="flex-1 text-[12px] truncate" style={{ color: 'var(--v4-ink)' }}>
                    {eventTitle(e)}
                  </span>
                  <time className="text-[10px] shrink-0" style={{ color: 'var(--v4-faint)' }}>
                    {new Date(e.happened_at).toLocaleDateString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                    })}
                  </time>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  )
}
