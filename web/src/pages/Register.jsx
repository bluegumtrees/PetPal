import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { V4Btn, V4Card, Illo } from '../components/v4'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await register(email, password, name)
      navigate('/', { replace: true })
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
            注册 PetPal
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--v4-faint)' }}>
            创建你的多模态宠物管家账号
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--v4-mute)' }}>
              显示名
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={50}
              autoFocus
              placeholder="想被怎么称呼？"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--v4-mute)' }}>
              邮箱
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--v4-mute)' }}>
              密码（至少 6 位）
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              maxLength={72}
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
            {submitting ? '注册中…' : '注册'}
          </V4Btn>
        </form>

        <p className="text-center text-xs mt-5" style={{ color: 'var(--v4-mute)' }}>
          已有账号？{' '}
          <Link
            to="/login"
            className="transition"
            style={{ color: 'var(--v4-accent-deep)' }}
          >
            登录
          </Link>
        </p>
      </V4Card>
    </div>
  )
}
