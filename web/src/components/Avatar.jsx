/** @param {{ pet: any, size?: number, className?: string }} props */
export default function Avatar({ pet, size = 56, className = '' }) {
  const style = { width: size, height: size }
  if (pet?.photo_url) {
    return (
      <img
        src={pet.photo_url}
        alt={pet.name}
        className={'rounded-full object-cover bg-slate-100 ' + className}
        style={style}
      />
    )
  }
  return (
    <div
      className={
        'rounded-full bg-amber-100 flex items-center justify-center ' + className
      }
      style={style}
    >
      <span style={{ fontSize: size * 0.5 }}>
        {pet?.species === 'cat' ? '🐱' : pet?.species === 'dog' ? '🐶' : '🐾'}
      </span>
    </div>
  )
}
