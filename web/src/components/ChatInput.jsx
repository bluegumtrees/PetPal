import { useEffect, useRef, useState } from 'react'

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
    <div className="border-t border-slate-200 bg-white/90 backdrop-blur p-3">
      <div className="max-w-3xl mx-auto">
        {image && (
          <div className="mb-2 inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-1.5 pr-3">
            <img src={preview} alt="" className="w-12 h-12 object-cover rounded" />
            <span className="text-xs text-slate-600 truncate max-w-[200px]">{image.name}</span>
            <button
              type="button"
              onClick={() => setImage(null)}
              className="text-slate-400 hover:text-slate-700 text-sm"
              aria-label="移除图片"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <label
            className="shrink-0 w-10 h-10 rounded-full border border-slate-300 bg-white flex items-center justify-center cursor-pointer hover:bg-slate-50 transition"
            title="上传图片"
          >
            📎
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
            className="flex-1 resize-none px-4 py-2.5 rounded-2xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 text-slate-800 text-sm leading-relaxed"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={onCancel}
              className="shrink-0 px-4 h-10 rounded-full bg-red-500 hover:bg-red-600 text-white text-sm transition"
            >
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={disabled || (!text.trim() && !image)}
              className="shrink-0 px-5 h-10 rounded-full bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm transition"
            >
              发送
            </button>
          )}
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5 px-1">
          Enter 发送 · Shift+Enter 换行 · 单图最大 10MB
        </p>
      </div>
    </div>
  )
}
