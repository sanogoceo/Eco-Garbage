import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'

import PublicLayout from './components/layout/PublicLayout'
import DashboardLayout from './components/layout/DashboardLayout'

const LoginPage          = lazy(() => import('./pages/auth/LoginPage'))
const RegisterPage       = lazy(() => import('./pages/auth/RegisterPage'))
const VerifyEmailPage    = lazy(() => import('./pages/auth/VerifyEmailPage'))
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage'))
const ResetPasswordPage  = lazy(() => import('./pages/auth/ResetPasswordPage'))

const LandingPage        = lazy(() => import('./pages/LandingPage'))

const UserDashboard      = lazy(() => import('./pages/user/Dashboard'))
const NewRequest         = lazy(() => import('./pages/user/NewRequest'))
const MyRequests         = lazy(() => import('./pages/user/MyRequests'))
const RequestDetail      = lazy(() => import('./pages/user/RequestDetail'))
const ArchivedRequests   = lazy(() => import('./pages/user/ArchivedRequests'))
const Payments           = lazy(() => import('./pages/user/Payments'))
const Complaints         = lazy(() => import('./pages/user/Complaints'))
const Profile            = lazy(() => import('./pages/user/Profile'))
const Notifications      = lazy(() => import('./pages/user/Notifications'))
const BecomeCollector    = lazy(() => import('./pages/user/BecomeCollector'))
const RecurringCollections = lazy(() => import('./pages/user/RecurringCollections'))
const BusinessContracts   = lazy(() => import('./pages/user/BusinessContracts'))

const CollectorDashboard = lazy(() => import('./pages/collector/Dashboard'))
const CollectorTasks     = lazy(() => import('./pages/collector/Tasks'))
const TaskDetail         = lazy(() => import('./pages/collector/TaskDetail'))
const CollectorWallet    = lazy(() => import('./pages/collector/Wallet'))

const AdminDashboard     = lazy(() => import('./pages/admin/Dashboard'))
const AdminUsers         = lazy(() => import('./pages/admin/Users'))
const AdminRequests      = lazy(() => import('./pages/admin/Requests'))
const AdminCategories    = lazy(() => import('./pages/admin/Categories'))
const AdminComplaints    = lazy(() => import('./pages/admin/Complaints'))
const AdminReports       = lazy(() => import('./pages/admin/Reports'))
const CollectorDetail    = lazy(() => import('./pages/admin/CollectorDetail'))
const CollectorApplications = lazy(() => import('./pages/admin/CollectorApplications'))
const AdminWithdrawals   = lazy(() => import('./pages/admin/Withdrawals'))
const AdminAuditLogs     = lazy(() => import('./pages/admin/AuditLogs'))
const AdminNotificationDeliveries = lazy(() => import('./pages/admin/NotificationDeliveries'))
const AdminFraudAlerts   = lazy(() => import('./pages/admin/FraudAlerts'))
const AdminBusinessContracts = lazy(() => import('./pages/admin/BusinessContracts'))
const NotFoundPage           = lazy(() => import('./pages/NotFoundPage'))

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <span className="w-8 h-8 border-4 border-[#1A8A3C] border-t-transparent rounded-full spinner" />
    </div>
  )
}

function PrivateRoute({ children, roles }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center"><span className="w-8 h-8 border-4 border-[#1A8A3C] border-t-transparent rounded-full spinner" /></div>
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) {
    const home = user.role === 'admin' ? '/admin' : user.role === 'collector' ? '/collector' : '/dashboard'
    return <Navigate to={home} replace />
  }
  return children
}

function GuestRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user) {
    if (user.role === 'admin') return <Navigate to="/admin" replace />
    if (user.role === 'collector') return <Navigate to="/collector" replace />
    return <Navigate to="/dashboard" replace />
  }
  return children
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<LandingPage />} />
      </Route>

      <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
      <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<GuestRoute><ForgotPasswordPage /></GuestRoute>} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route path="/dashboard" element={<PrivateRoute roles={['user', 'collector']}><DashboardLayout role="user" /></PrivateRoute>}>
        <Route index element={<UserDashboard />} />
        <Route path="new-request" element={<NewRequest />} />
        <Route path="requests" element={<MyRequests />} />
        <Route path="requests/:uuid" element={<RequestDetail />} />
        <Route path="archived" element={<ArchivedRequests />} />
        <Route path="payments" element={<Payments />} />
        <Route path="complaints" element={<Complaints />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="become-collector" element={<BecomeCollector />} />
        <Route path="recurring" element={<RecurringCollections />} />
        <Route path="business-contracts" element={<BusinessContracts />} />
        <Route path="profile" element={<Profile />} />
      </Route>

      <Route path="/collector" element={<PrivateRoute roles={['collector']}><DashboardLayout role="collector" /></PrivateRoute>}>
        <Route index element={<CollectorDashboard />} />
        <Route path="tasks" element={<CollectorTasks />} />
        <Route path="tasks/:uuid" element={<TaskDetail />} />
        <Route path="wallet" element={<CollectorWallet />} />
        <Route path="complaints" element={<Complaints />} />
        <Route path="archived" element={<ArchivedRequests />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="verification" element={<BecomeCollector />} />
        <Route path="profile" element={<Profile />} />
      </Route>

      <Route path="/admin" element={<PrivateRoute roles={['admin']}><DashboardLayout role="admin" /></PrivateRoute>}>
        <Route index element={<AdminDashboard />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="collector-applications" element={<CollectorApplications />} />
        <Route path="business-contracts" element={<AdminBusinessContracts />} />
        <Route path="collectors/:id" element={<CollectorDetail />} />
        <Route path="requests" element={<AdminRequests />} />
        <Route path="categories" element={<AdminCategories />} />
        <Route path="complaints" element={<AdminComplaints />} />
        <Route path="reports" element={<AdminReports />} />
        <Route path="withdrawals" element={<AdminWithdrawals />} />
        <Route path="audit-logs" element={<AdminAuditLogs />} />
        <Route path="notification-deliveries" element={<AdminNotificationDeliveries />} />
        <Route path="fraud-alerts" element={<AdminFraudAlerts />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="profile" element={<Profile />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </Suspense>
  )
}
