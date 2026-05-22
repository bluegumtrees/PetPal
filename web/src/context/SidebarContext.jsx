import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * @typedef {Object} SidebarProps
 * @property {string|null} [currentSessionId]
 * @property {(sid: string) => void} [onSelectSession]
 * @property {() => void} [onCurrentSessionDeleted]
 * @property {() => void} [onNewSession]
 */

/**
 * @typedef {Object} SidebarCtx
 * @property {boolean} open               左侧（Sessions/Nav）抽屉
 * @property {() => void} openSidebar
 * @property {() => void} closeSidebar
 * @property {boolean} petPanelOpen       右侧（PetCard）抽屉
 * @property {() => void} openPetPanel
 * @property {() => void} closePetPanel
 * @property {SidebarProps} props
 * @property {(p: SidebarProps) => void} setSidebarProps
 */

/** @type {React.Context<SidebarCtx>} */
const SidebarContext = createContext({
  open: false,
  openSidebar: () => {},
  closeSidebar: () => {},
  petPanelOpen: false,
  openPetPanel: () => {},
  closePetPanel: () => {},
  props: {},
  setSidebarProps: () => {},
})

export function SidebarProvider({ children }) {
  const [open, setOpen] = useState(false)
  const [petPanelOpen, setPetPanelOpen] = useState(false)
  const [props, setProps] = useState({})

  const openSidebar = useCallback(() => setOpen(true), [])
  const closeSidebar = useCallback(() => setOpen(false), [])
  const openPetPanel = useCallback(() => setPetPanelOpen(true), [])
  const closePetPanel = useCallback(() => setPetPanelOpen(false), [])
  const setSidebarProps = useCallback((p) => setProps(p), [])

  const value = useMemo(
    () => ({
      open,
      openSidebar,
      closeSidebar,
      petPanelOpen,
      openPetPanel,
      closePetPanel,
      props,
      setSidebarProps,
    }),
    [
      open,
      openSidebar,
      closeSidebar,
      petPanelOpen,
      openPetPanel,
      closePetPanel,
      props,
      setSidebarProps,
    ]
  )

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

export function useSidebar() {
  return useContext(SidebarContext)
}

/**
 * 页面级 hook：mount 时注入 sidebar props，unmount 时清空。
 * 让 Chat 等页面提供 sessionId / onSelectSession 给抽屉里的 Sidebar 用。
 */
export function useProvideSidebarProps(props) {
  const { setSidebarProps } = useSidebar()
  const key = JSON.stringify({
    sid: props.currentSessionId,
    hasSelect: !!props.onSelectSession,
    hasDel: !!props.onCurrentSessionDeleted,
    hasNew: !!props.onNewSession,
  })
  useEffect(() => {
    setSidebarProps(props)
    return () => setSidebarProps({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setSidebarProps])
}
