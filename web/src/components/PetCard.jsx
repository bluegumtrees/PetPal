import Avatar from './Avatar'

const SPECIES_ZH = { cat: '猫', dog: '狗' }
const GENDER_ZH = { male: '公', female: '母', unknown: '未知' }

/** @param {{ pet: any, large?: boolean }} props */
export default function PetCard({ pet, large = false }) {
  return (
    <div className="flex gap-3 items-center">
      <Avatar pet={pet} size={large ? 96 : 56} />
      <div className="flex-1 min-w-0">
        <h3 className={'font-semibold text-slate-800 ' + (large ? 'text-2xl' : 'text-base')}>
          {pet.name}
        </h3>
        <p className="text-sm text-slate-500 truncate">
          {SPECIES_ZH[pet.species] || pet.species}
          {pet.breed && <> · {pet.breed}</>}
          {pet.gender && <> · {GENDER_ZH[pet.gender] || pet.gender}</>}
        </p>
        {large && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            {pet.birthday && <span>🎂 {pet.birthday}</span>}
            {pet.weight_kg && <span>⚖️ {pet.weight_kg} kg</span>}
            {pet.neutered === true && <span>✓ 已绝育</span>}
            {pet.neutered === false && <span>✗ 未绝育</span>}
          </div>
        )}
      </div>
    </div>
  )
}
