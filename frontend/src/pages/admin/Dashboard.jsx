import { useState, useEffect } from 'react'
import {
  Users, Truck, CheckCircle, DollarSign, Clock, MessageSquare, ArrowRight,
  BarChart3, AlertTriangle, MapPin, Radio, Timer,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { adminApi } from '../../services/api'
import { StatCard, StatusBadge, PageLoader } from '../../components/common'
import { format } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import getCategoryIcon from '../../utils/categoryIcons'

export default function AdminDashboard() {
  const { t, i18n } = useTranslation()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const dateLocale = i18n.language?.startsWith('en') ? enUS : fr

  const loadDashboard = (silent = false) => {
    if (!silent) setLoading(true)
    adminApi.dashboard()
      .then(r => { setData(r.data.data); setError(false) })
      .catch(() => { if (!silent) setError(true) })
      .finally(() => { if (!silent) setLoading(false) })
  }

  useEffect(() => {
    loadDashboard()
    const id = setInterval(() => loadDashboard(true), 30000)
    return () => clearInterval(id)
  }, [])

  if (loading) return <PageLoader />
  if (error || !data) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <p className="text-gray-500">{t('common.serverError')}</p>
      <button className="btn-primary" onClick={() => loadDashboard()}>
        {t('common.retry')}
      </button>
    </div>
  )

  const {
    stats,
    recentRequests,
    topCollectors,
    statusBreakdown = [],
    activeOperations = [],
    operationalAlerts = [],
  } = data
  const ad = t('admin.dashboard', { returnObjects: true })

  const quickLinks = [
    { to: '/admin/users',      emoji: '👥', label: ad.manageUsers },
    { to: '/admin/requests',   emoji: '📦', label: ad.manageCollections },
    { to: '/admin/categories', emoji: '🏷️', label: ad.wasteCategories },
    { to: '/admin/complaints', emoji: '💬', label: ad.complaints },
    { to: '/admin/reports',    emoji: '📊', label: ad.reportsAnalytics },
  ]

  return (
    <div className="fade-up">
      <div className="mb-8">
        <h1 className="text-2xl font-display font-bold">{ad.title} ⚙️</h1>
        <p className="text-gray-400 text-sm mt-0.5">{ad.subtitle}</p>
      </div>


      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
        <StatCard icon={Users}       label={ad.users}            value={stats.users}         color="green" />
        <StatCard icon={Truck}       label={ad.collectors}       value={stats.collectors}    color="blue" />
        <StatCard icon={CheckCircle} label={ad.totalCollections} value={stats.totalRequests} color="purple" />
        <StatCard icon={DollarSign}  label={ad.totalRevenue}     value={`${stats.revenue.toLocaleString()} FCFA`} color="yellow" />
      </div>


      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
        <StatCard icon={CheckCircle} label={ad.completed}       value={stats.completedRequests} color="green" />
        <StatCard icon={Clock}       label={ad.pending}         value={stats.pendingRequests}   color="yellow" />
        <StatCard icon={DollarSign}  label={ad.collected}       value={`${(stats.paidRevenue || 0).toLocaleString()} FCFA`} color="green" />
        <StatCard icon={Clock}       label={ad.pendingPayment}  value={`${(stats.pendingRevenue || 0).toLocaleString()} FCFA`} color="yellow" />
      </div>


      <div className="grid grid-cols-2 lg:grid-cols-2 gap-4 mb-8">
        <StatCard icon={MessageSquare} label={ad.openComplaints}  value={stats.openComplaints} color="red" />
        <StatCard icon={BarChart3}     label={ad.completionRate}  value={stats.totalRequests > 0 ? `${Math.round((stats.completedRequests / stats.totalRequests) * 100)}%` : '0%'} color="blue" />
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-display font-bold">Supervision opérationnelle</h2>
            <p className="text-sm text-gray-400">État du service et alertes terrain en temps réel</p>
          </div>
          <Link to="/admin/requests" className="text-sm text-[#1A8A3C] font-semibold flex items-center gap-1 hover:underline">
            Gérer les collectes <ArrowRight size={14} />
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
          <StatCard icon={Radio} label="Missions actives" value={stats.activeRequests || 0} color="blue" />
          <StatCard icon={AlertTriangle} label="Collectes en retard" value={stats.delayedRequests || 0} color="red" />
          <StatCard icon={Truck} label="Collecteurs disponibles" value={stats.availableCollectors || 0} color="green" />
          <StatCard
            icon={Timer}
            label="Durée moyenne"
            value={stats.averageCompletionMinutes ? `${stats.averageCompletionMinutes} min` : '—'}
            color="purple"
          />
        </div>

        {operationalAlerts.length > 0 && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            {operationalAlerts.map((alert) => (
              <Link
                key={`${alert.level}-${alert.label}`}
                to={alert.target}
                className={`rounded-2xl border p-4 text-sm font-semibold flex items-start gap-2 transition-transform hover:-translate-y-0.5 ${
                  alert.level === 'critical'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : alert.level === 'warning'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-blue-200 bg-blue-50 text-blue-700'
                }`}
              >
                <AlertTriangle size={17} className="mt-0.5 flex-shrink-0" />
                {alert.label}
              </Link>
            ))}
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 card p-5">
            <h3 className="font-display font-bold mb-4">Collectes à surveiller</h3>
            <div className="flex flex-col gap-2">
              {activeOperations.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">Aucune mission active</p>
              ) : activeOperations.slice(0, 8).map((operation) => (
                <Link
                  key={operation.uuid}
                  to="/admin/requests"
                  className={`flex items-center gap-3 rounded-xl p-3 ${
                    operation.delayed ? 'bg-red-50 border border-red-100' : 'bg-gray-50'
                  }`}
                >
                  <MapPin size={17} className={operation.delayed ? 'text-red-500' : 'text-[#1A8A3C]'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {operation.category_name || 'Collecte'} · {operation.address}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {operation.collector_name || 'Collecteur non attribué'}
                      {operation.eta_minutes ? ` · ETA ${operation.eta_minutes} min` : ''}
                    </p>
                  </div>
                  <StatusBadge status={operation.status} />
                </Link>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="font-display font-bold mb-4">Répartition des statuts</h3>
            <div className="flex flex-col gap-3">
              {statusBreakdown.map((item) => {
                const percentage = stats.totalRequests
                  ? Math.round((item.count / stats.totalRequests) * 100)
                  : 0
                return (
                  <div key={item.status}>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="font-medium capitalize">{t(`status.${item.status}`)}</span>
                      <span className="text-gray-400">{item.count} · {percentage}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#1A8A3C]"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">

        <div className="lg:col-span-2 card p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-display font-bold">{ad.recentRequests}</h2>
            <Link to="/admin/requests" className="text-sm text-[#1A8A3C] font-semibold flex items-center gap-1 hover:underline">
              {t('common.seeAll')} <ArrowRight size={14} />
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {recentRequests.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">{ad.noRequests}</p>
            ) : recentRequests.map(r => (
              <div key={r.uuid} className="flex items-center gap-4 p-3 rounded-xl bg-gray-50 hover:bg-[#E8F5EE] transition-all">
                <div className="w-9 h-9 bg-[#E8F5EE] rounded-xl flex items-center justify-center text-base flex-shrink-0">
                  {getCategoryIcon(r.category_icon)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{r.user_name} · {r.category_name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {format(new Date(r.created_at), 'dd MMM yyyy HH:mm', { locale: dateLocale })}
                  </p>
                </div>
                <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                  <StatusBadge status={r.status} />
                  {r.estimated_price && (
                    <span className="text-xs font-semibold text-[#1A8A3C]">
                      {parseFloat(r.estimated_price).toLocaleString()} FCFA
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>


        <div className="flex flex-col gap-5">
          <div className="card p-6">
            <h3 className="font-display font-bold mb-4">{ad.topCollectors}</h3>
            {topCollectors.length === 0 ? (
              <p className="text-sm text-gray-400">{ad.noCollectors}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {topCollectors.map((c, i) => (
                  <div key={c.name} className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${i === 0 ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-500'}`}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{c.name}</p>
                      <p className="text-xs text-gray-400">{c.total_collections} collectes</p>
                    </div>
                    {c.rating_avg > 0 && (
                      <span className="text-xs font-semibold text-yellow-500">⭐ {parseFloat(c.rating_avg).toFixed(1)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-6">
            <h3 className="font-display font-bold mb-4">{ad.quickNav}</h3>
            <div className="flex flex-col gap-2">
              {quickLinks.map(item => (
                <Link key={item.to} to={item.to}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-[#E8F5EE] hover:text-[#1A8A3C] transition-all">
                  <span>{item.emoji}</span>{item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
