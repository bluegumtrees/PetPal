import { useEffect, useRef, useState } from 'react'
import { V4Btn, Illo } from './v4'

/**
 * @param {{
 *   onSubmit: (args: { text: string, image: File|null }) => void,
 *   disabled: boolean,
 *   onCancel?: () => void,
 *   isStreaming: boolean
 * }} props
 */
export default function ChatInput({
  onSubmit,
  disabled,
  onCancel,
  isStreaming,
  initialText = '',
}) {
  const [text, setText] = useState(initialText)
  /** @type {[File|null, Function]} */
  const [image, setImage] = useState(null)
  const [preview, setPreview] = useState('')
  const fileRef = useRef(null)
  const textareaRef = useRef(null)

  // 图片预览
  useEffect(() => {
    if (!image) {
      setPreview('')
      return
    }
    const url = URL.createObjectURL(image)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [image])

  // textarea 自动高度
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }, [text])

  function submit() {
    const t = text.trim()
    if (!t && !image) return
    if (disabled) return
    onSubmit({ text: t, image })
    setText('')
    setImage(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div
      className="border-t backdrop-blur p-3"
      style={{
        borderColor: 'var(--v4-line)',
        background: 'color-mix(in oklch, var(--v4-card) 90%, transparent)',
      }}
    >
      <div className="max-w-3xl mx-auto">
        {image && (
          <div
            className="mb-2 inline-flex items-center gap-2 rounded-lg p-1.5 pr-3 border"
            style={{
              background: 'var(--v4-accent-soft)',
              borderColor: 'var(--v4-accent)',
            }}
          >
            <img src={preview} alt="" className="w-12 h-12 object-cover rounded" />
            <span
              className="text-xs truncate max-w-[200px]"
              style={{ color: 'var(--v4-accent-deep)' }}
            >
              {image.name}
            </span>
            <button
              type="button"
              onClick={() => setImage(null)}
              className="text-sm transition"
              style={{ color: 'var(--v4-mute)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--v4-ink)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--v4-mute)')}
              aria-label="移除图片"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <label
            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition border"
            style={{
              background: 'var(--v4-card)',
              borderColor: 'var(--v4-line)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v4-tint)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--v4-card)')}
            title="上传图片"
          >
            <Illo name="camera" size={18} color="var(--v4-mute)" />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setImage(e.target.files?.[0] || null)}
            />
          </label>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder={image ? '描述这张图片（可选）...' : '描述你的宠物 / 提问 / 上传照片...'}
            className="flex-1 resize-none px-4 py-2.5 rounded-2xl border focus:outline-none focus:ring-2 text-sm leading-relaxed"
            style={{
              borderColor: 'var(--v4-line)',
              background: 'var(--v4-card)',
              color: 'var(--v4-ink)',
              outlineColor: 'var(--v4-accent)',
            }}
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={onCancel}
              className="shrink-0 px-4 h-10 rounded-full text-white text-sm font-medium transition"
              style={{ background: 'var(--v4-warn)' }}
            >
              停止
            </button>
          ) : (
            <V4Btn
              variant="primary"
              size="lg"
              onClick={submit}
              disabled={disabled || (!text.trim() && !image)}
              className="shrink-0 !rounded-full !px-5 disabled:opacity-40 disabled:cursor-not-allowed"
              icon="paw"
            >
              发送
            </V4Btn>
          )}
        </div>
        <p className="text-[10px] mt-1.5 px-1" style={{ color: 'var(--v4-faint)' }}>
          Enter 发送 · Shift+Enter 换行 · 单图最大 10MB
        </p>
      </div>
    </div>
  )
}
