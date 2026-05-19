import { Outlet, Route, Routes } from 'react-router-dom'
import Header from './components/Header'
import Chat from './pages/Chat'
import Dashboard from './pages/Dashboard'
import PetList from './pages/PetList'
import PetForm from './pages/PetForm'
import PetDetail from './pages/PetDetail'
import DevVetSearch from './pages/DevVetSearch'

function Layout() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-rose-50 to-sky-50">
      <Header />
      <main className="max-w-3xl mx-auto p-6 pb-20">
        <Outlet />
      </main>
    </div>
  )
}

function NotFound() {
  return (
    <div className="text-center py-12">
      <p className="text-5xl mb-2">🐾</p>
      <h2 className="text-xl font-semibold text-slate-800 mb-1">页面走丢了</h2>
      <p className="text-sm text-slate-500">检查地址或回到首页</p>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Chat />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="pets" element={<PetList />} />
        <Route path="pets/new" element={<PetForm />} />
        <Route path="pets/:id" element={<PetDetail />} />
        <Route path="pets/:id/edit" element={<PetForm />} />
        <Route path="dev/vet-search" element={<DevVetSearch />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
