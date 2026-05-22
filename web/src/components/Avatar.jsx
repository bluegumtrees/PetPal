import { Illo } from './v4'

/**
 * V4 宠物头像：有照片用照片；无照片用插画猫脸/狗脸（白色 + 主题色底）。
 * @param {{ pet: any, size?: number, className?: string }} props
 */
export default function Avatar({ pet, size = 56, className = '' }) {
  const style = { width: size, height: size }
  if (pet?.photo_url) {
    return (
      <img
        src={pet.photo_url}
        alt={pet.name}
        className={'rounded-full object-cover ' + className}
        style={{ ...style, background: 'var(--v4-tint)' }}
      />
    )
  }
  const isCat = pet?.species === 'cat'
  const isDog = pet?.species === 'dog'
  const iconName = isCat ? 'cat-face' : isDog ? 'dog-face' : null
  return (
    <div
      className={'rounded-full flex items-center justify-center ' + className}
      style={{
        ...style,
        background: 'var(--v4-accent-soft)',
      }}
    >
      {iconName ? (
        <Illo name={iconName} size={size * 0.7} color="white" secondary="white" />
      ) : (
        <Illo name="paw" size={size * 0.5} color="var(--v4-accent-deep)" />
      )}
    </div>
  )
}
