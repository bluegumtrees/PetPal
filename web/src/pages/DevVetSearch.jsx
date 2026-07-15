import { useEffect, useState } from 'react'
import { V4Btn, V4Card, Illo } from '../components/v4'

const EXAMPLES = [
  '猫呕吐带血',
  '狗咳嗽',
  'BCS 5 是什么意思',
  '猫挑食不吃主粮',
  '幼犬疫苗时间',
  '误食巧克力怎么办',
  '狗减肥一周减多少',
]

export default function DevVetSearch() {
  const [q, setQ] = useState('')
  const [searched, setSearched] = useState('')
  const [species, setSpecies] = useState('all')
  const [emergencyOnly, setEmergencyOnly] = useState(false)
  const [severity, setSeverity] = useState('')
  const [rerank, setRerank] = useState(true)
  const [state, setState] = useState({ kind: 'idle' })

  useEffect(() => {
    if (!searched) return
    const ctrl = new AbortController()
    async function run() {
      setState({ kind: 'loading' })
      const params = new URLSearchParams({
        q: searched,
        top_k: '5',
        rerank: String(rerank),
      })
      if (species !== 'all') params.set('species', species)
      if (emergencyOnly) params.set('emergency_only', 'true')
      if (severity) params.set('severity', severity)

      const t0 = performance.now()
      try {
        const res = await fetch('/api/vet/search?' + params.toString(), {
          signal: ctrl.signal,
          cache: 'no-store',
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || `HTTP ${res.status}`)
        }
        const data = await res.json()
        setState({
          kind: 'ok',
          data,
          ms: Math.round(performance.now() - t0),
          rerank,
        })
      } catch (e) {
        if (e.name !== 'AbortError') {
          setState({ kind: 'error', msg: String(e.message || e) })
        }
      }
    }
    run()
    return () => ctrl.abort()
  }, [searched, species, emergencyOnly, severity, rerank])

  function submit() {
    const v = q.trim()
    if (v) setSearched(v)
  }

  function pickExample(ex) {
    setQ(ex)
    setSearched(ex)
  }

  return (
    <div>
      {/* 页头：这页也是面试讲检索的展台，把架构一句话讲清 */}
      <div className="mb-4">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs"
          style={{ background: 'var(--v4-tint)', color: 'var(--v4-mute)' }}
        >
          <Illo name="sparkle" size={11} color="var(--v4-accent)" />
          检索调试 · 直连三阶段混合检索
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--v4-faint)' }}>
          473 条知识库 · 稠密（BGE + Chroma）+ 稀疏（BM25 + jieba）→ RRF 融合 → CrossEncoder 重排
        </p>
      </div>

      <V4Card padding="p-5" className="rounded-2xl">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索兽医知识 (例如: 猫呕吐带血)"
              className="flex-1 px-4 py-2.5 rounded-xl border focus:outline-none text-sm"
              style={{
                background: 'var(--v4-card)',
                borderColor: 'var(--v4-line)',
                color: 'var(--v4-ink)',
              }}
            />
            <V4Btn
              type="submit"
              variant="primary"
              disabled={!q.trim() || state.kind === 'loading'}
              className="disabled:opacity-50"
            >
              {state.kind === 'loading' ? '搜索中…' : '搜索'}
            </V4Btn>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => pickExample(ex)}
                className="px-2.5 py-1 rounded-full text-xs transition"
                style={{ background: 'var(--v4-tint)', color: 'var(--v4-mute)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--v4-ink)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--v4-mute)')}
              >
                {ex}
              </button>
            ))}
          </div>

          <div
            className="mt-4 pt-4 border-t flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"
            style={{ borderColor: 'var(--v4-line)' }}
          >
            <Segmented
              label="物种"
              value={species}
              onChange={setSpecies}
              options={[
                { v: 'all', label: '全部' },
                { v: 'cat', label: '🐱 仅猫' },
                { v: 'dog', label: '🐶 仅狗' },
              ]}
            />
            <Segmented
              label="severity"
              value={severity}
              onChange={setSeverity}
              options={[
                { v: '', label: '全部' },
                { v: 'low', label: 'low' },
                { v: 'medium', label: 'med' },
                { v: 'high', label: 'high' },
              ]}
            />
            <label className="flex items-center gap-1.5" style={{ color: 'var(--v4-mute)' }}>
              <input
                type="checkbox"
                checked={emergencyOnly}
                onChange={(e) => setEmergencyOnly(e.target.checked)}
                className="rounded"
                style={{ accentColor: 'var(--v4-accent)' }}
              />
              只看 emergency
            </label>
            <label className="flex items-center gap-1.5" style={{ color: 'var(--v4-mute)' }}>
              <input
                type="checkbox"
                checked={rerank}
                onChange={(e) => setRerank(e.target.checked)}
                className="rounded"
                style={{ accentColor: 'var(--v4-accent)' }}
              />
              rerank
            </label>
          </div>

          {searched && (
            <p className="mt-3 text-xs" style={{ color: 'var(--v4-faint)' }}>
              filter / rerank 改变自动重搜 · 当前 query:{' '}
              <code
                className="px-1.5 py-0.5 rounded"
                style={{ background: 'var(--v4-tint)', color: 'var(--v4-mute)' }}
              >
                {searched}
              </code>{' '}
              · rerank=
              <code
                className="px-1.5 py-0.5 rounded"
                style={{ background: 'var(--v4-tint)', color: 'var(--v4-mute)' }}
              >
                {String(rerank)}
              </code>
            </p>
          )}
        </form>
      </V4Card>

      <div className="mt-6">
        <ResultsArea state={state} />
      </div>
    </div>
  )
}

function Segmented({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs" style={{ color: 'var(--v4-faint)' }}>
        {label}
      </span>
      <div
        className="inline-flex rounded-lg border p-0.5"
        style={{ borderColor: 'var(--v4-line)', background: 'var(--v4-tint)' }}
      >
        {options.map((opt) => {
          const active = value === opt.v
          return (
            <button
              key={opt.v}
              type="button"
              onClick={() => onChange(opt.v)}
              className="px-2.5 py-1 rounded-md text-xs transition"
              style={
                active
                  ? {
                      background: 'var(--v4-card)',
                      color: 'var(--v4-ink)',
                      boxShadow: 'var(--v4-shadow-sm)',
                    }
                  : { color: 'var(--v4-mute)' }
              }
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ResultsArea({ state }) {
  if (state.kind === 'idle') {
    return (
      <p className="text-sm text-center py-12" style={{ color: 'var(--v4-faint)' }}>
        输入关键词或点上方任意示例
      </p>
    )
  }
  if (state.kind === 'loading') {
    return (
      <div className="text-sm text-center py-12" style={{ color: 'var(--v4-mute)' }}>
        <span
          className="inline-block w-2 h-2 rounded-full animate-pulse mr-2"
          style={{ background: 'var(--v4-accent)' }}
        />
        三阶段检索中（dense + sparse + rerank）…
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div
        className="rounded-xl border p-4 text-sm"
        style={{ background: 'var(--v4-warn-soft)', borderColor: 'var(--v4-warn)' }}
      >
        <p className="font-medium" style={{ color: 'var(--v4-warn)' }}>
          搜索失败
        </p>
        <p className="break-all mt-1" style={{ color: 'var(--v4-warn)' }}>
          {state.msg}
        </p>
      </div>
    )
  }

  const { data, ms, rerank } = state
  return (
    <div>
      <p className="text-xs mb-3" style={{ color: 'var(--v4-mute)' }}>
        命中 <span className="font-medium" style={{ color: 'var(--v4-ink)' }}>{data.count}</span> 条
        · 耗时 {ms} ms ·{' '}
        <span style={{ color: rerank ? 'var(--v4-second)' : 'var(--v4-faint)' }}>
          {rerank ? 'rerank ON' : 'rerank OFF（仅 RRF）'}
        </span>
        {Object.keys(data.filters).length > 0 && (
          <>
            {' · 过滤: '}
            <code
              className="px-1.5 py-0.5 rounded"
              style={{ background: 'var(--v4-tint)' }}
            >
              {JSON.stringify(data.filters)}
            </code>
          </>
        )}
      </p>
      <div className="space-y-3">
        {data.results.map((r, i) => (
          <ResultCard key={r.id} result={r} rank={i + 1} />
        ))}
      </div>
    </div>
  )
}

function ResultCard({ result, rank }) {
  const m = result.meta || {}
  return (
    <article
      className="rounded-xl border p-4 transition"
      style={{
        background: 'var(--v4-card)',
        borderColor: 'var(--v4-line)',
        boxShadow: 'var(--v4-shadow-sm)',
      }}
    >
      <header className="flex items-start gap-2 mb-2">
        <span className="text-xs font-mono mt-0.5" style={{ color: 'var(--v4-faint)' }}>
          #{rank}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold" style={{ color: 'var(--v4-ink)' }}>
            {result.title}
          </h3>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--v4-mute)' }}>
            <code className="px-1 rounded" style={{ background: 'var(--v4-tint)' }}>
              {result.id}
            </code>
            {m.source && <span> · {m.source}</span>}
            <span className="ml-2" style={{ color: 'var(--v4-faint)' }}>
              score {result.score.toFixed(3)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1 justify-end">
          {m.emergency && (
            <span
              className="px-1.5 py-0.5 rounded text-xs font-medium"
              style={{ background: 'var(--v4-warn-soft)', color: 'var(--v4-warn)' }}
            >
              急诊
            </span>
          )}
          {m.severity && (
            <span
              className="px-1.5 py-0.5 rounded text-xs font-medium"
              style={severityStyle(m.severity)}
            >
              {m.severity}
            </span>
          )}
          {(m.species || []).map((s) => (
            <span
              key={s}
              className="px-1.5 py-0.5 rounded text-xs"
              style={
                s === '猫'
                  ? { background: 'var(--v4-accent-soft)', color: 'var(--v4-accent-deep)' }
                  : { background: 'var(--v4-tint)', color: 'var(--v4-second)' }
              }
            >
              {s === '猫' ? '🐱' : '🐶'} {s}
            </span>
          ))}
        </div>
      </header>
      <div
        className="text-sm whitespace-pre-wrap leading-relaxed"
        style={{ color: 'var(--v4-ink)' }}
      >
        {result.body}
      </div>
      {(m.tags || []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {m.tags.map((t) => (
            <span key={t} className="text-xs" style={{ color: 'var(--v4-faint)' }}>
              #{t}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

function severityStyle(sev) {
  if (sev === 'high') return { background: 'var(--v4-warn-soft)', color: 'var(--v4-warn)' }
  if (sev === 'medium')
    return { background: 'var(--v4-accent-soft)', color: 'var(--v4-accent-deep)' }
  return { background: 'var(--v4-tint)', color: 'var(--v4-mute)' }
}
