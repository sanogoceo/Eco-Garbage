import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Truck, CheckCircle2, Archive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { collectorApi, requestApi } from '../../services/api'
import { PageHeader, PageLoader, EmptyState, StatusBadge, Pagination } from '../../components/common'
import { format } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import getCategoryIcon from '../../utils/categoryIcons'
import { getServiceTypeLabel } from '../../utils/serviceTypes'

const LIMIT = 10

export default function CollectorTasks() {
  const { t, i18n } = useTranslation()
  const dateLocale = i18n.language?.startsWith('en') ? enUS : fr
  const isEn = i18n.language?.startsWith('en')
  const [view, setView] = useState('tasks')
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [accepting, setAccepting] = useState(false)
  const [archiving, setArchiving] = useState(null)

  const VIEWS = [
    { value: 'tasks',     label: isEn ? 'My tasks'            : 'Mes tâches' },
    { value: 'available', label: isEn ? 'Available requests'  : 'Demandes disponibles' },
  ]

  const FILTERS = [
    { value: '',            label: isEn ? 'All'         : 'Toutes' },
    { value: 'assigned',    label: t('status.assigned') },
    { value: 'on_way',      label: t('status.on_way') },
    { value: 'in_progress', label: t('status.in_progress') },
    { value: 'completed',   label: t('status.completed') },
  ]

  const loadData = (mode = 'tasks', status = '', p = 1) => {
    setLoading(true)
    const params = { limit: LIMIT, page: p }
    if (mode === 'tasks') {
      if (status) params.status = status
      collectorApi.tasks(params)
        .then(r => { setTasks(r.data.data || []); setTotal(r.data.pagination?.total || 0) })
        .finally(() => setLoading(false))
    } else {
      collectorApi.availableRequests(params)
        .then(r => { setTasks(r.data.data || []); setTotal(r.data.pagination?.total || 0) })
        .finally(() => setLoading(false))
    }
  }

  useEffect(() => { setPage(1); loadData(view, view === 'tasks' ? filter : '', 1) }, [view, filter])

  const handleAccept = async (uuid) => {
    setAccepting(true)
    try {
      await requestApi.updateStatus(uuid, { status: 'assigned' })
      toast.success(isEn ? 'Request accepted.' : 'Vous avez accepté cette demande.')
      loadData('available', '', page)
    } catch (err) {
      toast.error(err.response?.data?.message || (isEn ? 'Unable to accept request.' : "Impossible d'accepter la demande."))
    } finally {
      setAccepting(false)
    }
  }

  const handleArchive = async (uuid, e) => {
    e.preventDefault()
    e.stopPropagation()
    setArchiving(uuid)
    try {
      await requestApi.archive(uuid)
      toast.success(isEn ? 'Task archived.' : 'Tâche archivée avec succès')
      loadData(view, filter, page)
    } catch (err) {
      toast.error(err.response?.data?.message || (isEn ? 'Error archiving.' : "Erreur lors de l'archivage"))
    } finally {
      setArchiving(null)
    }
  }

  return (
    <div className="fade-up">
      <PageHeader title={t('collector.tasks.title')} subtitle={`${total} ${isEn ? 'task(s)' : 'tâche(s)'}`} />

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {VIEWS.map(v => (
          <button key={v.value} onClick={() => setView(v.value)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all flex-shrink-0 ${
              view === v.value ? 'bg-[#1A8A3C] text-white' : 'bg-white text-gray-500 border border-gray-200 hover:border-[#1A8A3C]'
            }`}>
            {v.label}
          </button>
        ))}
      </div>

      {view === 'tasks' && (
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {FILTERS.map(f => (
            <button key={f.value} onClick={() => setFilter(f.value)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all flex-shrink-0 ${
                filter === f.value ? 'bg-[#1A8A3C] text-white' : 'bg-white text-gray-500 border border-gray-200 hover:border-[#1A8A3C]'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      {loading ? <PageLoader /> : tasks.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={view === 'tasks' ? t('collector.tasks.noTasks') : (isEn ? 'No available requests' : 'Aucune demande disponible')}
          description={view === 'tasks' ? t('collector.tasks.noTasksDesc') : (isEn ? 'No pending collections at the moment.' : 'Aucune collecte en attente pour le moment.')}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map(tk => (
            view === 'tasks' ? (
              <div key={tk.uuid} className="card p-4 flex items-center gap-4 hover:border-[#1A8A3C]/30 hover:-translate-y-0.5 transition-all">
                <Link to={`/collector/tasks/${tk.uuid}`} className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-12 h-12 bg-[#E8F5EE] rounded-xl flex items-center justify-center text-xl flex-shrink-0">{getCategoryIcon(tk.category_icon)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-800">{tk.category_name}</p>
                      <StatusBadge status={tk.status} />
                    </div>
                    <p className="text-sm text-gray-400 mt-1 truncate">📍 {tk.address}</p>
                    <p className="text-xs text-gray-300 mt-0.5">
                      👤 {tk.user_name}
                      {tk.user_phone && ` · 📞 ${tk.user_phone}`}
                      {' · '}{format(new Date(tk.created_at), 'dd MMM yyyy', { locale: dateLocale })}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {tk.estimated_price && (
                      <p className="text-sm font-bold text-[#1A8A3C]">{parseFloat(tk.estimated_price).toLocaleString()} FCFA</p>
                    )}
                  </div>
                </Link>
                {['completed', 'cancelled', 'failed'].includes(tk.status) && (
                  <button
                    onClick={(e) => handleArchive(tk.uuid, e)}
                    disabled={archiving === tk.uuid}
                    className="btn-outline p-2 ml-2 flex-shrink-0"
                    title={isEn ? 'Archive task' : 'Archiver cette tâche'}>
                    <Archive size={16} />
                  </button>
                )}
              </div>
            ) : (
              <div key={tk.uuid} className="card p-4 flex flex-col gap-4 border-green-200 bg-green-50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-xl flex-shrink-0">{getCategoryIcon(tk.category_icon)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-800">{tk.category_name}</p>
                      <StatusBadge status={tk.status} />
                    </div>
                    <p className="text-sm text-gray-400 mt-1 truncate">📍 {tk.address}</p>
                    <p className="text-xs text-gray-300 mt-0.5">
                      👤 {tk.user_name}
                      {tk.user_phone && ` · 📞 ${tk.user_phone}`}
                      {' · '}{format(new Date(tk.created_at), 'dd MMM yyyy', { locale: dateLocale })}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 justify-between">
                  <div className="text-sm text-gray-700">
                    <p>{isEn ? 'Estimated price:' : 'Prix estimé :'} <span className="font-semibold text-[#1A8A3C]">{tk.estimated_price ? `${parseFloat(tk.estimated_price).toLocaleString()} FCFA` : '—'}</span></p>
                    <p>{isEn ? 'Service:' : 'Service :'} {getServiceTypeLabel(tk.service_type, isEn)}</p>
                    <p>{isEn ? 'Created:' : 'Demande créée :'} {format(new Date(tk.created_at), 'dd MMM yyyy HH:mm', { locale: dateLocale })}</p>
                    {!tk.vehicle_compatible && (
                      <p className="text-red-600 font-semibold mt-1">
                        {isEn
                          ? 'Vehicle not compatible with this pickup'
                          : 'Vehicule non compatible avec cette collecte'}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleAccept(tk.uuid)}
                    disabled={accepting || !tk.vehicle_compatible}
                    className="btn-primary flex items-center gap-2 px-4 py-3 rounded-xl bg-[#1A8A3C] text-white hover:bg-[#16632c] disabled:opacity-60">
                    <CheckCircle2 size={18} />
                    {accepting ? (isEn ? 'Accepting...' : 'Acceptation...') : (isEn ? 'Accept' : 'Accepter')}
                  </button>
                </div>
              </div>
            )
          ))}
        </div>
      )}

      <Pagination page={page} total={total} limit={LIMIT} onChange={p => { setPage(p); loadData(view, view === 'tasks' ? filter : '', p) }} />
    </div>
  )
}
