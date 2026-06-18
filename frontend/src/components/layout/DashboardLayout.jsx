import { useState, useEffect, useMemo, useCallback, memo } from 'react'
import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom'
import {
  Leaf, LayoutDashboard, Plus, ListOrdered, CreditCard,
  MessageSquare, Bell, Settings, LogOut, Truck, Users,
  BarChart3, Tag, ChevronLeft, ChevronRight, Menu, Languages, X, Archive, FileCheck2,
  Building2, CalendarClock, WalletCards, HandCoins, ScrollText, Send, ShieldAlert
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { notifApi } from '../../services/api'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { initializePushNotifications } from '../../services/pushNotifications'
import OfflineStatus from '../common/OfflineStatus'

const NAV = {
  user: [
    { to: '/dashboard', icon: LayoutDashboard, key: 'nav.dashboard', exact: true },
    { to: '/dashboard/new-request', icon: Plus, key: 'nav.newRequest' },
    { to: '/dashboard/requests', icon: ListOrdered, key: 'nav.myRequests' },
    { to: '/dashboard/recurring', icon: CalendarClock, key: 'nav.recurring' },
    { to: '/dashboard/business-contracts', icon: Building2, key: 'nav.businessContracts' },
    { to: '/dashboard/archived', icon: Archive, key: 'nav.archived' },
    { to: '/dashboard/payments', icon: CreditCard, key: 'nav.payments' },
    { to: '/dashboard/complaints', icon: MessageSquare, key: 'nav.complaints' },
    { to: '/dashboard/become-collector', icon: Truck, key: 'nav.becomeCollector' },
    { to: '/dashboard/notifications', icon: Bell, key: 'nav.notifications', badge: true },
    { to: '/dashboard/profile', icon: Settings, key: 'nav.profile' },
  ],
  collector: [
    { to: '/collector', icon: LayoutDashboard, key: 'nav.dashboard', exact: true },
    { to: '/dashboard', icon: ListOrdered, key: 'nav.userSpace' },
    { to: '/collector/tasks', icon: Truck, key: 'nav.tasks' },
    { to: '/collector/wallet', icon: WalletCards, key: 'nav.wallet' },
    { to: '/collector/complaints', icon: MessageSquare, key: 'nav.complaints' },
    { to: '/collector/verification', icon: ShieldAlert, key: 'nav.collectorVerification' },
    { to: '/collector/notifications', icon: Bell, key: 'nav.notifications', badge: true },
    { to: '/collector/profile', icon: Settings, key: 'nav.profile' },
  ],
  admin: [
    { to: '/admin', icon: LayoutDashboard, key: 'nav.dashboard', exact: true },
    { to: '/admin/users', icon: Users, key: 'nav.users' },
    { to: '/admin/collector-applications', icon: FileCheck2, key: 'nav.collectorApplications' },
    { to: '/admin/business-contracts', icon: Building2, key: 'nav.businessContracts' },
    { to: '/admin/requests', icon: ListOrdered, key: 'nav.collections' },
    { to: '/admin/categories', icon: Tag, key: 'nav.categories' },
    { to: '/admin/complaints', icon: MessageSquare, key: 'nav.complaints' },
    { to: '/admin/reports', icon: BarChart3, key: 'nav.reports' },
    { to: '/admin/withdrawals', icon: HandCoins, key: 'nav.withdrawals' },
    { to: '/admin/audit-logs', icon: ScrollText, key: 'nav.auditLogs' },
    { to: '/admin/fraud-alerts', icon: ShieldAlert, key: 'nav.fraudAlerts' },
    { to: '/admin/notification-deliveries', icon: Send, key: 'nav.notificationDeliveries' },
    { to: '/admin/notifications', icon: Bell, key: 'nav.notifications', badge: true },
    { to: '/admin/profile', icon: Settings, key: 'nav.profile' },
  ],
}

const SidebarContent = memo(function SidebarContent({
  mobile, collapsed, navItems, unread, user, initials, role,
  onClose, onToggleCollapsed, onLogout,
}) {
  const { t } = useTranslation()
  return (
    <aside className={
      mobile
        ? 'fixed inset-0 z-50 flex'
        : `fixed top-0 left-0 h-full z-40 flex flex-col transition-all duration-300 ${collapsed ? 'w-[72px]' : 'w-[240px]'}`
    }>
      {mobile && <div className="absolute inset-0 bg-black/40" onClick={onClose} />}
      <div className={`${mobile ? 'relative w-[240px]' : 'w-full'} h-full bg-white border-r border-gray-100 flex flex-col shadow-green-sm`}>

        <div className="h-[70px] flex items-center border-b border-gray-50 px-4 gap-3 flex-shrink-0">
          <div className="w-9 h-9 bg-[#1A8A3C] rounded-xl flex items-center justify-center flex-shrink-0">
            <Leaf size={18} className="text-white" />
          </div>
          {(!collapsed || mobile) && (
            <span className="font-display font-bold text-gray-900 text-lg">
              Eco<span className="text-[#1A8A3C]">Garbage</span>
            </span>
          )}
        </div>


        {(!collapsed || mobile) && (
          <div className="px-4 py-3 border-b border-gray-50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-[#E8F5EE] rounded-full flex items-center justify-center text-[#1A8A3C] font-bold text-sm flex-shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{user?.name}</p>
                <p className="text-xs text-[#1A8A3C] font-medium">{t(`roles.${role}`)}</p>
              </div>
            </div>
          </div>
        )}


        <nav className="flex-1 overflow-y-auto py-4 px-3 flex flex-col gap-1">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              onClick={onClose}
              className={({ isActive }) =>
                `sidebar-link ${isActive ? 'active' : ''} ${collapsed && !mobile ? 'justify-center px-0' : ''}`
              }
            >
              <div className="relative flex-shrink-0">
                <item.icon size={18} />
                {item.badge && unread > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </div>
              {(!collapsed || mobile) && <span>{t(item.key)}</span>}
            </NavLink>
          ))}
        </nav>


        <div className="px-3 pb-4 border-t border-gray-50 pt-3">
          <button
            onClick={onLogout}
            className={`sidebar-link w-full text-red-500 hover:bg-red-50 hover:text-red-600 ${collapsed && !mobile ? 'justify-center px-0' : ''}`}
          >
            <LogOut size={18} className="flex-shrink-0" />
            {(!collapsed || mobile) && <span>{t('nav.logout')}</span>}
          </button>
        </div>


        {!mobile && (
          <button
            onClick={onToggleCollapsed}
            className="absolute -right-3 top-20 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:border-[#1A8A3C] hover:text-[#1A8A3C] transition-all"
          >
            {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
          </button>
        )}
      </div>
    </aside>
  )
})

function LangToggle() {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const current = i18n.language?.startsWith('en') ? 'EN' : 'FR'

  const switchTo = (lng) => {
    i18n.changeLanguage(lng)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 p-2 rounded-xl hover:bg-[#E8F5EE] text-gray-500 hover:text-[#1A8A3C] transition-all text-xs font-bold"
        title="Language / Langue"
      >
        <Languages size={18} />
        <span>{current}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-32 bg-white border border-gray-100 rounded-xl shadow-lg z-50 overflow-hidden">
            {[
              { code: 'fr', label: '🇫🇷 Français' },
              { code: 'en', label: '🇬🇧 English' },
            ].map(({ code, label }) => (
              <button
                key={code}
                onClick={() => switchTo(code)}
                className={`w-full text-left px-4 py-2.5 text-sm font-medium transition-colors
                  ${i18n.language?.startsWith(code)
                    ? 'bg-[#E8F5EE] text-[#1A8A3C]'
                    : 'text-gray-700 hover:bg-gray-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function DashboardLayout({ role }) {
  const { user, logout } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    notifApi.list().then(r => setUnread(r.data.unreadCount || 0)).catch(() => {})
    const interval = setInterval(() => {
      notifApi.list().then(r => setUnread(r.data.unreadCount || 0)).catch(() => {})
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      initializePushNotifications().catch(() => {})
    }, 1500)
    return () => clearTimeout(timer)
  }, [])

  const handleLogout = useCallback(() => {
    logout()
    toast.success(t('nav.logout') + ' 👋')
    navigate('/login')
  }, [logout, navigate, t])

  const handleCloseMobile = useCallback(() => setMobileOpen(false), [])
  const handleToggleCollapsed = useCallback(() => setCollapsed(c => !c), [])

  const navItems = useMemo(() => {
    const items = NAV[role] || []
    if (role !== 'user' || user?.role !== 'collector') return items
    return items.map((item) => (
      item.key === 'nav.becomeCollector'
        ? { to: '/collector', icon: Truck, key: 'nav.collectorSpace' }
        : item
    ))
  }, [role, user?.role])

  const initials = useMemo(
    () => user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U',
    [user?.name]
  )

  const notifPath = role === 'admin'
    ? '/admin/notifications'
    : role === 'collector'
    ? '/collector/notifications'
    : '/dashboard/notifications'

  const sharedProps = { navItems, unread, user, initials, role, onLogout: handleLogout }

  return (
    <div className="min-h-screen bg-[#f7faf8] flex">

      <div className="hidden md:block">
        <SidebarContent
          {...sharedProps}
          mobile={false}
          collapsed={collapsed}
          onClose={handleCloseMobile}
          onToggleCollapsed={handleToggleCollapsed}
        />
      </div>


      {mobileOpen && (
        <SidebarContent
          {...sharedProps}
          mobile
          collapsed={false}
          onClose={handleCloseMobile}
          onToggleCollapsed={handleToggleCollapsed}
        />
      )}


      <main className={`flex-1 min-w-0 transition-all duration-300 ${collapsed ? 'md:ml-[72px]' : 'md:ml-[240px]'}`}>

        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-xl border-b border-gray-100 h-[70px] flex items-center px-6 gap-3">
          <button className="md:hidden p-2 rounded-xl hover:bg-gray-100" onClick={() => setMobileOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="flex-1" />

          <OfflineStatus />


          <LangToggle />


          <NavLink
            to={notifPath}
            className="relative p-2 rounded-xl hover:bg-[#E8F5EE] text-gray-500 hover:text-[#1A8A3C] transition-all"
          >
            <Bell size={20} />
            {unread > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </NavLink>


          <div className="flex items-center gap-2.5 pl-3 border-l border-gray-100">
            <div className="w-8 h-8 bg-[#E8F5EE] rounded-full flex items-center justify-center text-[#1A8A3C] font-bold text-xs">
              {initials}
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-semibold text-gray-800 leading-none">{user?.name?.split(' ')[0]}</p>
              <p className="text-xs text-gray-400 mt-0.5">{t(`roles.${role}`)}</p>
            </div>
          </div>
        </header>

        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
