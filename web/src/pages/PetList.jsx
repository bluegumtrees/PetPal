import { Link } from 'react-router-dom'
import { usePets } from '../context/PetContext'
import PetCard from '../components/PetCard'

export default function PetList() {
  const { pets, loading, error } = usePets()

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-semibold text-slate-800">
          所有宠物{' '}
          <span className="text-sm font-normal text-slate-400">({pets.length})</span>
        </h2>
        <Link
          to="/pets/new"
          className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm transition"
        >
          + 新建宠物
        </Link>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-10">加载中…</p>
      ) : pets.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-8 text-center">
          <p className="text-sm text-slate-500 mb-3">还没有宠物</p>
          <Link to="/pets/new" className="text-amber-600 hover:underline text-sm">
            添加第一只宠物 →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {pets.map((pet) => (
            <Link
              key={pet.id}
              to={`/pets/${pet.id}`}
              className="block bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md hover:border-amber-300 transition"
            >
              <PetCard pet={pet} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
