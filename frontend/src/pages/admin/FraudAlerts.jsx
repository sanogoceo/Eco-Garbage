import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, Eye, RefreshCw, Search,
  ShieldAlert, ShieldCheck, Users,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { adminApi } from '../../services/api'
import { EmptyState, PageHeader, PageLoader } from '../../components/common'

const CATEGORY_LABELS = {
  fake_collector: ['Faux collecteur', 'Fake collector'],
  otp_abuse: ['Abus OTP', 'OTP abuse'],
  suspicious_payment: ['Paiement suspect', 'Suspicious payment'],
  suspicious_refund: ['Remboursement suspect', 'Suspicious refund'],
  multiple_accounts: ['Comptes multiples', 'Multiple accounts'],
}

const STATUS_LABELS = {
  open: ['Ouverte', 'Open'],
  investigating: ['En investigation', 'Investigating'],
  resolved: ['Résolue', 'Resolved'],
  dismissed: ['Fausse alerte', 'Dismissed'],
}

const SEVERITY_STYLES = {
  low: 'bg-blue-50 text-blue-700 border-blue-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
}

function Pill({ children, className }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${className}`}>
      {children}
    </span>
  )
}

export default function FraudAlerts() {
  const { i18n } = useTranslation()
  const isEn = i18n.language?.startsWith('en')
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState({})
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [notes, setNotes] = useState({})
  const [draft, setDraft] = useState({
    search: '', category: '', severity: '', status: 'open',
  })
  const [filters, setFilters] = useState(draft)

  const load = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const params = Object.fromEntries(
        Object.entries({ ...filters, page, limit: 20 }).filter(([, value]) => value !== '')
      )
      const response = await adminApi.fraudAlerts(params)
      setItems(response.data.data || [])
      setSummary(response.data.summary || {})
      setPagination(response.data.pagination || { page: 1, pages: 1, total: 0 })
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn
        ? 'Unable to load fraud alerts'
        : 'Impossible de charger les alertes antifraude'))
    } finally {
      setLoading(false)
    }
  }, [filters, isEn])

  useEffect(() => { load(1) }, [load])

  const review = async (alert, status) => {
    const resolutionNotes = String(notes[alert.uuid] || '').trim()
    if (['resolved', 'dismissed'].includes(status) && resolutionNotes.length < 5) {
      toast.error(isEn ? 'Add a short investigation note' : 'Ajoutez une note d investigation')
      return
    }
    setSaving(alert.uuid)
    try {
      await adminApi.reviewFraudAlert(alert.uuid, {
        status,
        notes: resolutionNotes,
      })
      toast.success(isEn ? 'Alert updated' : 'Alerte mise à jour')
      await load(pagination.page)
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn ? 'Update failed' : 'Mise à jour impossible'))
    } finally {
      setSaving('')
    }
  }

  const cards = [
    ['open', ShieldAlert, isEn ? 'Active alerts' : 'Alertes actives', 'text-red-600 bg-red-50'],
    ['critical', AlertTriangle, isEn ? 'Critical' : 'Critiques', 'text-red-700 bg-red-100'],
    ['high', Eye, isEn ? 'High risk' : 'Risque élevé', 'text-orange-600 bg-orange-50'],
    ['resolved', ShieldCheck, isEn ? 'Processed' : 'Traitées', 'text-green-600 bg-green-50'],
  ]

  return (
    <div className="fade-up">
      <PageHeader
        title={isEn ? 'Fraud detection' : 'Détection de fraude'}
        subtitle={isEn
          ? 'Collector identity, OTP, payment, refund and account correlation'
          : 'Identité collecteur, OTP, paiements, remboursements et corrélation des comptes'}
        action={(
          <button className="btn-outline" onClick={() => load(pagination.page)}>
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
        className="card p-4 mb-5 grid sm:grid-cols-2 xl:grid-cols-[1fr_190px_150px_170px_auto] gap-3"
        onSubmit={(event) => { event.preventDefault(); setFilters(draft) }}
      >
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9"
            value={draft.search}
            onChange={(event) => setDraft((current) => ({ ...current, search: event.target.value }))}
            placeholder={isEn ? 'User, title, description...' : 'Utilisateur, titre, description...'}
          />
        </div>
        <select className="input" value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}>
          <option value="">{isEn ? 'All categories' : 'Toutes les catégories'}</option>
          {Object.entries(CATEGORY_LABELS).map(([value, labels]) => (
            <option key={value} value={value}>{labels[isEn ? 1 : 0]}</option>
          ))}
        </select>
        <select className="input" value={draft.severity} onChange={(event) => setDraft((current) => ({ ...current, severity: event.target.value }))}>
          <option value="">{isEn ? 'All risks' : 'Tous les risques'}</option>
          <option value="critical">{isEn ? 'Critical' : 'Critique'}</option>
          <option value="high">{isEn ? 'High' : 'Élevé'}</option>
          <option value="medium">{isEn ? 'Medium' : 'Moyen'}</option>
          <option value="low">{isEn ? 'Low' : 'Faible'}</option>
        </select>
        <select className="input" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>
          <option value="">{isEn ? 'All statuses' : 'Tous les statuts'}</option>
          {Object.entries(STATUS_LABELS).map(([value, labels]) => (
            <option key={value} value={value}>{labels[isEn ? 1 : 0]}</option>
          ))}
        </select>
        <button className="btn-primary justify-center" type="submit">
          <Search size={16} /> {isEn ? 'Filter' : 'Filtrer'}
        </button>
      </form>

      {loading ? <PageLoader /> : items.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={isEn ? 'No fraud alert' : 'Aucune alerte antifraude'}
          description={isEn
            ? 'No signal matches these filters.'
            : 'Aucun signal ne correspond à ces filtres.'}
        />
      ) : (
        <div className="space-y-4">
          {items.map((alert) => (
            <article key={alert.uuid} className="card p-5">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill className={SEVERITY_STYLES[alert.severity]}>
                      {alert.risk_score}/100 · {alert.severity}
                    </Pill>
                    <Pill className="bg-gray-50 text-gray-700 border-gray-200">
                      {CATEGORY_LABELS[alert.category]?.[isEn ? 1 : 0] || alert.category}
                    </Pill>
                    <Pill className="bg-white text-gray-600 border-gray-200">
                      {STATUS_LABELS[alert.status]?.[isEn ? 1 : 0] || alert.status}
                    </Pill>
                  </div>
                  <h2 className="font-bold text-gray-900 mt-3">{alert.title}</h2>
                  <p className="text-sm text-gray-500 mt-1">{alert.description}</p>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400 mt-3">
                    <span className="flex items-center gap-1">
                      <Users size={13} />
                      {alert.subject_user?.name || (isEn ? 'System signal' : 'Signal système')}
                      {alert.subject_user?.email ? ` · ${alert.subject_user.email}` : ''}
                    </span>
                    <span>{isEn ? 'Occurrences' : 'Occurrences'}: {alert.occurrences}</span>
                    <span>{new Date(alert.last_detected_at).toLocaleString()}</span>
                  </div>
                </div>
                <div className="text-sm lg:text-right">
                  {alert.collector_application_uuid && <p>Candidature: {alert.collector_application_uuid}</p>}
                  {alert.pickup_request_uuid && <p>Collecte: {alert.pickup_request_uuid}</p>}
                  {alert.payment_uuid && <p>Paiement: {alert.payment_uuid}</p>}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3 mt-4">
                {(alert.signals || []).map((signal) => (
                  <div key={signal.code} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                    <p className="text-sm font-semibold text-gray-800">{signal.code.replaceAll('_', ' ')}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {isEn ? 'Weight' : 'Poids'}: {signal.weight}
                      {Object.entries(signal.details || {}).map(([key, value]) => (
                        <span key={key}> · {key.replaceAll('_', ' ')}: {String(value)}</span>
                      ))}
                    </p>
                  </div>
                ))}
              </div>

              {['open', 'investigating'].includes(alert.status) && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <textarea
                    className="input min-h-20"
                    value={notes[alert.uuid] || ''}
                    onChange={(event) => setNotes((current) => ({
                      ...current,
                      [alert.uuid]: event.target.value,
                    }))}
                    placeholder={isEn
                      ? 'Investigation notes and decision...'
                      : 'Notes d investigation et justification de la décision...'}
                  />
                  <div className="flex flex-wrap gap-2 mt-3">
                    {alert.status === 'open' && (
                      <button disabled={saving === alert.uuid} onClick={() => review(alert, 'investigating')} className="btn-outline">
                        <Eye size={15} /> {isEn ? 'Investigate' : 'Examiner'}
                      </button>
                    )}
                    <button disabled={saving === alert.uuid} onClick={() => review(alert, 'resolved')} className="btn-primary">
                      <CheckCircle2 size={15} /> {isEn ? 'Confirm fraud handled' : 'Confirmer le traitement'}
                    </button>
                    <button disabled={saving === alert.uuid} onClick={() => review(alert, 'dismissed')} className="btn-outline">
                      <ShieldCheck size={15} /> {isEn ? 'Dismiss' : 'Fausse alerte'}
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {pagination.pages > 1 && (
        <div className="flex justify-center items-center gap-3 mt-6">
          <button className="btn-outline" disabled={pagination.page <= 1} onClick={() => load(pagination.page - 1)}>
            {isEn ? 'Previous' : 'Précédent'}
          </button>
          <span className="text-sm text-gray-500">{pagination.page} / {pagination.pages}</span>
          <button className="btn-outline" disabled={pagination.page >= pagination.pages} onClick={() => load(pagination.page + 1)}>
            {isEn ? 'Next' : 'Suivant'}
          </button>
        </div>
      )}
    </div>
  )
}
