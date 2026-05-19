import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import AddEventModal from '../components/AddEventModal'
import EventList from '../components/EventList'
import PetCard from '../components/PetCard'
import PetReminders from '../components/PetReminders'
import PetTimelineChart from '../components/PetTimelineChart'
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
    return <p className="text-sm text-slate-400 text-center py-10">加载中…</p>
  }

  if (error || !pet) {
    return (
      <div>
        <Link to="/pets" className="text-sm text-slate-500 hover:text-slate-700">
          ← 返回列表
        </Link>
        <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error || '未找到该宠物'}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link to="/pets" className="text-sm text-slate-500 hover:text-slate-700">
        ← 返回列表
      </Link>

      <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <PetCard pet={pet} large />
        <div className="mt-5 flex gap-2 pt-4 border-t border-slate-100">
          <Link
            to={`/pets/${pet.id}/edit`}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-1.5 rounded-lg text-sm transition"
          >
            ✎ 编辑
          </Link>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-red-600 hover:bg-red-50 px-4 py-1.5 rounded-lg text-sm transition disabled:opacity-50"
          >
            {deleting ? '删除中…' : '🗑 删除'}
          </button>
          <div className="flex-1" />
          <span className="text-xs text-slate-400 self-center">
            创建于 {new Date(pet.created_at).toLocaleDateString('zh-CN')}
          </span>
        </div>
      </section>

      <PetTimelineChart
        petId={pet.id}
        currentWeight={pet.weight_kg}
        refreshKey={chartRefreshKey}
        onWeightLogged={async () => {
          await loadAll()
          await reload()
        }}
      />

      <PetReminders petId={pet.id} />

      <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs uppercase tracking-wider text-slate-400 font-medium">
            事件时间线
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{events.length} 条</span>
            <button
              type="button"
              onClick={() => setAddModalOpen(true)}
              className="text-xs px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition"
            >
              + 添加事件
            </button>
          </div>
        </div>
        <EventList events={events} onDelete={handleDeleteEvent} />
      </section>

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
