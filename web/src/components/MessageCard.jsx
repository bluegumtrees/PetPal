import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Lightbox from './Lightbox'
import { vlmBadge } from './VLMCard'

/**
 * 用户消息卡片：右对齐，米色，纯文本 + 缩略图。
 * @param {{ content: string, imageUrl?: string, vlmTask?: string, vlmOutput?: object }} props
 */
export function UserMessage({ content, imageUrl, vlmTask, vlmOutput }) {
  const [lightbox, setLightbox] = useState(false)
  const badge = vlmTask && vlmOutput ? vlmBadge(vlmTask, vlmOutput) : null

  return (
    <div className="flex justify-end mb-3">
      <div className="max-w-[80%] flex flex-col items-end gap-1">
        {imageUrl && (
          <div className="relative inline-block">
            <img
              src={imageUrl}
              alt=""
              onClick={() => setLightbox(true)}
              className="w-[150px] h-[150px] object-cover rounded-xl cursor-zoom-in shadow-sm hover:shadow-md transition"
            />
            {badge && (
              <span
                className={
                  'absolute bottom-1.5 left-1.5 right-1.5 text-[11px] font-medium text-center px-1.5 py-0.5 rounded backdrop-blur-sm ' +
                  (badge.kind === 'alert'
                    ? 'bg-red-500/85 text-white'
                    : badge.kind === 'warn'
                    ? 'bg-orange-500/85 text-white'
                    : 'bg-black/55 text-white')
                }
              >
                {badge.label}
              </span>
            )}
            {lightbox && <Lightbox src={imageUrl} onClose={() => setLightbox(false)} />}
          </div>
        )}
        {content && (
          <div className="bg-amber-100 text-slate-800 rounded-2xl rounded-tr-md px-4 py-2 text-sm whitespace-pre-wrap">
            {content}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * AI 消息卡片：左对齐，白色，markdown 渲染。
 * @param {{ content: string, pet?: object }} props
 */
export function AssistantMessage({ content, pet }) {
  if (!content) return null
  return (
    <div className="flex gap-2 mb-3">
      <div className="shrink-0 mt-0.5">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-rose-400 flex items-center justify-center text-white text-sm">
          🐾
        </div>
      </div>
      <div className="max-w-[80%] bg-white border border-slate-200 rounded-2xl rounded-tl-md px-4 py-2 shadow-sm">
        <div className="prose prose-sm max-w-none text-slate-800 leading-relaxed">
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

  // 短内容直接展示，淡灰小字
  if (isShort) {
    return (
      <div className="flex gap-2 mb-2">
        <div className="shrink-0">
          <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs">
            💭
          </div>
        </div>
        <div className="text-xs text-slate-500 italic self-center">{text}</div>
      </div>
    )
  }

  // 长内容默认折叠
  const preview = text.replace(/\n+/g, ' ').slice(0, 60) + '…'
  return (
    <div className="my-2 bg-slate-50 border border-slate-200 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-100 rounded-xl transition"
      >
        <span className="text-sm">💭</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">中间分析</span>
        <span className="flex-1 text-xs text-slate-500 truncate">{preview}</span>
        <span className="text-xs text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-3">
          <div className="prose prose-sm max-w-none text-slate-600">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  )
}
