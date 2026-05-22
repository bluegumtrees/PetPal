import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import PetCard from '../components/PetCard'
import EventList from '../components/EventList'
import { V4Btn, V4Card, Illo } from '../components/v4'
import { usePets } from '../context/PetContext'

export default function Dashboard() {
  const { activePet, pets, loading } = usePets()
  const [stats, setStats] = useState(null)

  useEffect(() => {
    api('/api/vet/stats')
      .then(setStats)
      .catch(() => setStats(null))
  }, [])

  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(false)

  useEffect(() => {
    if (!activePet) {
      setEvents([])
      return
    }
    setEventsLoading(true)
    api(`/api/events?pet_id=${activePet.id}&limit=10`)
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false))
  }, [activePet])

  if (loading) {
    return (
      <p className="text-sm text-center py-12" style={{ color: 'var(--v4-faint)' }}>
        加载中…
      </p>
    )
  }

  if (pets.length === 0) {
    return (
      <V4Card padding="p-10" shadow="md" className="text-center rounded-2xl">
        <div
          className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-4"
          style={{ background: 'var(--v4-accent-soft)' }}
        >
          <Illo name="cat-face" size={56} color="white" secondary="white" />
        </div>
        <h2
          className="text-xl font-semibold mt-2 mb-1"
          style={{ color: 'var(--v4-ink)' }}
        >
          欢迎使用 PetPal
        </h2>
        <p className="text-sm mb-6" style={{ color: 'var(--v4-mute)' }}>
          先添加你的第一只宠物开始建立档案
        </p>
        <Link to="/pets/new" className="inline-block">
          <V4Btn variant="primary" size="lg" icon="sparkle">
            新建宠物
          </V4Btn>
        </Link>
      </V4Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* 当前宠物大卡 */}
      <V4Card padding="p-6" shadow="sm" className="rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-xs uppercase tracking-wider font-medium inline-flex items-center gap-2"
            style={{ color: 'var(--v4-faint)' }}
          >
            <Illo name="heart" size={12} color="var(--v4-accent)" />
            当前宠物
          </h2>
          <Link
            to={`/pets/${activePet.id}`}
            className="text-xs transition"
            style={{ color: 'var(--v4-accent-deep)' }}
          >
            查看详情 →
          </Link>
        </div>
        <PetCard pet={activePet} large />
      </V4Card>

      {/* 最近事件 */}
      <V4Card padding="p-6" shadow="sm" className="rounded-2xl">
        <h2
          className="text-xs uppercase tracking-wider font-medium mb-4 inline-flex items-center gap-2"
          style={{ color: 'var(--v4-faint)' }}
        >
          <Illo name="star" size={12} color="var(--v4-accent)" />
          最近事件
        </h2>
        {eventsLoading ? (
          <p className="text-sm text-center py-4" style={{ color: 'var(--v4-faint)' }}>
            加载中…
          </p>
        ) : (
          <EventList events={events} />
        )}
      </V4Card>

      {/* 知识库 stats */}
      {stats && (
        <V4Card padding="p-6" shadow="sm" className="rounded-2xl">
          <h2
            className="text-xs uppercase tracking-wider font-medium mb-3 inline-flex items-center gap-2"
            style={{ color: 'var(--v4-faint)' }}
          >
            <Illo name="leaf" size={12} color="var(--v4-second)" />
            兽医知识库
          </h2>
          <p className="text-sm" style={{ color: 'var(--v4-mute)' }}>
            收录{' '}
            <span className="font-semibold" style={{ color: 'var(--v4-ink)' }}>
              {stats.total}
            </span>{' '}
            条知识，其中{' '}
            <span className="font-semibold" style={{ color: 'var(--v4-warn)' }}>
              {stats.emergency}
            </span>{' '}
            条急诊红线。{' '}
            <Link
              to="/dev/vet-search"
              className="transition"
              style={{ color: 'var(--v4-accent-deep)' }}
            >
              进入检索调试 →
            </Link>
          </p>
        </V4Card>
      )}
    </div>
  )
}
