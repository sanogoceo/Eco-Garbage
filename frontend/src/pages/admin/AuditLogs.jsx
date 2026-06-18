import { useCallback, useEffect, useState } from 'react'
import {
  Award, CheckCircle2, ChevronLeft, ChevronRight, Eye, FileSearch,
  ReceiptText, RefreshCw, Search, Settings2, ShieldX, Trash2, UserRound,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { adminApi } from '../../services/api'
import { EmptyState, PageHeader, PageLoader } from '../../components/common'

const ACTION_CONFIG = {
  'collector_application.approved': {
    icon: CheckCircle2, color: 'bg-green-100 text-green-700',
    fr: 'Candidature approuvee', en: 'Application approved',
  },
  'collector_application.rejected': {
    icon: ShieldX, color: 'bg-red-100 text-red-700',
    fr: 'Candidature refusee', en: 'Application rejected',
  },
  'collector_application.document_viewed': {
    icon: Eye, color: 'bg-blue-100 text-blue-700',
    fr: 'Document CNI consulte', en: 'Identity document viewed',
  },
  'collector_application.document_replacement_requested': {
    icon: RefreshCw, color: 'bg-amber-100 text-amber-700',
    fr: 'Remplacement de document demande', en: 'Document replacement requested',
  },
  'collector_application.document_replacement_completed': {
    icon: CheckCircle2, color: 'bg-cyan-100 text-cyan-700',
    fr: 'Documents remplaces', en: 'Documents replaced',
  },
  'payment.refund_requested': {
    icon: ReceiptText, color: 'bg-amber-100 text-amber-700',
    fr: 'Remboursement demande', en: 'Refund requested',
  },
  'pickup_request.proof_viewed': {
    icon: FileSearch, color: 'bg-purple-100 text-purple-700',
    fr: 'Preuve de collecte consultee', en: 'Pickup proof viewed',
  },
  'complaint.evidence_viewed': {
    icon: Eye, color: 'bg-cyan-100 text-cyan-700',
    fr: 'Preuve de litige consultee', en: 'Dispute evidence viewed',
  },
  'complaint.decision_recorded': {
    icon: CheckCircle2, color: 'bg-emerald-100 text-emerald-700',
    fr: 'Decision de litige enregistree', en: 'Dispute decision recorded',
  },
  'notification.delivery_retried': {
    icon: RefreshCw, color: 'bg-orange-100 text-orange-700',
    fr: 'Livraison de notification relancee', en: 'Notification delivery retried',
  },
  'admin_security.unusual_login': {
    icon: ShieldX, color: 'bg-red-100 text-red-700',
    fr: 'Connexion administrateur inhabituelle', en: 'Unusual administrator login',
  },
  'admin_security.two_factor_enabled': {
    icon: CheckCircle2, color: 'bg-green-100 text-green-700',
    fr: 'Double authentification activee', en: 'Two-factor authentication enabled',
  },
  'admin_security.two_factor_disabled': {
    icon: ShieldX, color: 'bg-amber-100 text-amber-700',
    fr: 'Double authentification desactivee', en: 'Two-factor authentication disabled',
  },
  'admin_security.session_revoked': {
    icon: UserRound, color: 'bg-blue-100 text-blue-700',
    fr: 'Session administrateur revoquee', en: 'Administrator session revoked',
  },
  'admin_security.step_up_granted': {
    icon: CheckCircle2, color: 'bg-purple-100 text-purple-700',
    fr: 'Confirmation renforcee accordee', en: 'Step-up confirmation granted',
  },
  'admin_security.user_status_changed': {
    icon: UserRound, color: 'bg-orange-100 text-orange-700',
    fr: 'Statut utilisateur modifie', en: 'User status changed',
  },
  'service_configuration.updated': {
    icon: Settings2, color: 'bg-indigo-100 text-indigo-700',
    fr: 'Configuration de service modifiee', en: 'Service configuration updated',
  },
  'collector.hazardous_certification_updated': {
    icon: Award, color: 'bg-yellow-100 text-yellow-700',
    fr: 'Certification dangereuse modifiee', en: 'Hazardous certification updated',
  },
  'sensitive_data.retention_deleted': {
    icon: Trash2, color: 'bg-gray-100 text-gray-700',
    fr: 'Donnees sensibles supprimees', en: 'Sensitive data deleted',
  },
}

const ACTIONS = Object.keys(ACTION_CONFIG)
const DOCUMENT_LABELS = {
  profile_photo: 'Photo d identite',
  id_front: 'CNI recto',
  id_back: 'CNI verso',
  selfie_with_id: 'Selfie avec CNI',
  vehicle_photo: 'Photo du transport',
}
const initialFilters = { action: '', actor_type: '', search: '', from: '', to: '' }

function AuditDetails({ log, isEn }) {
  const details = []
  if (log.metadata?.document_type) {
    details.push(['Document', DOCUMENT_LABELS[log.metadata.document_type] || log.metadata.document_type])
  }
  if (log.metadata?.document_types?.length) {
    details.push([
      isEn ? 'Documents' : 'Documents',
      log.metadata.document_types.map((type) => DOCUMENT_LABELS[type] || type).join(', '),
    ])
  }
  if (log.metadata?.amount !== undefined) {
    details.push([isEn ? 'Amount' : 'Montant', `${Number(log.metadata.amount).toLocaleString()} FCFA`])
  }
  if (log.metadata?.payment_uuid) details.push(['Paiement', log.metadata.payment_uuid])
  if (log.metadata?.refund_uuid) details.push(['Remboursement', log.metadata.refund_uuid])
  if (log.metadata?.complaint_uuid) details.push(['Litige', log.metadata.complaint_uuid])
  if (log.metadata?.outcome) details.push([isEn ? 'Outcome' : 'Decision', log.metadata.outcome])
  if (log.metadata?.compensation_amount !== undefined) {
    details.push([
      isEn ? 'Compensation' : 'Compensation',
      `${Number(log.metadata.compensation_amount).toLocaleString()} FCFA`,
    ])
  }
  if (log.metadata?.previous_status) {
    details.push([isEn ? 'Previous status' : 'Statut precedent', log.metadata.previous_status])
  }
  if (log.metadata?.proof_type) {
    details.push([
      isEn ? 'Proof' : 'Preuve',
      log.metadata.proof_type === 'before'
        ? (isEn ? 'Before pickup' : 'Avant collecte')
        : (isEn ? 'After pickup' : 'Apres collecte'),
    ])
  }
  if (log.metadata?.notes) details.push([isEn ? 'Decision note' : 'Note de decision', log.metadata.notes])
  if (log.metadata?.deleted_document_types?.length) {
    details.push([
      isEn ? 'Deleted documents' : 'Documents supprimes',
      log.metadata.deleted_document_types.map((type) => DOCUMENT_LABELS[type] || type).join(', '),
    ])
  }
  if (log.metadata?.deleted_proof_count !== undefined) {
    details.push([isEn ? 'Deleted proofs' : 'Preuves supprimees', log.metadata.deleted_proof_count])
  }
  if (log.metadata?.deleted_evidence_count !== undefined) {
    details.push([
      isEn ? 'Deleted dispute evidence' : 'Preuves de litige supprimees',
      log.metadata.deleted_evidence_count,
    ])
  }
  if (log.metadata?.service_type) {
    details.push([isEn ? 'Service type' : 'Type de service', log.metadata.service_type])
  }
  if (log.metadata?.price_multiplier !== undefined) {
    details.push([isEn ? 'Price multiplier' : 'Multiplicateur', `x${log.metadata.price_multiplier}`])
  }
  if (log.metadata?.fixed_fee !== undefined) {
    details.push([
      isEn ? 'Fixed fee' : 'Frais fixes',
      `${Number(log.metadata.fixed_fee).toLocaleString()} FCFA`,
    ])
  }
  if (log.metadata?.max_requests_per_slot !== undefined) {
    details.push([
      isEn ? 'Slot capacity' : 'Capacite du creneau',
      log.metadata.max_requests_per_slot,
    ])
  }
  if (log.metadata?.status) {
    details.push([isEn ? 'Certification status' : 'Statut de certification', log.metadata.status])
  }
  if (log.metadata?.expires_at) {
    details.push([
      isEn ? 'Valid until' : 'Valide jusqu au',
      new Date(log.metadata.expires_at).toLocaleDateString(isEn ? 'en-US' : 'fr-FR'),
    ])
  }

  return (
    <details className="mt-3 rounded-xl bg-gray-50 border border-gray-100">
      <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-[#1A8A3C]">
        {isEn ? 'Technical details' : 'Details techniques'}
      </summary>
      <div className="px-4 pb-4 grid sm:grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-gray-400">{isEn ? 'Target' : 'Cible'}</p>
          <p className="font-medium break-all">{log.target_type} / {log.target_id}</p>
        </div>
        <div>
          <p className="text-gray-400">IP</p>
          <p className="font-medium">{log.ip || '-'}</p>
        </div>
        {details.map(([label, value]) => (
          <div key={label} className={label.includes('Note') ? 'sm:col-span-2' : ''}>
            <p className="text-gray-400">{label}</p>
            <p className="font-medium break-words">{value || '-'}</p>
          </div>
        ))}
      </div>
    </details>
  )
}

export default function AuditLogs() {
  const { i18n } = useTranslation()
  const isEn = i18n.language?.startsWith('en')
  const [draft, setDraft] = useState(initialFilters)
  const [filters, setFilters] = useState(initialFilters)
  const [logs, setLogs] = useState([])
  const [summary, setSummary] = useState({})
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, pages: 1 })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const params = Object.fromEntries(
        Object.entries({ ...filters, page, limit: 20 }).filter(([, value]) => value !== '')
      )
      const response = await adminApi.auditLogs(params)
      setLogs(response.data.data || [])
      setSummary(response.data.summary || {})
      setPagination(response.data.pagination || { total: 0, page: 1, limit: 20, pages: 1 })
    } catch (error) {
      toast.error(error.response?.data?.message
        || (isEn ? 'Unable to load the audit log' : 'Impossible de charger le journal d audit'))
    } finally {
      setLoading(false)
    }
  }, [filters, isEn])

  useEffect(() => { load(1) }, [load])

  const resetFilters = () => {
    setDraft(initialFilters)
    setFilters(initialFilters)
  }
  const summaryCards = [
    'collector_application.approved',
    'collector_application.rejected',
    'payment.refund_requested',
    'collector_application.document_viewed',
  ]

  return (
    <div className="fade-up">
      <PageHeader
        title={isEn ? 'Administrator audit log' : 'Journal d audit administrateur'}
        subtitle={isEn
          ? 'Trace decisions and access to sensitive information'
          : 'Tracez les decisions et les acces aux informations sensibles'}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {summaryCards.map((action) => {
          const config = ACTION_CONFIG[action]
          const Icon = config.icon
          return (
            <div key={action} className="card p-4">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${config.color}`}>
                <Icon size={18} />
              </div>
              <p className="text-2xl font-display font-bold mt-3">{summary[action] || 0}</p>
              <p className="text-xs text-gray-500 mt-1">{config[isEn ? 'en' : 'fr']}</p>
            </div>
          )
        })}
      </div>

      <form
        onSubmit={(event) => { event.preventDefault(); setFilters(draft) }}
        className="card p-4 mb-6"
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-9"
              value={draft.search}
              placeholder={isEn ? 'Administrator, email or payment...' : 'Administrateur, email ou paiement...'}
              onChange={(event) => setDraft((current) => ({ ...current, search: event.target.value }))}
            />
          </div>
          <select
            className="input"
            value={draft.action}
            onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))}
          >
            <option value="">{isEn ? 'All actions' : 'Toutes les actions'}</option>
            {ACTIONS.map((action) => (
              <option key={action} value={action}>{ACTION_CONFIG[action][isEn ? 'en' : 'fr']}</option>
            ))}
          </select>
          <input
            type="date"
            className="input"
            title={isEn ? 'Start date' : 'Date de debut'}
            value={draft.from}
            onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
          />
          <input
            type="date"
            className="input"
            title={isEn ? 'End date' : 'Date de fin'}
            value={draft.to}
            onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
          />
        </div>
        <div className="flex flex-wrap justify-between gap-3 mt-3">
          <select
            className="input max-w-56"
            value={draft.actor_type}
            onChange={(event) => setDraft((current) => ({ ...current, actor_type: event.target.value }))}
          >
            <option value="">{isEn ? 'All actors' : 'Tous les acteurs'}</option>
            <option value="user">{isEn ? 'Administrators' : 'Administrateurs'}</option>
            <option value="system">{isEn ? 'Automated system' : 'Systeme automatique'}</option>
          </select>
          <div className="flex gap-2">
            <button type="button" onClick={resetFilters} className="btn-outline">
              <RefreshCw size={16} /> {isEn ? 'Reset' : 'Reinitialiser'}
            </button>
            <button type="submit" className="btn-primary">
              <Search size={16} /> {isEn ? 'Filter' : 'Filtrer'}
            </button>
          </div>
        </div>
      </form>

      {loading ? <PageLoader /> : logs.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title={isEn ? 'No audit events' : 'Aucun evenement d audit'}
          description={isEn
            ? 'No event matches the selected filters.'
            : 'Aucun evenement ne correspond aux filtres selectionnes.'}
        />
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const config = ACTION_CONFIG[log.action] || {
              icon: FileSearch,
              color: 'bg-gray-100 text-gray-700',
              fr: log.action,
              en: log.action,
            }
            const Icon = config.icon
            return (
              <article key={log.id} className="card p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${config.color}`}>
                    <Icon size={19} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                      <h2 className="font-display font-bold text-gray-900">{config[isEn ? 'en' : 'fr']}</h2>
                      <time className="text-xs text-gray-400 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString(isEn ? 'en-US' : 'fr-FR')}
                      </time>
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-sm text-gray-600">
                      <UserRound size={15} className="text-gray-400" />
                      {log.actor ? (
                        <span>
                          <strong>{log.actor.name}</strong>
                          <span className="text-gray-400"> - {log.actor.email}</span>
                        </span>
                      ) : (
                        <strong>{isEn ? 'Automated system' : 'Systeme automatique'}</strong>
                      )}
                    </div>
                    <AuditDetails log={log} isEn={isEn} />
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {!loading && pagination.total > 0 && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-sm text-gray-400">{pagination.total} {isEn ? 'events' : 'evenements'}</p>
          <div className="flex items-center gap-2">
            <button
              className="btn-outline p-2"
              disabled={pagination.page <= 1}
              onClick={() => load(pagination.page - 1)}
              aria-label={isEn ? 'Previous page' : 'Page precedente'}
            >
              <ChevronLeft size={17} />
            </button>
            <span className="text-sm font-semibold px-2">{pagination.page} / {pagination.pages}</span>
            <button
              className="btn-outline p-2"
              disabled={pagination.page >= pagination.pages}
              onClick={() => load(pagination.page + 1)}
              aria-label={isEn ? 'Next page' : 'Page suivante'}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
