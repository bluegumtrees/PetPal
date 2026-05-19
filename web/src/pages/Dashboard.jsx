import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import PetCard from '../components/PetCard'
import EventList from '../components/EventList'
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
    return <p className="text-sm text-slate-400 text-center py-12">加载中…</p>
  }

  if (pets.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center shadow-sm">
        <span className="text-5xl">🐾</span>
        <h2 className="text-xl font-semibold text-slate-800 mt-3 mb-1">
          欢迎使用 PetPal
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          先添加你的第一只宠物开始建立档案
        </p>
        <Link
          to="/pets/new"
          className="inline-block bg-amber-500 hover:bg-amber-600 text-white px-5 py-2.5 rounded-xl transition"
        >
          + 新建宠物
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 当前宠物大卡 */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs uppercase tracking-wider text-slate-400 font-medium">
            当前宠物
          </h2>
          <Link
            to={`/pets/${activePet.id}`}
            className="text-xs text-amber-600 hover:text-amber-700"
          >
            查看详情 →
          </Link>
        </div>
        <PetCard pet={activePet} large />
      </section>

      {/* 最近事件 */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-4">
          最近事件
        </h2>
        {eventsLoading ? (
          <p className="text-sm text-slate-400 text-center py-4">加载中…</p>
        ) : (
          <EventList events={events} />
        )}
      </section>

      {/* 知识库 stats */}
      {stats && (
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-3">
            兽医知识库
          </h2>
          <p className="text-sm text-slate-600">
            收录 <span className="font-semibold text-slate-800">{stats.total}</span> 条知识，
            其中 <span className="text-red-600 font-semibold">{stats.emergency}</span> 条急诊红线。{' '}
            <Link to="/dev/vet-search" className="text-amber-600 hover:underline">
              进入检索调试 →
            </Link>
          </p>
        </section>
      )}
    </div>
  )
}
