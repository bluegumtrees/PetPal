import { useEffect, useState } from 'react'

const EXAMPLES = [
  '猫呕吐带血',
  '狗咳嗽',
  'BCS 5 是什么意思',
  '猫不吃饭一天',
  '幼犬疫苗时间',
  '误食巧克力怎么办',
  '猫尾巴抽打代表什么',
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
      <div className="mb-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-xs text-slate-500">
        <span>⚙</span> 开发者后台 · 直接调 RAG 检索
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索兽医知识 (例如: 猫呕吐带血)"
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400 text-slate-800"
          />
          <button
            type="submit"
            disabled={!q.trim() || state.kind === 'loading'}
            className="px-5 py-2.5 rounded-xl bg-amber-500 text-white font-medium hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {state.kind === 'loading' ? '搜索中…' : '搜索'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => pickExample(ex)}
              className="px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-xs text-slate-600 transition"
            >
              {ex}
            </button>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
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
          <label className="flex items-center gap-1.5 text-slate-600">
            <input
              type="checkbox"
              checked={emergencyOnly}
              onChange={(e) => setEmergencyOnly(e.target.checked)}
              className="rounded"
            />
            只看 emergency
          </label>
          <label className="flex items-center gap-1.5 text-slate-600">
            <input
              type="checkbox"
              checked={rerank}
              onChange={(e) => setRerank(e.target.checked)}
              className="rounded"
            />
            rerank
          </label>
        </div>

        {searched && (
          <p className="mt-3 text-xs text-slate-400">
            <span className="text-slate-500">filter / rerank 改变自动重搜，</span>
            当前 query: <code className="bg-slate-100 px-1.5 py-0.5 rounded">{searched}</code>{' '}
            · rerank=<code className="bg-slate-100 px-1.5 py-0.5 rounded">{String(rerank)}</code>
          </p>
        )}
      </form>

      <div className="mt-6">
        <ResultsArea state={state} />
      </div>
    </div>
  )
}

function Segmented({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-slate-500 text-xs">{label}</span>
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        {options.map((opt) => (
          <button
            key={opt.v}
            type="button"
            onClick={() => onChange(opt.v)}
            className={
              'px-2.5 py-1 rounded-md text-xs transition ' +
              (value === opt.v
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700')
            }
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ResultsArea({ state }) {
  if (state.kind === 'idle') {
    return (
      <p className="text-sm text-slate-400 text-center py-12">
        输入关键词或点上方任意示例
      </p>
    )
  }
  if (state.kind === 'loading') {
    return (
      <div className="text-sm text-slate-500 text-center py-12">
        <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse mr-2" />
        三阶段检索中（dense + sparse + rerank）…
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm">
        <p className="text-red-700 font-medium">搜索失败</p>
        <p className="text-red-600 break-all mt-1">{state.msg}</p>
      </div>
    )
  }

  const { data, ms, rerank } = state
  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">
        命中 <span className="font-medium text-slate-700">{data.count}</span> 条 · 耗时 {ms} ms ·{' '}
        <span className={rerank ? 'text-emerald-600' : 'text-slate-400'}>
          {rerank ? 'rerank ON' : 'rerank OFF（仅 RRF）'}
        </span>
        {Object.keys(data.filters).length > 0 && (
          <>
            {' · 过滤: '}
            <code className="bg-slate-100 px-1.5 py-0.5 rounded">
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
    <article className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition">
      <header className="flex items-start gap-2 mb-2">
        <span className="text-xs font-mono text-slate-400 mt-0.5">#{rank}</span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-800">{result.title}</h3>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            <code className="bg-slate-100 px-1 rounded">{result.id}</code>
            {m.source && <span> · {m.source}</span>}
            <span className="ml-2 text-slate-400">score {result.score.toFixed(3)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1 justify-end">
          {m.emergency && (
            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 border border-red-200">
              急诊
            </span>
          )}
          {m.severity && (
            <span className={'px-1.5 py-0.5 rounded text-xs font-medium border ' + severityClass(m.severity)}>
              {m.severity}
            </span>
          )}
          {(m.species || []).map((s) => (
            <span
              key={s}
              className={
                'px-1.5 py-0.5 rounded text-xs border ' +
                (s === '猫'
                  ? 'bg-pink-50 text-pink-700 border-pink-200'
                  : 'bg-sky-50 text-sky-700 border-sky-200')
              }
            >
              {s === '猫' ? '🐱' : '🐶'} {s}
            </span>
          ))}
        </div>
      </header>
      <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
        {result.body}
      </div>
      {(m.tags || []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {m.tags.map((t) => (
            <span key={t} className="text-xs text-slate-400">
              #{t}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

function severityClass(sev) {
  if (sev === 'high') return 'bg-orange-50 text-orange-700 border-orange-200'
  if (sev === 'medium') return 'bg-yellow-50 text-yellow-700 border-yellow-200'
  return 'bg-slate-50 text-slate-600 border-slate-200'
}
