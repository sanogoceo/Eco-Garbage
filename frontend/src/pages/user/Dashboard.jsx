import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Truck, CheckCircle, Clock, Star, Plus, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { requestApi, paymentApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { StatCard, StatusBadge, PageLoader, EmptyState } from '../../components/common'
import { format } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import getCategoryIcon from '../../utils/categoryIcons'

export default function UserDashboard() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const isEn = i18n.language?.startsWith('en')
  const [requests, setRequests] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const dateLocale = isEn ? enUS : fr

  useEffect(() => {
    Promise.allSettled([
      requestApi.list({ limit: 5 }),
      paymentApi.list(),
    ]).then((results) => {
      const [requestsResult, paymentsResult] = results
      if (requestsResult.status === 'fulfilled') {
        setRequests(requestsResult.value.data.data || [])
      } else {
        console.warn('Failed to load user requests', requestsResult.reason)
      }
      if (paymentsResult.status === 'fulfilled') {
        setPayments(paymentsResult.value.data.data || [])
      } else {
        console.warn('Failed to load payment history', paymentsResult.reason)
      }
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <PageLoader />

  const completed = requests.filter(r => r.status === 'completed').length
  const pending = requests.filter(r => ['pending','approved','assigned','on_way','in_progress'].includes(r.status)).length
  const totalPaid = payments.filter(p => p.status === 'completed').reduce((s, p) => s + parseFloat(p.amount || 0), 0)

  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U'
  const hour = new Date().getHours()
  const greeting = hour < 12
    ? t('user.dashboard.greetingMorning')
    : hour < 18
    ? t('user.dashboard.greetingAfternoon')
    : t('user.dashboard.greetingEvening')

  const quickActions = [
    { to: '/dashboard/new-request', icon: '♻️', label: t('user.dashboard.requestPickup') },
    { to: '/dashboard/requests',    icon: '📋', label: t('user.dashboard.myRequests') },
    { to: '/dashboard/archived',    icon: '📦', label: isEn ? 'Archived requests' : 'Demandes archivées' },
    { to: '/dashboard/payments',    icon: '💳', label: t('user.dashboard.paymentHistory') },
    { to: '/dashboard/complaints',  icon: '⚠️', label: t('user.dashboard.submitComplaint') },
  ]

  return (
    <div className="fade-up">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 md:mb-8">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="w-12 md:w-14 h-12 md:h-14 bg-[#E8F5EE] rounded-2xl flex items-center justify-center text-[#1A8A3C] font-bold text-lg md:text-xl font-display">
            {initials}
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-gray-900">
              {greeting}, {user?.name?.split(' ')[0]} 👋
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">{t('user.dashboard.subtitle')}</p>
          </div>
        </div>
        <Link to="/dashboard/new-request" className="btn-primary">
          <Plus size={16} /> {t('user.dashboard.newRequest')}
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <StatCard icon={Truck}       label={t('user.dashboard.totalRequests')} value={requests.length} color="green" />
        <StatCard icon={Clock}       label={t('user.dashboard.inProgress')}    value={pending}         color="yellow" />
        <StatCard icon={CheckCircle} label={t('user.dashboard.completed')}     value={completed}       color="blue" />
        <StatCard icon={Star}        label={t('user.dashboard.amountPaid')}    value={`${totalPaid.toLocaleString()} FCFA`} color="purple" />
      </div>

      <div className="grid md:grid-cols-3 gap-4 md:gap-6">
        <div className="md:col-span-2 card p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-display font-bold">{t('user.dashboard.recentRequests')}</h2>
            <Link to="/dashboard/requests" className="text-sm text-[#1A8A3C] font-semibold hover:underline flex items-center gap-1">
              {t('common.seeAll')} <ArrowRight size={14} />
            </Link>
          </div>
          {requests.length === 0 ? (
            <EmptyState icon={Truck}
              title={t('user.dashboard.noRequests')}
              description={t('user.dashboard.noRequestsDesc')}
              action={<Link to="/dashboard/new-request" className="btn-primary"><Plus size={16} />{t('user.dashboard.newRequest')}</Link>}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {requests.slice(0, 5).map(r => (
                <Link key={r.uuid} to={`/dashboard/requests/${r.uuid}`}
                  className="flex items-center gap-4 p-3 rounded-xl bg-gray-50 hover:bg-[#E8F5EE] transition-all group">
                  <div className="w-10 h-10 bg-[#E8F5EE] rounded-xl flex items-center justify-center flex-shrink-0 text-lg group-hover:bg-white">
                    {getCategoryIcon(r.category_icon)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{r.category_name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {r.address?.substring(0, 30)}{r.address?.length > 30 ? '...' : ''} ·{' '}
                      {format(new Date(r.created_at), 'dd MMM yyyy', { locale: dateLocale })}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <div className="card p-6">
            <h2 className="text-lg font-display font-bold mb-4">{t('user.dashboard.quickActions')}</h2>
            <div className="flex flex-col gap-2.5">
              {quickActions.map(a => (
                <Link key={a.to} to={a.to}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:border-[#1A8A3C] hover:text-[#1A8A3C] hover:bg-[#E8F5EE] transition-all">
                  <span className="text-lg flex-shrink-0">{a.icon}</span>
                  <span className="truncate">{a.label}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="bg-[#1A8A3C] rounded-2xl p-5 text-white">
            <div className="text-xs font-bold uppercase tracking-widest text-white/60 mb-1">{t('user.dashboard.currentPlan')}</div>
            <div className="text-2xl font-display font-bold mb-1">{t('user.dashboard.standard')}</div>
            <div className="text-sm text-white/60 mb-4">4 500 FCFA / mois</div>
            <div className="flex justify-between text-xs text-white/70 mb-2">
              <span>{t('user.dashboard.collectionsUsed')}</span><span>6 / 10</span>
            </div>
            <div className="bg-white/20 rounded-full h-2 mb-4">
              <div className="bg-white h-2 w-3/5 rounded-full" />
            </div>
            <button className="w-full bg-white/15 hover:bg-white/25 transition-all py-2 rounded-xl text-sm font-semibold">
              {t('user.dashboard.upgradePremium')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
