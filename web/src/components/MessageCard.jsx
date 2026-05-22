import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Lightbox from './Lightbox'
import { vlmBadge } from './VLMCard'
import { CatEarBubble, Illo } from './v4'

/**
 * 用户消息卡片：右对齐，猫耳气泡（V4），纯文本 + 缩略图。
 * @param {{ content: string, imageUrl?: string, vlmTask?: string, vlmOutput?: object }} props
 */
export function UserMessage({ content, imageUrl, vlmTask, vlmOutput }) {
  const [lightbox, setLightbox] = useState(false)
  const badge = vlmTask && vlmOutput ? vlmBadge(vlmTask, vlmOutput) : null

  return (
    <div className="flex justify-end items-start gap-2 mb-3">
      <div className="max-w-[80%] flex flex-col items-end gap-1.5">
        {imageUrl && (
          <div className="relative inline-block">
            <img
              src={imageUrl}
              alt=""
              onClick={() => setLightbox(true)}
              className="w-[150px] h-[150px] object-cover rounded-xl cursor-zoom-in shadow-sm hover:shadow-md transition border"
              style={{ borderColor: 'var(--v4-line)' }}
            />
            {badge && (
              <span
                className={
                  'absolute bottom-1.5 left-1.5 right-1.5 text-[11px] font-medium text-center px-1.5 py-0.5 rounded backdrop-blur-sm '
                }
                style={{
                  background:
                    badge.kind === 'alert'
                      ? 'color-mix(in oklch, var(--v4-warn) 85%, transparent)'
                      : badge.kind === 'warn'
                      ? 'color-mix(in oklch, var(--v4-accent) 85%, transparent)'
                      : 'rgba(0,0,0,0.55)',
                  color: 'white',
                }}
              >
                {badge.label}
              </span>
            )}
            {lightbox && <Lightbox src={imageUrl} onClose={() => setLightbox(false)} />}
          </div>
        )}
        {content && (
          <CatEarBubble from="user" maxWidth={520}>
            <div className="whitespace-pre-wrap">{content}</div>
          </CatEarBubble>
        )}
      </div>
      {/* user avatar — 小爪子 */}
      <div
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-1"
        style={{ background: 'var(--v4-accent-soft)' }}
      >
        <Illo name="paw" size={14} color="var(--v4-accent-deep)" />
      </div>
    </div>
  )
}

/**
 * AI 消息卡片：左对齐，V4 卡片 + 猫脸头像，markdown 渲染。
 * @param {{ content: string, pet?: object }} props
 */
export function AssistantMessage({ content }) {
  if (!content) return null
  return (
    <div className="flex gap-2 mb-3 items-start">
      <div
        className="shrink-0 mt-0.5 w-9 h-9 rounded-full flex items-center justify-center"
        style={{ background: 'var(--v4-accent-soft)' }}
      >
        <Illo name="cat-face" size={28} color="white" secondary="white" />
      </div>
      <div
        className="max-w-[80%] rounded-2xl rounded-tl-md px-4 py-2 border"
        style={{
          background: 'var(--v4-card)',
          borderColor: 'var(--v4-line)',
          color: 'var(--v4-ink)',
          boxShadow: 'var(--v4-shadow-sm)',
        }}
      >
        <div className="prose prose-sm max-w-none leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

/**
 * Agent 中间步骤——默认折叠，避免抢 final_answer 焦点。
 * 内容短（< 40 字）时不折叠（如「我先查一下知识库」），长则默认折叠 + 预览。
 */
export function AssistantThinking({ content }) {
  const text = (content || '').trim()
  const isShort = text.length <= 40
  const [open, setOpen] = useState(false)
  if (!text) return null

  // 短内容直接展示，淡色小字 + 灯泡
  if (isShort) {
    return (
      <div className="flex gap-2 mb-2 items-center">
        <div
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs"
          style={{ background: 'var(--v4-tint)' }}
        >
          <Illo name="sparkle" size={14} color="var(--v4-faint)" />
        </div>
        <div className="text-xs italic" style={{ color: 'var(--v4-mute)' }}>
          {text}
        </div>
      </div>
    )
  }

  // 长内容默认折叠
  const preview = text.replace(/\n+/g, ' ').slice(0, 60) + '…'
  return (
    <div
      className="my-2 rounded-xl border"
      style={{
        background: 'var(--v4-tint)',
        borderColor: 'var(--v4-line)',
        boxShadow: 'var(--v4-shadow-sm)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left rounded-xl transition"
        style={{ color: 'var(--v4-mute)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v4-accent-soft)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <Illo name="sparkle" size={14} color="var(--v4-accent)" />
        <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--v4-faint)' }}>
          中间分析
        </span>
        <span className="flex-1 text-xs truncate" style={{ color: 'var(--v4-mute)' }}>
          {preview}
        </span>
        <span className="text-xs" style={{ color: 'var(--v4-faint)' }}>
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3">
          <div className="prose prose-sm max-w-none" style={{ color: 'var(--v4-mute)' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  )
}
