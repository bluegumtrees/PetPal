import { Link } from 'react-router-dom'
import { usePets } from '../context/PetContext'
import PetCard from '../components/PetCard'
import { V4Btn, V4Card, Illo } from '../components/v4'

export default function PetList() {
  const { pets, loading, error } = usePets()

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-semibold inline-flex items-center gap-2" style={{ color: 'var(--v4-ink)' }}>
          <Illo name="paw" size={18} color="var(--v4-accent)" />
          所有宠物{' '}
          <span className="text-sm font-normal" style={{ color: 'var(--v4-faint)' }}>
            ({pets.length})
          </span>
        </h2>
        <Link to="/pets/new">
          <V4Btn variant="primary" size="md" icon="sparkle">
            新建宠物
          </V4Btn>
        </Link>
      </div>

      {error && (
        <div
          className="rounded-lg p-3 mb-4 text-sm border"
          style={{
            background: 'var(--v4-warn-soft)',
            borderColor: 'var(--v4-warn)',
            color: 'var(--v4-warn)',
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-center py-10" style={{ color: 'var(--v4-faint)' }}>
          加载中…
        </p>
      ) : pets.length === 0 ? (
        <div
          className="rounded-xl border-2 border-dashed p-8 text-center"
          style={{ borderColor: 'var(--v4-line)' }}
        >
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-3"
            style={{ background: 'var(--v4-accent-soft)' }}
          >
            <Illo name="cat-face" size={40} color="white" secondary="white" />
          </div>
          <p className="text-sm mb-3" style={{ color: 'var(--v4-mute)' }}>
            还没有宠物
          </p>
          <Link
            to="/pets/new"
            className="text-sm transition"
            style={{ color: 'var(--v4-accent-deep)' }}
          >
            添加第一只宠物 →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {pets.map((pet) => (
            <Link
              key={pet.id}
              to={`/pets/${pet.id}`}
              className="block transition"
              onMouseEnter={(e) => {
                e.currentTarget.firstChild.style.borderColor = 'var(--v4-accent)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.firstChild.style.borderColor = 'var(--v4-line)'
              }}
            >
              <V4Card padding="p-4" shadow="sm" className="rounded-xl">
                <PetCard pet={pet} />
              </V4Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
