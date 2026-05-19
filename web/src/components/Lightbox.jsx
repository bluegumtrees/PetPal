import { useEffect } from 'react'

/** @param {{ src: string, onClose: () => void }} props */
export default function Lightbox({ src, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 cursor-zoom-out animate-[fade-in_120ms_ease-out]"
      onClick={onClose}
    >
      <img
        src={src}
        alt=""
        className="max-h-[90vh] max-w-[90vw] object-contain rounded shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 text-white text-3xl hover:opacity-70 transition"
        aria-label="close"
      >
        ✕
      </button>
    </div>
  )
}
