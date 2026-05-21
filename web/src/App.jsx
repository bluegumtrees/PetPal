import { Outlet, Route, Routes } from 'react-router-dom'
import Header from './components/Header'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './context/AuthContext'
import { PetProvider } from './context/PetContext'
import Chat from './pages/Chat'
import Dashboard from './pages/Dashboard'
import DevVetSearch from './pages/DevVetSearch'
import Login from './pages/Login'
import PetDetail from './pages/PetDetail'
import PetForm from './pages/PetForm'
import PetList from './pages/PetList'
import Register from './pages/Register'

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
    <AuthProvider>
      <PetProvider>
        <Routes>
          {/* 公开路由 */}
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />

          {/* 受保护路由（包 Layout + ProtectedRoute） */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
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
      </PetProvider>
    </AuthProvider>
  )
}
