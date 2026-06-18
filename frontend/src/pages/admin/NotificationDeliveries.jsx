import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle, CheckCircle2, Clock3, Mail, RefreshCw,
  Search, Send, Smartphone, XCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { adminApi } from '../../services/api'
import { EmptyState, PageHeader, PageLoader } from '../../components/common'

const STATUS_CONFIG = {
  pending: ['En attente', 'Pending', 'bg-gray-100 text-gray-700'],
  processing: ['En cours', 'Processing', 'bg-blue-100 text-blue-700'],
  retry_scheduled: ['Nouvelle tentative planifiee', 'Retry scheduled', 'bg-amber-100 text-amber-700'],
  delivered: ['Livre', 'Delivered', 'bg-green-100 text-green-700'],
  failed: ['Echec', 'Failed', 'bg-red-100 text-red-700'],
  unavailable: ['Indisponible', 'Unavailable', 'bg-orange-100 text-orange-700'],
  not_required: ['Non requis', 'Not required', 'bg-gray-100 text-gray-500'],
}

function StatusPill({ status, isEn }) {
  const config = STATUS_CONFIG[status] || [status, status, 'bg-gray-100 text-gray-700']
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${config[2]}`}>
      {config[isEn ? 1 : 0]}
    </span>
  )
}

function Channel({ icon: Icon, label, channel, isEn }) {
  return (
    <div className="rounded-xl border border-gray-100 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Icon size={15} /> {label}
        </span>
        <StatusPill status={channel.status} isEn={isEn} />
      </div>
      <p className="text-xs text-gray-400 mt-2">
        {isEn ? 'Attempts' : 'Tentatives'}: {channel.attempts}/{channel.max_attempts || 4}
        {channel.sent_count > 0 && ` - ${channel.sent_count} ${isEn ? 'sent' : 'envoyee(s)'}`}
      </p>
      {channel.next_attempt_at && (
        <p className="text-xs text-amber-600 mt-1">
          {isEn ? 'Next attempt' : 'Prochaine tentative'}: {new Date(channel.next_attempt_at).toLocaleString()}
        </p>
      )}
      {channel.last_error && (
        <p className="text-xs text-red-600 mt-1 break-words">{channel.last_error}</p>
      )}
    </div>
  )
}

export default function NotificationDeliveries() {
  const { i18n } = useTranslation()
  const isEn = i18n.language?.startsWith('en')
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState({})
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 })
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState('')
  const [draft, setDraft] = useState({ search: '', status: '', channel: '' })
  const [filters, setFilters] = useState(draft)

  const load = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const params = Object.fromEntries(
        Object.entries({ ...filters, page, limit: 20 }).filter(([, value]) => value !== '')
      )
      const response = await adminApi.notificationDeliveries(params)
      setItems(response.data.data || [])
      setSummary(response.data.summary || {})
      setPagination(response.data.pagination || { page: 1, pages: 1, total: 0 })
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn
        ? 'Unable to load delivery status'
        : 'Impossible de charger les livraisons'))
    } finally {
      setLoading(false)
    }
  }, [filters, isEn])

  useEffect(() => { load(1) }, [load])

  const retry = async (id) => {
    setRetrying(id)
    try {
      const response = await adminApi.retryNotificationDelivery(id)
      const status = response.data.data?.status
      toast.success(status === 'delivered'
        ? (isEn ? 'Notification delivered' : 'Notification livree')
        : (isEn ? 'Retry executed' : 'Nouvelle tentative executee'))
      await load(pagination.page)
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn ? 'Retry failed' : 'Relance impossible'))
    } finally {
      setRetrying('')
    }
  }

  const cards = [
    ['delivered', CheckCircle2, isEn ? 'Delivered' : 'Livrees', 'text-green-600 bg-green-50'],
    ['retry_scheduled', Clock3, isEn ? 'Retry scheduled' : 'A relancer', 'text-amber-600 bg-amber-50'],
    ['pending', Send, isEn ? 'Pending' : 'En attente', 'text-blue-600 bg-blue-50'],
    ['failed', XCircle, isEn ? 'Failed' : 'Echecs', 'text-red-600 bg-red-50'],
  ]

  return (
    <div className="fade-up">
      <PageHeader
        title={isEn ? 'Notification delivery' : 'Livraison des notifications'}
        subtitle={isEn
          ? 'FCM push, email fallback, retries and failure tracking'
          : 'Push FCM, email de secours, nouvelles tentatives et suivi des echecs'}
        action={(
          <button onClick={() => load(pagination.page)} className="btn-outline">
            <RefreshCw size={16} /> {isEn ? 'Refresh' : 'Actualiser'}
          </button>
        )}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {cards.map(([key, Icon, label, color]) => (
          <div key={key} className="card p-4">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color.split(' ')[1]}`}>
              <Icon size={18} className={color.split(' ')[0]} />
            </div>
            <p className="text-2xl font-bold mt-3">{summary[key] || 0}</p>
            <p className="text-xs text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      <form
        onSubmit={(event) => { event.preventDefault(); setFilters(draft) }}
        className="card p-4 mb-5 grid sm:grid-cols-2 lg:grid-cols-[1fr_190px_170px_auto] gap-3"
      >
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9"
            value={draft.search}
            onChange={(event) => setDraft((current) => ({ ...current, search: event.target.value }))}
            placeholder={isEn ? 'Recipient, title or message...' : 'Destinataire, titre ou message...'}
          />
        </div>
        <select
          className="input"
          value={draft.status}
          onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}
        >
          <option value="">{isEn ? 'All statuses' : 'Tous les statuts'}</option>
          <option value="pending">{isEn ? 'Pending' : 'En attente'}</option>
          <option value="retry_scheduled">{isEn ? 'Retry scheduled' : 'A relancer'}</option>
          <option value="delivered">{isEn ? 'Delivered' : 'Livre'}</option>
          <option value="failed">{isEn ? 'Failed' : 'Echec'}</option>
        </select>
        <select
          className="input"
          value={draft.channel}
          onChange={(event) => setDraft((current) => ({ ...current, channel: event.target.value }))}
        >
          <option value="">{isEn ? 'All channels' : 'Tous les canaux'}</option>
          <option value="push">Push FCM</option>
          <option value="email">Email</option>
        </select>
        <button type="submit" className="btn-primary justify-center">
          <Search size={16} /> {isEn ? 'Filter' : 'Filtrer'}
        </button>
      </form>

      {loading ? <PageLoader /> : items.length === 0 ? (
        <EmptyState
          icon={AlertCircle}
          title={isEn ? 'No deliveries' : 'Aucune livraison'}
          description={isEn
            ? 'No notification matches these filters.'
            : 'Aucune notification ne correspond aux filtres.'}
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <article key={item.id} className="card p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold text-gray-900">{item.title}</h2>
                    <StatusPill status={item.delivery.status} isEn={isEn} />
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{item.message}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    {item.user?.name || '-'} - {item.user?.email || '-'} - {new Date(item.created_at).toLocaleString()}
                  </p>
                </div>
                {item.delivery.status !== 'delivered' && (
                  <button
                    onClick={() => retry(item.id)}
                    disabled={retrying === item.id}
                    className="btn-outline justify-center whitespace-nowrap"
                  >
                    <RefreshCw size={15} className={retrying === item.id ? 'animate-spin' : ''} />
                    {isEn ? 'Retry now' : 'Relancer'}
                  </button>
                )}
              </div>
              <div className="grid md:grid-cols-2 gap-3 mt-4">
                <Channel icon={Smartphone} label="Push FCM" channel={item.delivery.push} isEn={isEn} />
                <Channel icon={Mail} label={isEn ? 'Fallback email' : 'Email de secours'} channel={item.delivery.email} isEn={isEn} />
              </div>
            </article>
          ))}
        </div>
      )}

      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            className="btn-outline"
            disabled={pagination.page <= 1}
            onClick={() => load(pagination.page - 1)}
          >
            {isEn ? 'Previous' : 'Precedent'}
          </button>
          <span className="text-sm text-gray-500">{pagination.page} / {pagination.pages}</span>
          <button
            className="btn-outline"
            disabled={pagination.page >= pagination.pages}
            onClick={() => load(pagination.page + 1)}
          >
            {isEn ? 'Next' : 'Suivant'}
          </button>
        </div>
      )}
    </div>
  )
}
