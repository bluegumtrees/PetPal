import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { V4Btn, V4Card, Illo } from '../components/v4'

export default function Login() {
  const { login, demoLogin } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const from = params.get('from') || '/'
  // /login?demo=1 → 自动一键登录（简历二维码直达 demo 账号，省一次点击）
  const autoDemo = params.get('demo') === '1'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const autoDemoFired = useRef(false)
  useEffect(() => {
    if (autoDemo && !autoDemoFired.current) {
      autoDemoFired.current = true // StrictMode 双跑 / 重渲染防重复触发
      handleDemo()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDemo])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(String(err.message || err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDemo() {
    setError('')
    setSubmitting(true)
    try {
      await demoLogin()
      navigate(from, { replace: true })
    } catch (err) {
      setError(String(err.message || err))
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    background: 'var(--v4-card)',
    borderColor: 'var(--v4-line)',
    color: 'var(--v4-ink)',
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        background:
          'linear-gradient(135deg, var(--v4-tint), var(--v4-accent-soft))',
      }}
    >
      <V4Card padding="p-8" shadow="md" className="w-full max-w-sm rounded-2xl">
        <div className="text-center mb-6">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-3"
            style={{ background: 'var(--v4-accent-soft)' }}
          >
            <Illo name="cat-face" size={48} color="white" secondary="white" />
          </div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--v4-ink)' }}>
            登录 PetPal
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--v4-faint)' }}>
            多模态宠物管家
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--v4-mute)' }}>
              邮箱
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--v4-mute)' }}>
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
            />
          </div>

          {error && (
            <div
              className="rounded-md px-3 py-2 text-xs border"
              style={{
                background: 'var(--v4-warn-soft)',
                borderColor: 'var(--v4-warn)',
                color: 'var(--v4-warn)',
              }}
            >
              {error}
            </div>
          )}

          <V4Btn
            type="submit"
            variant="primary"
            size="lg"
            disabled={submitting}
            className="w-full"
            icon="paw"
          >
            {submitting ? '登录中…' : '登录'}
          </V4Btn>
        </form>

        <div className="my-4 flex items-center gap-2 text-xs" style={{ color: 'var(--v4-faint)' }}>
          <div className="flex-1 h-px" style={{ background: 'var(--v4-line)' }} />
          <span>或</span>
          <div className="flex-1 h-px" style={{ background: 'var(--v4-line)' }} />
        </div>

        <V4Btn
          type="button"
          variant="secondary"
          size="lg"
          onClick={handleDemo}
          disabled={submitting}
          className="w-full"
          icon="sparkle"
        >
          {autoDemo && submitting ? '正在进入演示账号…' : '🎈 一键试用 demo 账号'}
        </V4Btn>

        <p className="text-center text-xs mt-5" style={{ color: 'var(--v4-mute)' }}>
          还没账号？{' '}
          <Link
            to="/register"
            className="transition"
            style={{ color: 'var(--v4-accent-deep)' }}
          >
            注册
          </Link>
        </p>
      </V4Card>
    </div>
  )
}
