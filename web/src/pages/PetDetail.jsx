import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import AddEventModal from '../components/AddEventModal'
import EventList from '../components/EventList'
import PetCard from '../components/PetCard'
import PetReminders from '../components/PetReminders'
import PetTimelineChart from '../components/PetTimelineChart'
import { V4Btn, V4Card, Illo } from '../components/v4'
import { usePets } from '../context/PetContext'

export default function PetDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { reload, setActivePetId } = usePets()

  const [pet, setPet] = useState(null)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [chartRefreshKey, setChartRefreshKey] = useState(0)
  const [activeTab, setActiveTab] = useState('trend')  // trend | diary | reminders

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [p, evs] = await Promise.all([
        api(`/api/pets/${id}`),
        api(`/api/events?pet_id=${id}`),
      ])
      setPet(p)
      setEvents(evs)
      setActivePetId(p.id) // 进详情页时自动切换
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }, [id, setActivePetId])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  async function handleDelete() {
    if (!window.confirm(`确认删除「${pet.name}」？(软删，可在 API 层 restore)`)) return
    setDeleting(true)
    try {
      await api(`/api/pets/${pet.id}`, { method: 'DELETE' })
      await reload()
      navigate('/pets')
    } catch (e) {
      setError(String(e.message || e))
      setDeleting(false)
    }
  }

  async function handleDeleteEvent(eventId) {
    if (!window.confirm('删除这条事件记录？')) return
    try {
      await api(`/api/events/${eventId}`, { method: 'DELETE' })
      setEvents((evs) => evs.filter((e) => e.id !== eventId))
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-center py-10" style={{ color: 'var(--v4-faint)' }}>
        加载中…
      </p>
    )
  }

  if (error || !pet) {
    return (
      <div>
        <Link
          to="/pets"
          className="text-sm transition"
          style={{ color: 'var(--v4-mute)' }}
        >
          ← 返回列表
        </Link>
        <div
          className="mt-4 rounded-xl p-4 text-sm border"
          style={{
            background: 'var(--v4-warn-soft)',
            borderColor: 'var(--v4-warn)',
            color: 'var(--v4-warn)',
          }}
        >
          {error || '未找到该宠物'}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Link
        to="/pets"
        className="text-sm transition inline-flex items-center gap-1"
        style={{ color: 'var(--v4-mute)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--v4-ink)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--v4-mute)')}
      >
        ← 返回列表
      </Link>

      {/* 宠物档案卡（始终顶部） */}
      <V4Card padding="p-6" className="rounded-2xl">
        <PetCard pet={pet} large />
        <div
          className="mt-5 flex gap-2 pt-4 border-t"
          style={{ borderColor: 'var(--v4-line)' }}
        >
          <Link to={`/pets/${pet.id}/edit`}>
            <V4Btn variant="secondary" size="sm" icon="sparkle">
              编辑
            </V4Btn>
          </Link>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="px-3 h-9 text-[13px] rounded-lg transition font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
            style={{ color: 'var(--v4-warn)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v4-warn-soft)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span>🗑</span>
            {deleting ? '删除中…' : '删除'}
          </button>
          <div className="flex-1" />
          <span className="text-xs self-center" style={{ color: 'var(--v4-faint)' }}>
            创建于 {new Date(pet.created_at).toLocaleDateString('zh-CN')}
          </span>
        </div>
      </V4Card>

      {/* Sticky tab 切换 */}
      <div
        className="sticky z-[5] -mx-3 sm:-mx-6 px-3 sm:px-6 py-1 backdrop-blur"
        style={{
          top: 60,
          background: 'color-mix(in oklch, var(--v4-paper) 90%, transparent)',
        }}
      >
        <div
          className="flex border-b"
          style={{ borderColor: 'var(--v4-line)' }}
        >
          {[
            { key: 'trend', label: '趋势', icon: 'scale' },
            { key: 'diary', label: '日记', icon: 'star' },
            { key: 'reminders', label: '提醒', icon: 'bell' },
            { key: 'profile', label: '档案', icon: 'paw' },
          ].map((t) => {
            const active = activeTab === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className="flex-1 px-2 py-2.5 text-sm transition border-b-2 -mb-px inline-flex items-center justify-center gap-1.5"
                style={{
                  borderColor: active ? 'var(--v4-accent)' : 'transparent',
                  color: active ? 'var(--v4-ink)' : 'var(--v4-mute)',
                  fontWeight: active ? 600 : 500,
                }}
              >
                <Illo
                  name={t.icon}
                  size={12}
                  color={active ? 'var(--v4-accent)' : 'var(--v4-mute)'}
                />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* tab 内容 */}
      {activeTab === 'trend' && (
        <PetTimelineChart
          petId={pet.id}
          currentWeight={pet.weight_kg}
          refreshKey={chartRefreshKey}
          onWeightLogged={async () => {
            await loadAll()
            await reload()
          }}
        />
      )}

      {activeTab === 'reminders' && <PetReminders petId={pet.id} />}

      {activeTab === 'diary' && (
        <V4Card padding="p-6" className="rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3
              className="text-xs uppercase tracking-wider font-medium inline-flex items-center gap-2"
              style={{ color: 'var(--v4-faint)' }}
            >
              <Illo name="star" size={12} color="var(--v4-accent)" />
              事件时间线
            </h3>
            <div className="flex items-center gap-3">
              <span className="text-xs" style={{ color: 'var(--v4-faint)' }}>
                {events.length} 条
              </span>
              <V4Btn
                variant="soft"
                size="sm"
                icon="sparkle"
                onClick={() => setAddModalOpen(true)}
              >
                添加事件
              </V4Btn>
            </div>
          </div>
          <EventList events={events} onDelete={handleDeleteEvent} />
        </V4Card>
      )}

      {activeTab === 'profile' && (
        <V4Card padding="p-6" className="rounded-2xl">
          <h3
            className="text-xs uppercase tracking-wider font-medium mb-4 inline-flex items-center gap-2"
            style={{ color: 'var(--v4-faint)' }}
          >
            <Illo name="paw" size={12} color="var(--v4-accent)" />
            档案详情
          </h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <ProfileRow label="名字" value={pet.name} />
            <ProfileRow label="物种" value={pet.species === 'cat' ? '🐱 猫' : '🐶 狗'} />
            <ProfileRow label="品种" value={pet.breed || '未填'} />
            <ProfileRow label="性别" value={
              pet.gender === 'male' ? '公' :
              pet.gender === 'female' ? '母' :
              pet.gender === 'unknown' ? '未知' : '未填'
            } />
            <ProfileRow label="生日" value={pet.birthday || '未填'} />
            <ProfileRow label="体重" value={pet.weight_kg ? `${pet.weight_kg} kg` : '未记录'} />
            <ProfileRow
              label="绝育"
              value={pet.neutered === true ? '✓ 已绝育' : pet.neutered === false ? '✗ 未绝育' : '未填'}
            />
            <ProfileRow
              label="创建于"
              value={new Date(pet.created_at).toLocaleDateString('zh-CN')}
            />
          </dl>
        </V4Card>
      )}

      {addModalOpen && (
        <AddEventModal
          petId={pet.id}
          onClose={() => setAddModalOpen(false)}
          onSubmitted={async () => {
            setAddModalOpen(false)
            await loadAll()
            setChartRefreshKey((k) => k + 1)
            await reload()
          }}
        />
      )}
    </div>
  )
}

function ProfileRow({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--v4-faint)' }}>
        {label}
      </dt>
      <dd className="text-sm" style={{ color: 'var(--v4-ink)' }}>{value}</dd>
    </div>
  )
}
