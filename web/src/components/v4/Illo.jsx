// V4 — Hand-drawn SVG illustrations
// 用 currentColor 上色（CSS color 控制），或传 color/secondary prop
// 配合 V4 主题 CSS vars 使用：<Illo name="cat-face" color="var(--v4-accent)" />

/**
 * @param {object} props
 * @param {'cat-face'|'dog-face'|'paw'|'heart'|'sparkle'|'star'|'bone'|'fish'|'yarn'|'crown'|'leaf'|'cloud'|'drop'|'bell'|'syringe'|'scale'|'camera'|'bath'|'moon'|'cat-tail'|'dog-tail'|'scribble'} props.name
 * @param {number} [props.size=24]
 * @param {string} [props.color]
 * @param {string} [props.secondary]
 * @param {string} [props.className]
 * @param {object} [props.style]
 */
export default function Illo({ name, size = 24, color, secondary, className = '', style }) {
  const s = size
  const props = {
    width: s,
    height: s,
    viewBox: '0 0 48 48',
    className,
    style: { color, ...style },
  }

  switch (name) {
    case 'cat-face':
      return (
        <svg {...props}>
          <path d="M11 18 L9 8 L19 14 Z" fill="currentColor" />
          <path d="M37 18 L39 8 L29 14 Z" fill="currentColor" />
          <path d="M13 14 L12 10 L17 13 Z" fill={secondary || '#fff'} />
          <path d="M35 14 L36 10 L31 13 Z" fill={secondary || '#fff'} />
          <ellipse cx="24" cy="26" rx="14" ry="13" fill="currentColor" />
          <circle cx="14" cy="28" r="2" fill={secondary || '#fff'} opacity=".4" />
          <circle cx="34" cy="28" r="2" fill={secondary || '#fff'} opacity=".4" />
          <path d="M18 25 q2 -2 4 0" stroke="#2a1810" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M26 25 q2 -2 4 0" stroke="#2a1810" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M23 28 L25 28 L24 29.5 Z" fill="#2a1810" />
          <path d="M24 29.5 q-1.5 2.5 -3.5 1.5 M24 29.5 q1.5 2.5 3.5 1.5" stroke="#2a1810" strokeWidth="1.3" fill="none" strokeLinecap="round" />
          <path d="M10 26 L17 27 M10 29 L17 28 M38 26 L31 27 M38 29 L31 28" stroke="#2a1810" strokeWidth=".9" strokeLinecap="round" opacity=".5" />
        </svg>
      )

    case 'dog-face':
      return (
        <svg {...props}>
          <path d="M9 16 q-3 6 0 14 q3 4 7 1 L17 18 Z" fill={secondary || 'currentColor'} opacity=".85" />
          <path d="M39 16 q3 6 0 14 q-3 4 -7 1 L31 18 Z" fill={secondary || 'currentColor'} opacity=".85" />
          <ellipse cx="24" cy="26" rx="13" ry="12" fill="currentColor" />
          <ellipse cx="24" cy="31" rx="6" ry="5" fill={secondary || '#fff'} opacity=".5" />
          <circle cx="19" cy="24" r="1.6" fill="#2a1810" />
          <circle cx="29" cy="24" r="1.6" fill="#2a1810" />
          <circle cx="19.6" cy="23.4" r=".5" fill="#fff" />
          <circle cx="29.6" cy="23.4" r=".5" fill="#fff" />
          <ellipse cx="24" cy="29.5" rx="1.8" ry="1.4" fill="#2a1810" />
          <path d="M22 32 q2 3 4 0 L26 35 q-2 1.5 -4 0 Z" fill="#e57589" />
          <circle cx="14" cy="28" r="2" fill="#e57589" opacity=".3" />
          <circle cx="34" cy="28" r="2" fill="#e57589" opacity=".3" />
        </svg>
      )

    case 'paw':
      return (
        <svg {...props}>
          <ellipse cx="14" cy="20" rx="5" ry="6.5" fill="currentColor" />
          <ellipse cx="34" cy="20" rx="5" ry="6.5" fill="currentColor" />
          <ellipse cx="19" cy="11" rx="4" ry="5" fill="currentColor" />
          <ellipse cx="29" cy="11" rx="4" ry="5" fill="currentColor" />
          <path d="M24 26 c-7 0 -11 4 -11 9 c0 5 5 7 11 7 c6 0 11 -2 11 -7 c0 -5 -4 -9 -11 -9 Z" fill="currentColor" />
        </svg>
      )

    case 'heart':
      return (
        <svg {...props}>
          <path d="M24 42 C 8 32 3 22 8 14 C 13 7 22 8 24 14 C 26 8 35 7 40 14 C 45 22 40 32 24 42 Z" fill="currentColor" />
        </svg>
      )

    case 'sparkle':
      return (
        <svg {...props}>
          <path d="M24 4 C 25 16 32 23 44 24 C 32 25 25 32 24 44 C 23 32 16 25 4 24 C 16 23 23 16 24 4 Z" fill="currentColor" />
        </svg>
      )

    case 'star':
      return (
        <svg {...props}>
          <path d="M24 6 L29 18 L42 20 L32 29 L35 42 L24 35 L13 42 L16 29 L6 20 L19 18 Z" fill="currentColor" />
        </svg>
      )

    case 'bone':
      return (
        <svg {...props}>
          <path d="M8 16 C 4 16 4 8 10 8 C 14 8 16 12 18 14 L 30 14 C 32 12 34 8 38 8 C 44 8 44 16 40 16 C 44 16 44 24 38 24 C 34 24 32 20 30 18 L 18 18 C 16 20 14 24 10 24 C 4 24 4 16 8 16 Z" fill="currentColor" transform="translate(0 8) rotate(-18 24 16)" />
        </svg>
      )

    case 'fish':
      return (
        <svg {...props}>
          <ellipse cx="22" cy="24" rx="14" ry="8" fill="currentColor" />
          <path d="M36 24 L 46 16 L 44 24 L 46 32 Z" fill="currentColor" />
          <circle cx="16" cy="22" r="1.6" fill="#fff" />
          <circle cx="16" cy="22" r=".7" fill="#2a1810" />
          <path d="M8 24 q3 -2 6 0 q-3 2 -6 0 Z" fill={secondary || '#fff'} opacity=".4" />
        </svg>
      )

    case 'yarn':
      return (
        <svg {...props}>
          <circle cx="24" cy="24" r="16" fill="currentColor" />
          <path d="M12 18 Q 24 12 36 18 M12 22 Q 24 16 36 22 M12 26 Q 24 20 36 26 M12 30 Q 24 24 36 30" stroke={secondary || '#fff'} strokeWidth="1" fill="none" opacity=".5" />
          <path d="M40 22 Q 44 24 42 28 Q 46 32 42 36" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      )

    case 'crown':
      return (
        <svg {...props}>
          <path d="M6 30 L10 14 L18 22 L24 10 L30 22 L38 14 L42 30 Z" fill="currentColor" />
          <rect x="6" y="30" width="36" height="6" fill="currentColor" />
          <circle cx="10" cy="14" r="2" fill={secondary || '#fff'} />
          <circle cx="24" cy="10" r="2" fill={secondary || '#fff'} />
          <circle cx="38" cy="14" r="2" fill={secondary || '#fff'} />
        </svg>
      )

    case 'leaf':
      return (
        <svg {...props}>
          <path d="M6 42 C 6 22 22 6 42 6 C 42 26 26 42 6 42 Z" fill="currentColor" />
          <path d="M6 42 C 18 30 30 18 42 6" stroke={secondary || '#fff'} strokeWidth="1.5" fill="none" opacity=".5" />
        </svg>
      )

    case 'cloud':
      return (
        <svg {...props}>
          <path d="M12 32 C 4 32 4 22 12 22 C 12 14 22 12 26 18 C 30 12 40 16 40 24 C 46 24 46 32 40 32 Z" fill="currentColor" />
        </svg>
      )

    case 'drop':
      return (
        <svg {...props}>
          <path d="M24 6 C 14 18 8 26 8 32 C 8 40 15 44 24 44 C 33 44 40 40 40 32 C 40 26 34 18 24 6 Z" fill="currentColor" />
          <ellipse cx="18" cy="28" rx="3" ry="5" fill={secondary || '#fff'} opacity=".4" />
        </svg>
      )

    case 'bell':
      return (
        <svg {...props}>
          <path d="M24 6 C 33 6 38 14 38 22 L 38 30 L 42 36 L 6 36 L 10 30 L 10 22 C 10 14 15 6 24 6 Z" fill="currentColor" />
          <ellipse cx="24" cy="40" rx="4" ry="3" fill="currentColor" />
          <circle cx="24" cy="6" r="2" fill="currentColor" />
        </svg>
      )

    case 'syringe':
      return (
        <svg {...props}>
          <rect x="34" y="6" width="6" height="6" rx="2" fill="currentColor" transform="rotate(45 37 9)" />
          <rect x="12" y="20" width="22" height="10" rx="2" fill="currentColor" transform="rotate(-45 23 25)" />
          <rect x="22" y="18" width="4" height="8" fill={secondary || '#fff'} transform="rotate(-45 24 22)" />
          <path d="M6 42 L 14 34" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )

    case 'scale':
      return (
        <svg {...props}>
          <path d="M8 14 L 40 14 L 38 38 C 38 41 36 42 34 42 L 14 42 C 12 42 10 41 10 38 Z" fill="currentColor" />
          <circle cx="24" cy="14" r="6" fill={secondary || '#fff'} opacity=".4" />
          <path d="M16 20 L 32 20" stroke={secondary || '#fff'} strokeWidth="1.5" opacity=".5" />
          <text x="24" y="32" textAnchor="middle" fill={secondary || '#fff'} fontSize="10" fontWeight="bold">kg</text>
        </svg>
      )

    case 'camera':
      return (
        <svg {...props}>
          <rect x="4" y="14" width="40" height="28" rx="4" fill="currentColor" />
          <path d="M16 14 L 20 8 L 28 8 L 32 14 Z" fill="currentColor" />
          <circle cx="24" cy="28" r="9" fill={secondary || '#fff'} opacity=".3" />
          <circle cx="24" cy="28" r="5" fill={secondary || '#fff'} />
          <circle cx="24" cy="28" r="2.5" fill="currentColor" />
          <circle cx="38" cy="20" r="1.6" fill={secondary || '#fff'} />
        </svg>
      )

    case 'bath':
      return (
        <svg {...props}>
          <path d="M4 22 L 44 22 L 42 32 C 42 38 36 42 24 42 C 12 42 6 38 6 32 Z" fill="currentColor" />
          <circle cx="14" cy="16" r="2" fill={secondary || '#fff'} opacity=".5" />
          <circle cx="20" cy="12" r="2.5" fill={secondary || '#fff'} opacity=".5" />
          <circle cx="28" cy="14" r="2" fill={secondary || '#fff'} opacity=".5" />
          <circle cx="34" cy="10" r="1.5" fill={secondary || '#fff'} opacity=".5" />
        </svg>
      )

    case 'moon':
      return (
        <svg {...props}>
          <path d="M24 6 C 14 6 6 14 6 24 C 6 34 14 42 24 42 C 18 36 18 24 24 18 C 28 14 32 12 36 12 C 32 8 28 6 24 6 Z" fill="currentColor" />
        </svg>
      )

    case 'cat-tail':
      return (
        <svg width={size} height={size * 1.2} viewBox="0 0 24 28" className={className} style={{ color, ...style }}>
          <path d="M2 0 C 8 6 14 8 18 14 C 22 20 18 26 12 26 C 8 26 6 22 8 18 C 10 14 14 14 16 18" stroke="currentColor" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </svg>
      )

    case 'dog-tail':
      return (
        <svg width={size} height={size * 1.1} viewBox="0 0 24 26" className={className} style={{ color, ...style }}>
          <path d="M2 2 C 10 8 18 10 22 6 C 22 12 16 16 12 16 C 16 18 18 22 16 24" stroke="currentColor" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </svg>
      )

    case 'scribble':
      return (
        <svg width={size * 2.5} height={size * 0.4} viewBox="0 0 100 16" className={className} style={{ color, ...style }}>
          <path d="M2 8 Q 12 2 24 8 T 50 8 T 76 8 T 98 8" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
        </svg>
      )

    default:
      return (
        <svg {...props}>
          <circle cx="24" cy="24" r="20" fill="currentColor" />
        </svg>
      )
  }
}
