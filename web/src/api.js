/**
 * 统一 fetch 封装。
 * 用法：
 *   const pets = await api('/api/pets')
 *   const pet  = await api('/api/pets', { method: 'POST', body: {...} })
 *   const pet  = await uploadFile('/api/pets/1/avatar', file)
 */

/**
 * @param {string} path
 * @param {{ method?: string, body?: any, headers?: Record<string,string>, signal?: AbortSignal }} [opts]
 */
export async function api(path, opts = {}) {
  const { method = 'GET', body, headers = {}, signal } = opts
  const init = {
    method,
    headers: { ...headers },
    signal,
    cache: 'no-store',
  }
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await fetch(path, init)
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const err = await res.json()
      detail = err.detail || JSON.stringify(err)
    } catch {
      /* not json */
    }
    throw new Error(detail)
  }
  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

/**
 * 上传文件（multipart）。
 * @param {string} path
 * @param {File} file
 */
export async function uploadFile(path, file) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(path, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

/**
 * SSE 流式 chat。注意：浏览器原生 EventSource 不支持 POST/multipart，
 * 必须用 fetch + ReadableStream 手动解析 SSE 帧。
 *
 * @param {{ petId: number, sessionId: string, text?: string, image?: File }} args
 * @param {(event: object) => void} onEvent  每个 SSE event 触发一次
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}  完成时 resolve
 */
export async function streamChat({ petId, sessionId, text, image }, onEvent, signal) {
  const form = new FormData()
  form.append('pet_id', String(petId))
  form.append('session_id', sessionId)
  form.append('text', text || '')
  if (image) form.append('image', image)

  const res = await fetch('/api/agent/chat/stream', {
    method: 'POST',
    body: form,
    signal,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  if (!res.body) throw new Error('no response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() || ''
    for (const part of parts) {
      const lines = part.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            onEvent(data)
          } catch (e) {
            console.warn('failed to parse SSE event', line, e)
          }
        }
      }
    }
  }
}
