import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Truck, CheckCircle, Star, ToggleLeft, ToggleRight, ArrowRight, MapPin } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { collectorApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { StatCard, StatusBadge, PageLoader, EmptyState } from '../../components/common'
import { format } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import getCategoryIcon from '../../utils/categoryIcons'

export default function CollectorDashboard() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const dateLocale = i18n.language?.startsWith('en') ? enUS : fr
  const [stats, setStats] = useState(null)
  const [tasks, setTasks] = useState([])
  const [available, setAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const locationIntervalRef = useRef(null)
  const isMountedRef = useRef(true)

  const getCurrentPosition = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error('Geolocation non disponible'))
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    })
  })

  const sendLocation = async () => {
    try {
      const pos = await getCurrentPosition()
      await collectorApi.updateLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
    } catch (error) {
      console.warn('GPS update failed:', error)
    }
  }

  const startLocationTracking = () => {
    sendLocation()
    locationIntervalRef.current = setInterval(sendLocation, 60000)
  }
  const stopLocationTracking = () => {
    if (locationIntervalRef.current) {
      clearInterval(locationIntervalRef.current)
      locationIntervalRef.current = null
    }
  }

  useEffect(() => {
    isMountedRef.current = true
    Promise.allSettled([collectorApi.stats(), collectorApi.tasks({ limit: 5 })])
      .then((results) => {
        if (!isMountedRef.current) return
        const [statsResult, tasksResult] = results
        if (statsResult.status === 'fulfilled') {
          setStats(statsResult.value.data.data)
          const isAvail = statsResult.value.data.data?.profile?.is_available || false
          setAvailable(isAvail)
          if (isAvail) startLocationTracking()
        } else {
          console.warn('Failed to load collector stats', statsResult.reason)
        }
        if (tasksResult.status === 'fulfilled') {
          setTasks(tasksResult.value.data.data || [])
        } else {
          console.warn('Failed to load collector tasks', tasksResult.reason)
        }
      })
      .finally(() => {
        if (isMountedRef.current) setLoading(false)
      })

    return () => {
      isMountedRef.current = false
      stopLocationTracking()
    }
  }, [])

  const toggleAvailability = async () => {
    setToggling(true)
    try {
      const newState = !available
      if (newState && navigator.geolocation) {
        try {
          const pos = await getCurrentPosition()
          await collectorApi.updateLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
        } catch (error) {
          console.warn('Collecteur GPS error:', error)
          if (error.code === 1) {
            toast.error('Autorisation localisation refusée. Vérifiez les permissions du navigateur.')
          } else if (error.code === 3) {
            toast.error('La localisation a dépassé le délai. Réessayez.')
          } else {
            toast.error('Impossible de récupérer votre position, activation en cours.')
          }
        }
      }

      const response = await collectorApi.setAvailability({ is_available: newState })
      setAvailable(newState)
      if (newState) {
        startLocationTracking()
        toast.success(response.data?.message || (t('collector.dashboard.available') + ' 📍'))
      } else {
        stopLocationTracking()
        toast.success(response.data?.message || t('collector.dashboard.unavailable'))
      }
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message || t('common.serverError')
      toast.error(errorMsg)
    } finally {
      setToggling(false)
    }
  }

  if (loading) return <PageLoader />

  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'C'
  const hour = new Date().getHours()
  const greeting = hour < 12
    ? t('user.dashboard.greetingMorning')
    : hour < 18 ? t('user.dashboard.greetingAfternoon') : t('user.dashboard.greetingEvening')

  return (
    <div className="fade-up">

      <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-[#E8F5EE] rounded-2xl flex items-center justify-center text-[#1A8A3C] font-bold text-xl font-display">
            {initials}
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold">{greeting}, {user?.name?.split(' ')[0]} 👋</h1>
            <p className="text-sm text-gray-400 mt-0.5">{t('collector.dashboard.subtitle')}</p>
          </div>
        </div>
        <button onClick={toggleAvailability} disabled={toggling}
          className={`flex items-center gap-3 px-5 py-3 rounded-xl font-semibold text-sm transition-all border-2 ${
            available
              ? 'bg-[#E8F5EE] border-[#1A8A3C] text-[#1A8A3C]'
              : 'bg-gray-50 border-gray-200 text-gray-500'
          }`}>
          {available ? <ToggleRight size={20} className="text-[#1A8A3C]" /> : <ToggleLeft size={20} />}
          {available ? t('collector.dashboard.available') : t('collector.dashboard.unavailable')}
        </button>
      </div>


      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <StatCard icon={Truck}       label={t('collector.dashboard.totalCollections')} value={stats?.completed ?? 0} color="green" />
        <StatCard icon={CheckCircle} label={t('common.active')}                        value={tasks.filter(tk => tk.status === 'completed').length} color="blue" />
        <StatCard icon={Star}        label={t('collector.dashboard.rating')}            value={stats?.profile?.rating_avg ? parseFloat(stats.profile.rating_avg).toFixed(1) : '—'} color="yellow" />
        <StatCard icon={Truck}       label={t('collector.dashboard.earnings')}          value={`${(stats?.earnings || 0).toLocaleString()} FCFA`} color="purple" />
      </div>


      <div className={`rounded-2xl p-4 mb-6 flex items-center gap-3 ${
        available
          ? 'bg-[#E8F5EE] border border-[#C8EDDA]'
          : 'bg-gray-100 border border-gray-200'
      }`}>
        <div className={`w-3 h-3 rounded-full ${available ? 'bg-[#1A8A3C] animate-pulse' : 'bg-gray-400'}`} />
        <div className="flex-1">
          <p className={`text-sm font-semibold ${available ? 'text-[#1A8A3C]' : 'text-gray-500'}`}>
            {available ? t('collector.dashboard.available') : t('collector.dashboard.unavailable')}
          </p>
          {available && (
            <p className="text-xs text-[#1A8A3C]/60 mt-0.5 flex items-center gap-1">
              <MapPin size={10} /> GPS
            </p>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">

        <div className="lg:col-span-2 card p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-display font-bold">{t('collector.dashboard.myTasks')}</h2>
            <Link to="/collector/tasks" className="text-sm text-[#1A8A3C] font-semibold flex items-center gap-1 hover:underline">
              {t('common.seeAll')} <ArrowRight size={14} />
            </Link>
          </div>
          {tasks.length === 0 ? (
            <EmptyState icon={Truck} title={t('collector.tasks.noTasks')} description={t('collector.tasks.noTasksDesc')} />
          ) : (
            <div className="flex flex-col gap-3">
              {tasks.slice(0, 5).map(tk => (
                <Link key={tk.uuid} to={`/collector/tasks/${tk.uuid}`}
                  className="flex items-center gap-4 p-3 rounded-xl bg-gray-50 hover:bg-[#E8F5EE] transition-all group">
                  <div className="w-10 h-10 bg-[#E8F5EE] rounded-xl flex items-center justify-center text-lg flex-shrink-0 group-hover:bg-white">
                    {getCategoryIcon(tk.category_icon)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{tk.category_name}</p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{tk.address}</p>
                    <p className="text-xs text-gray-300 mt-0.5">
                      {tk.user_name} · {format(new Date(tk.created_at), 'dd MMM', { locale: dateLocale })}
                    </p>
                  </div>
                  <StatusBadge status={tk.status} />
                </Link>
              ))}
            </div>
          )}
        </div>


        <div className="flex flex-col gap-5">
          <div className="card p-6">
            <h3 className="font-display font-bold mb-4">Actions rapides</h3>
            <div className="flex flex-col gap-2.5">
              {[
                { to: '/collector/tasks', icon: '📋', label: 'Mes tâches' },
                { to: '/collector/archived', icon: '📦', label: 'Tâches archivées' },
              ].map(a => (
                <Link key={a.to} to={a.to}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:border-[#1A8A3C] hover:text-[#1A8A3C] hover:bg-[#E8F5EE] transition-all">
                  <span className="text-lg">{a.icon}</span>{a.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="card p-6">
            <h3 className="font-display font-bold mb-4">Performance</h3>
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-gray-500">Taux de complétion</span>
                  <span className="font-semibold text-[#1A8A3C]">92%</span>
                </div>
                <div className="bg-gray-100 rounded-full h-2">
                  <div className="bg-[#1A8A3C] h-2 rounded-full" style={{ width: '92%' }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-gray-500">Satisfaction</span>
                  <span className="font-semibold text-yellow-500">
                    {stats?.profile?.rating_avg ? `${parseFloat(stats.profile.rating_avg).toFixed(1)}/5` : '—'}
                  </span>
                </div>
                <div className="bg-gray-100 rounded-full h-2">
                  <div className="bg-yellow-400 h-2 rounded-full" style={{ width: `${((stats?.profile?.rating_avg || 0) / 5) * 100}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#1A8A3C] rounded-2xl p-5 text-white">
            <p className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-2">{t('collector.dashboard.earnings')}</p>
            <p className="text-3xl font-display font-bold">{(stats?.earnings || 0).toLocaleString()}</p>
            <p className="text-white/60 text-sm mt-0.5">FCFA</p>
            <div className="mt-4 pt-4 border-t border-white/20">
              <p className="text-sm text-white/70">{stats?.completed || 0} {t('status.completed').toLowerCase()}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
