import { Outlet, Route, Routes } from 'react-router-dom'
import Header from './components/Header'
import MobileDrawer from './components/MobileDrawer'
import PetStatusPanel from './components/PetStatusPanel'
import ProtectedRoute from './components/ProtectedRoute'
import { PawWatermark, Illo } from './components/v4'
import { AuthProvider } from './context/AuthContext'
import { PetProvider } from './context/PetContext'
import { SidebarProvider, useSidebar } from './context/SidebarContext'
import Chat from './pages/Chat'
import Dashboard from './pages/Dashboard'
import DevVetSearch from './pages/DevVetSearch'
import Login from './pages/Login'
import PetDetail from './pages/PetDetail'
import PetForm from './pages/PetForm'
import PetList from './pages/PetList'
import Register from './pages/Register'

function Layout() {
  const { petPanelOpen, closePetPanel } = useSidebar()

  return (
    <div className="min-h-screen relative" style={{ background: 'var(--v4-paper)' }}>
      {/* V4 全局背景小图案 */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <PawWatermark density={0.65} color="var(--v4-line)" />
      </div>
      <div className="relative z-10">
        <Header />
        {/* main 自然展开 → window 整体滚动；panel 开时 wrapper 加 padding 给 fixed panel 留位置 */}
        <div
          className={
            petPanelOpen
              ? 'md:pr-[280px] lg:pr-[320px] transition-[padding] duration-200'
              : ''
          }
        >
          <main className="max-w-3xl mx-auto p-3 sm:p-6 pb-20 min-w-0 w-full">
            <Outlet />
          </main>
        </div>
        {/* 桌面端 fixed PetStatusPanel（脱离文档流，不影响 main scroll；md+ 显示） */}
        {petPanelOpen && (
          <aside
            className="hidden md:flex md:flex-col fixed border-l z-[8]"
            style={{
              top: 60,
              bottom: 0,
              right: 0,
              width: 280,
              borderColor: 'var(--v4-line)',
              background: 'var(--v4-tint)',
            }}
          >
            <PetStatusPanel
              onClose={closePetPanel}
              onNavigate={closePetPanel}
              compact
            />
          </aside>
        )}
      </div>
      {/* 移动端右抽屉（md 以下用） */}
      <div className="md:hidden">
        <MobileDrawer open={petPanelOpen} onClose={closePetPanel} side="right">
          <PetStatusPanel onClose={closePetPanel} onNavigate={closePetPanel} />
        </MobileDrawer>
      </div>
    </div>
  )
}

function NotFound() {
  return (
    <div className="text-center py-12">
      <div
        className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-3"
        style={{ background: 'var(--v4-accent-soft)' }}
      >
        <Illo name="paw" size={36} color="var(--v4-accent-deep)" />
      </div>
      <h2 className="text-xl font-semibold mb-1" style={{ color: 'var(--v4-ink)' }}>
        页面走丢了
      </h2>
      <p className="text-sm" style={{ color: 'var(--v4-mute)' }}>
        检查地址或回到首页
      </p>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <PetProvider>
        <SidebarProvider>
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
        </SidebarProvider>
      </PetProvider>
    </AuthProvider>
  )
}
