// V4 组件库——flat & restrained + cute
// Reference: claude design / v4-primitives.jsx
import Illo from './Illo'

export { Illo }

/* ============================================================
   V4Btn — 扁平按钮
   variant: primary / secondary / soft / ghost
   size: sm / md / lg
   ============================================================ */

const BTN_SIZES = {
  sm: 'h-7 px-2.5 text-[12px] gap-1 rounded-md',
  md: 'h-9 px-3 text-[13px] gap-1.5 rounded-lg',
  lg: 'h-10 px-4 text-[14px] gap-2 rounded-lg',
}

const BTN_VARIANTS = {
  primary: { background: 'var(--v4-accent)', color: 'white', border: '1px solid var(--v4-accent)' },
  secondary: { background: 'var(--v4-card)', color: 'var(--v4-ink)', border: '1px solid var(--v4-line)' },
  soft: { background: 'var(--v4-accent-soft)', color: 'var(--v4-accent-deep)', border: '1px solid transparent' },
  ghost: { background: 'transparent', color: 'var(--v4-mute)', border: '1px solid transparent' },
}

/** @param {{variant?:string, size?:string, icon?:string, iconRight?:string, className?:string, children:any}} props */
export function V4Btn({ variant = 'primary', size = 'md', icon, iconRight, children, className = '', ...rest }) {
  const sizeCls = BTN_SIZES[size] || BTN_SIZES.md
  const variantStyle = BTN_VARIANTS[variant] || BTN_VARIANTS.primary
  const iconSize = size === 'lg' ? 14 : 13
  return (
    <button
      className={`inline-flex items-center justify-center font-semibold transition-colors ${sizeCls} ${className}`}
      style={variantStyle}
      {...rest}
    >
      {icon && <Illo name={icon} size={iconSize} color={variantStyle.color} />}
      {children}
      {iconRight && <Illo name={iconRight} size={iconSize} color={variantStyle.color} />}
    </button>
  )
}

/* ============================================================
   V4Pill — 扁平 chip 标签
   tone: accent / second / warn / mute
   ============================================================ */

const PILL_TONES = {
  accent: { background: 'var(--v4-accent-soft)', color: 'var(--v4-accent-deep)' },
  second: { background: 'var(--v4-second-soft)', color: 'var(--v4-second)' },
  warn: { background: 'var(--v4-warn-soft)', color: 'var(--v4-warn)' },
  mute: { background: 'var(--v4-tint)', color: 'var(--v4-mute)' },
}

/** @param {{tone?:string, icon?:string, children:any, className?:string}} props */
export function V4Pill({ tone = 'accent', icon, children, className = '' }) {
  const t = PILL_TONES[tone] || PILL_TONES.accent
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${className}`}
      style={t}
    >
      {icon && <Illo name={icon} size={10} color={t.color} />}
      {children}
    </span>
  )
}

/* ============================================================
   V4Avatar — 插画头像（猫脸 / 狗脸）
   pet: { species: 'cat'|'dog'|'猫'|'狗', color?: string }
   ============================================================ */

/** @param {{pet:{species:string, color?:string}, size?:number, className?:string}} props */
export function V4Avatar({ pet, size = 40, className = '' }) {
  const isCat = pet.species === 'cat' || pet.species === '猫'
  const bg = pet.color || (isCat ? '#f0a896' : '#f4cb84')
  return (
    <div
      className={`rounded-full shrink-0 relative grid place-items-center ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${bg}, oklch(from ${bg} calc(l - 0.08) c h))`,
      }}
    >
      <Illo
        name={isCat ? 'cat-face' : 'dog-face'}
        size={size * 0.82}
        color={`oklch(from ${bg} calc(l - 0.20) c h)`}
      />
    </div>
  )
}

/* ============================================================
   CatEarBubble — 猫耳气泡（chat message bubble）
   from: 'ai' | 'user'
   ============================================================ */

/** @param {{from?:'ai'|'user', color?:string, children:any, className?:string, maxWidth?:number}} props */
export function CatEarBubble({ from = 'ai', color, children, className = '', maxWidth = 320 }) {
  const isUser = from === 'user'
  const bg = isUser ? color || 'var(--v4-accent)' : 'var(--v4-card)'
  const fg = isUser ? 'white' : 'var(--v4-ink)'
  const earOffset = 14

  return (
    <div className={`relative inline-block ${className}`} style={{ maxWidth, paddingTop: 6 }}>
      {/* ears — two triangles sticking out of top */}
      <svg
        className="absolute"
        style={{ top: -3, left: earOffset, transform: 'rotate(-15deg)' }}
        width="18"
        height="14"
        viewBox="0 0 18 14"
      >
        <path
          d="M2 14 L9 1 L16 14 Z"
          fill={bg}
          stroke={isUser ? 'transparent' : 'var(--v4-line)'}
          strokeWidth="1"
        />
        <path
          d="M5 12 L9 5 L13 12 Z"
          fill={isUser ? 'rgba(255,255,255,.25)' : 'var(--v4-accent-soft)'}
        />
      </svg>
      <svg
        className="absolute"
        style={{ top: -3, right: earOffset, transform: 'rotate(15deg)' }}
        width="18"
        height="14"
        viewBox="0 0 18 14"
      >
        <path
          d="M2 14 L9 1 L16 14 Z"
          fill={bg}
          stroke={isUser ? 'transparent' : 'var(--v4-line)'}
          strokeWidth="1"
        />
        <path
          d="M5 12 L9 5 L13 12 Z"
          fill={isUser ? 'rgba(255,255,255,.25)' : 'var(--v4-accent-soft)'}
        />
      </svg>
      <div
        className="relative px-3.5 py-2.5 text-[14px] leading-relaxed border"
        style={{
          boxShadow: 'var(--v4-shadow-sm)',
          background: bg,
          color: fg,
          borderColor: isUser ? 'transparent' : 'var(--v4-line)',
          borderRadius: 18,
        }}
      >
        {children}
      </div>
    </div>
  )
}

/* ============================================================
   PawWatermark — 背景细微小图案点缀
   ============================================================ */

// 猫狗主题图案——多放爪爪，去掉树叶
const WATERMARK_SHAPES = [
  'paw', 'paw', 'paw',  // 爪爪权重最高（每 8 个里 3 个）
  'bone',
  'fish',
  'heart',
  'star',
  'sparkle',
]

/** @param {{density?:number, color?:string}} props */
export function PawWatermark({ density = 0.6, color = 'var(--v4-line)' }) {
  const count = Math.round(32 * density)
  const items = []
  for (let i = 0; i < count; i++) {
    const x = ((i * 173) % 1000) / 10
    const y = ((i * 271) % 1000) / 10
    // 放大：从 14-26 改成 22-44（更显眼）
    const size = 22 + ((i * 7) % 6) * 4
    const rot = (i * 47) % 360
    items.push(
      <div
        key={i}
        className="absolute pointer-events-none"
        style={{
          left: `${x}%`,
          top: `${y}%`,
          transform: `translate(-50%,-50%) rotate(${rot}deg)`,
          opacity: 0.55,
        }}
      >
        <Illo name={WATERMARK_SHAPES[i % WATERMARK_SHAPES.length]} size={size} color={color} />
      </div>
    )
  }
  return <div className="absolute inset-0 overflow-hidden pointer-events-none">{items}</div>
}

/* ============================================================
   V4Card — 通用扁平卡片
   ============================================================ */

/** @param {{className?:string, padding?:string, shadow?:'sm'|'md'|'none', children:any}} props */
export function V4Card({ className = '', padding = 'p-4', shadow = 'sm', children, ...rest }) {
  const shadowVar =
    shadow === 'none' ? 'none' : shadow === 'md' ? 'var(--v4-shadow)' : 'var(--v4-shadow-sm)'
  return (
    <div
      className={`rounded-xl border ${padding} ${className}`}
      style={{
        background: 'var(--v4-card)',
        borderColor: 'var(--v4-line)',
        boxShadow: shadowVar,
      }}
      {...rest}
    >
      {children}
    </div>
  )
}
