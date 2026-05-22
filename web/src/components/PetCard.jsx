import Avatar from './Avatar'
import { V4Pill } from './v4'

const SPECIES_ZH = { cat: '猫', dog: '狗' }
const GENDER_ZH = { male: '公', female: '母', unknown: '未知' }

/** @param {{ pet: any, large?: boolean }} props */
export default function PetCard({ pet, large = false }) {
  return (
    <div className={large ? 'flex flex-col items-center text-center gap-3' : 'flex gap-3 items-center'}>
      <Avatar pet={pet} size={large ? 96 : 56} />
      <div className={large ? '' : 'flex-1 min-w-0'}>
        <h3
          className={'font-semibold ' + (large ? 'text-2xl' : 'text-base')}
          style={{ color: 'var(--v4-ink)' }}
        >
          {pet.name}
        </h3>
        <p className="text-sm truncate" style={{ color: 'var(--v4-mute)' }}>
          {SPECIES_ZH[pet.species] || pet.species}
          {pet.breed && <> · {pet.breed}</>}
          {pet.gender && <> · {GENDER_ZH[pet.gender] || pet.gender}</>}
          {pet.neutered === true && <> · 已绝育</>}
        </p>
        {large && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {pet.birthday && (
              <V4Pill tone="mute" icon="sparkle">
                生日 {pet.birthday}
              </V4Pill>
            )}
            {pet.weight_kg && (
              <V4Pill tone="second" icon="scale">
                {pet.weight_kg} kg
              </V4Pill>
            )}
            {pet.neutered === false && (
              <V4Pill tone="warn">未绝育</V4Pill>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
