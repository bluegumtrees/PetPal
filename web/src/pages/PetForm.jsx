import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, uploadFile } from '../api'
import Avatar from '../components/Avatar'
import { usePets } from '../context/PetContext'

const EMPTY_FORM = {
  name: '',
  species: 'cat',
  breed: '',
  birthday: '',
  gender: '',
  neutered: null,
  weight_kg: '',
}

export default function PetForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { reload, setActivePetId } = usePets()

  const [form, setForm] = useState(EMPTY_FORM)
  /** @type {[File|null, Function]} */
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [existingPhotoUrl, setExistingPhotoUrl] = useState('')

  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 加载编辑数据
  useEffect(() => {
    if (!isEdit) return
    setLoading(true)
    api(`/api/pets/${id}`)
      .then((p) => {
        setForm({
          name: p.name || '',
          species: p.species || 'cat',
          breed: p.breed || '',
          birthday: p.birthday || '',
          gender: p.gender || '',
          neutered: p.neutered ?? null,
          weight_kg: p.weight_kg ?? '',
        })
        setExistingPhotoUrl(p.photo_url || '')
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false))
  }, [id, isEdit])

  // 图片预览
  useEffect(() => {
    if (!file) {
      setPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('请输入宠物名字')
      return
    }
    setSaving(true)
    setError('')

    // 转换：空字符串 → null / 数字
    const payload = {
      name: form.name.trim(),
      species: form.species,
      breed: form.breed.trim() || null,
      birthday: form.birthday || null,
      gender: form.gender || null,
      neutered: form.neutered,
      weight_kg:
        form.weight_kg === '' || form.weight_kg === null
          ? null
          : Number(form.weight_kg),
    }
    // 编辑模式 species 不可改（创建时已确定）
    if (isEdit) delete payload.species

    try {
      let pet
      if (isEdit) {
        pet = await api(`/api/pets/${id}`, { method: 'PATCH', body: payload })
      } else {
        pet = await api('/api/pets', { method: 'POST', body: payload })
      }
      if (file) {
        pet = await uploadFile(`/api/pets/${pet.id}/avatar`, file)
      }
      await reload()
      if (!isEdit) setActivePetId(pet.id)
      navigate(`/pets/${pet.id}`)
    } catch (e2) {
      setError(String(e2.message || e2))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-400 text-center py-10">加载中…</p>
  }

  const avatarSrc = previewUrl || existingPhotoUrl
  const avatarPet = avatarSrc
    ? { photo_url: avatarSrc, species: form.species, name: form.name }
    : { species: form.species, name: form.name }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <Link to="/pets" className="text-sm text-slate-500 hover:text-slate-700">
          ← 返回
        </Link>
        <h2 className="text-xl font-semibold text-slate-800">
          {isEdit ? '编辑宠物' : '新建宠物'}
        </h2>
      </div>

      <form
        onSubmit={submit}
        className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5"
      >
        {/* 头像 */}
        <div className="flex items-center gap-4">
          <Avatar pet={avatarPet} size={80} />
          <label className="cursor-pointer">
            <span className="text-sm text-amber-600 hover:text-amber-700">
              {avatarSrc ? '换张照片' : '上传头像'}
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {file && (
              <p className="text-xs text-slate-400 mt-1">{file.name}</p>
            )}
          </label>
        </div>

        {/* 名字 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            名字 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            maxLength={50}
            required
            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>

        {/* 物种 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            物种 <span className="text-red-500">*</span>
            {isEdit && (
              <span className="text-xs text-slate-400 font-normal ml-2">
                (新建后不可修改)
              </span>
            )}
          </label>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {['cat', 'dog'].map((s) => (
              <button
                key={s}
                type="button"
                disabled={isEdit}
                onClick={() => update('species', s)}
                className={
                  'px-4 py-1.5 rounded-md text-sm transition disabled:opacity-50 disabled:cursor-not-allowed ' +
                  (form.species === s
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700')
                }
              >
                {s === 'cat' ? '🐱 猫' : '🐶 狗'}
              </button>
            ))}
          </div>
        </div>

        {/* 品种 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            品种
          </label>
          <input
            type="text"
            value={form.breed}
            onChange={(e) => update('breed', e.target.value)}
            placeholder="如：英短 / 金毛 / 中华田园猫"
            maxLength={50}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>

        {/* 生日 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            生日
          </label>
          <input
            type="date"
            value={form.birthday}
            onChange={(e) => update('birthday', e.target.value)}
            max={new Date().toISOString().split('T')[0]}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>

        {/* 性别 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            性别
          </label>
          <select
            value={form.gender}
            onChange={(e) => update('gender', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            <option value="">未填写</option>
            <option value="male">公</option>
            <option value="female">母</option>
            <option value="unknown">未知</option>
          </select>
        </div>

        {/* 绝育 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            是否绝育
          </label>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {[
              { v: null, label: '未填' },
              { v: true, label: '已绝育' },
              { v: false, label: '未绝育' },
            ].map(({ v, label }) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => update('neutered', v)}
                className={
                  'px-3 py-1.5 rounded-md text-sm transition ' +
                  (form.neutered === v
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700')
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 体重 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            体重 (kg)
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={form.weight_kg}
            onChange={(e) => update('weight_kg', e.target.value)}
            placeholder="如：4.5"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white px-5 py-2 rounded-lg transition"
          >
            {saving ? '保存中…' : isEdit ? '保存修改' : '创建宠物'}
          </button>
          <Link
            to={isEdit ? `/pets/${id}` : '/pets'}
            className="px-5 py-2 rounded-lg text-slate-600 hover:bg-slate-100 transition"
          >
            取消
          </Link>
        </div>
      </form>
    </div>
  )
}
