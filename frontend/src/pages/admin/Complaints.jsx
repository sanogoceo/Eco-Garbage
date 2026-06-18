import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2, Clock3, Gavel, Image, MapPin,
  MessageSquare, Search, Send, ShieldAlert, UserRound,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { enUS, fr } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'
import { adminApi, complaintApi } from '../../services/api'
import {
  EmptyState, Modal, PageHeader, PageLoader, StatusBadge,
} from '../../components/common'
import AuthenticatedComplaintImage from '../../components/common/AuthenticatedComplaintImage'

const TYPE_LABELS = {
  missed_pickup: ['Collecte manquee', 'Missed pickup'],
  incorrect_pricing: ['Tarif incorrect', 'Incorrect pricing'],
  collector_misconduct: ['Comportement collecteur', 'Collector misconduct'],
  service_quality: ['Qualite du service', 'Service quality'],
  damaged_property: ['Bien endommage', 'Damaged property'],
  payment_issue: ['Probleme de paiement', 'Payment issue'],
  other: ['Autre', 'Other'],
}

const OUTCOMES = [
  ['upheld', 'Reclamation acceptee', 'Complaint upheld'],
  ['rejected', 'Reclamation rejetee', 'Complaint rejected'],
  ['partial', 'Partiellement acceptee', 'Partially upheld'],
  ['refund', 'Remboursement recommande', 'Refund recommended'],
  ['warning', 'Avertissement emis', 'Warning issued'],
  ['no_action', 'Aucune action', 'No action'],
]

export default function AdminComplaints() {
  const { i18n } = useTranslation()
  const isEn = i18n.language?.startsWith('en')
  const dateLocale = isEn ? enUS : fr
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [message, setMessage] = useState('')
  const [reviewStatus, setReviewStatus] = useState('in_review')
  const [decision, setDecision] = useState({
    status: 'resolved',
    outcome: 'upheld',
    summary: '',
    compensation_amount: 0,
  })
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const response = await adminApi.complaints(statusFilter ? { status: statusFilter } : undefined)
      setComplaints(response.data.data || [])
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn ? 'Unable to load disputes' : 'Impossible de charger les litiges'))
    } finally {
      setLoading(false)
    }
  }, [isEn, statusFilter])

  useEffect(() => { loadData() }, [loadData])

  const openComplaint = async (complaint) => {
    try {
      const [detailResponse, messageResponse] = await Promise.all([
        complaintApi.get(complaint.uuid),
        complaintApi.messages(complaint.uuid),
      ])
      const detail = detailResponse.data.data
      setSelected(detail)
      setMessages(messageResponse.data.data || [])
      setReviewStatus(['in_review', 'awaiting_user', 'awaiting_collector'].includes(detail.status)
        ? detail.status
        : 'in_review')
      setDecision({
        status: detail.status === 'closed' ? 'closed' : 'resolved',
        outcome: detail.decision?.outcome || 'upheld',
        summary: detail.decision?.summary || '',
        compensation_amount: detail.decision?.compensation_amount || 0,
      })
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn ? 'Unable to open case' : 'Impossible d ouvrir le dossier'))
    }
  }

  const refreshSelected = async () => {
    if (!selected) return
    await openComplaint(selected)
    await loadData()
  }

  const updateReview = async () => {
    setSaving(true)
    try {
      await adminApi.reviewComplaint(selected.uuid, { status: reviewStatus })
      toast.success(isEn ? 'Review status updated' : 'Statut d instruction mis a jour')
      await refreshSelected()
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn ? 'Update failed' : 'Mise a jour impossible'))
    } finally {
      setSaving(false)
    }
  }

  const recordDecision = async () => {
    if (decision.summary.trim().length < 10) {
      return toast.error(isEn ? 'Decision justification is required' : 'Une justification detaillee est obligatoire')
    }
    setSaving(true)
    try {
      await adminApi.decideComplaint(selected.uuid, {
        ...decision,
        summary: decision.summary.trim(),
        compensation_amount: Number(decision.compensation_amount || 0),
      })
      toast.success(isEn ? 'Decision recorded' : 'Decision administrative enregistree')
      await refreshSelected()
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn ? 'Decision failed' : 'Decision non enregistree'))
    } finally {
      setSaving(false)
    }
  }

  const sendMessage = async () => {
    const body = message.trim()
    if (!body) return
    setSaving(true)
    try {
      await complaintApi.sendMessage(selected.uuid, body)
      setMessage('')
      await refreshSelected()
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn ? 'Message not sent' : 'Message non envoye'))
    } finally {
      setSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return complaints
    return complaints.filter((complaint) => [
      complaint.uuid,
      complaint.request?.uuid,
      complaint.complainant?.name,
      complaint.complainant?.email,
      complaint.description,
    ].some((value) => String(value || '').toLowerCase().includes(query)))
  }, [complaints, search])

  const stats = useMemo(() => ({
    urgent: complaints.filter((item) => item.status === 'open').length,
    review: complaints.filter((item) => ['in_review', 'awaiting_user', 'awaiting_collector'].includes(item.status)).length,
    resolved: complaints.filter((item) => ['resolved', 'closed'].includes(item.status)).length,
  }), [complaints])

  return (
    <div className="fade-up">
      <PageHeader
        title={isEn ? 'Dispute supervision' : 'Supervision des litiges'}
        subtitle={isEn
          ? 'Evidence, conversation and traceable administrative decisions'
          : 'Preuves, conversation et decisions administratives tracables'}
      />

      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          [ShieldAlert, stats.urgent, isEn ? 'New' : 'Nouveaux', 'text-red-600 bg-red-50'],
          [Clock3, stats.review, isEn ? 'In review' : 'En instruction', 'text-blue-600 bg-blue-50'],
          [CheckCircle2, stats.resolved, isEn ? 'Decided' : 'Decides', 'text-green-600 bg-green-50'],
        ].map(([Icon, value, label, color]) => (
          <div key={label} className="card p-4">
            <Icon size={19} className={color.split(' ')[0]} />
            <p className="text-2xl font-bold mt-2">{value}</p>
            <p className="text-xs text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="card p-4 mb-5 grid sm:grid-cols-[1fr_220px] gap-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={isEn ? 'Case, pickup or user...' : 'Dossier, collecte ou utilisateur...'}
          />
        </div>
        <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">{isEn ? 'All statuses' : 'Tous les statuts'}</option>
          <option value="open">{isEn ? 'New' : 'Nouveaux'}</option>
          <option value="in_review">{isEn ? 'In review' : 'En instruction'}</option>
          <option value="awaiting_user">{isEn ? 'Waiting for customer' : 'Attente client'}</option>
          <option value="awaiting_collector">{isEn ? 'Waiting for collector' : 'Attente collecteur'}</option>
          <option value="resolved">{isEn ? 'Resolved' : 'Resolus'}</option>
          <option value="closed">{isEn ? 'Closed' : 'Fermes'}</option>
        </select>
      </div>

      {loading ? <PageLoader /> : filtered.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title={isEn ? 'No disputes' : 'Aucun litige'}
          description={isEn ? 'No case matches the selected filters.' : 'Aucun dossier ne correspond aux filtres.'}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((complaint) => (
            <button
              type="button"
              key={complaint.uuid}
              onClick={() => openComplaint(complaint)}
              className={`card p-5 w-full text-left hover:border-[#1A8A3C]/30 transition-all ${
                complaint.status === 'open' ? 'border-red-200 bg-red-50/30' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-gray-900">
                    {TYPE_LABELS[complaint.type]?.[isEn ? 1 : 0] || complaint.type}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    #{complaint.uuid.slice(0, 8)} - {complaint.complainant?.name}
                    {complaint.request?.uuid && ` - collecte #${complaint.request.uuid.slice(0, 8)}`}
                  </p>
                </div>
                <StatusBadge status={complaint.status} />
              </div>
              <p className="text-sm text-gray-600 mt-3 line-clamp-2">{complaint.description}</p>
              <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                <span className="flex items-center gap-1"><Image size={13} /> {complaint.evidence?.length || 0}</span>
                <span>{format(new Date(complaint.created_at), 'dd MMM yyyy HH:mm', { locale: dateLocale })}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${isEn ? 'Dispute case' : 'Dossier de litige'} #${selected.uuid.slice(0, 8)}` : ''}
        size="xl"
      >
        {selected && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <StatusBadge status={selected.status} />
              <span className="text-xs text-gray-400">
                {format(new Date(selected.created_at), 'dd MMM yyyy HH:mm', { locale: dateLocale })}
              </span>
            </div>

            <div className="rounded-xl bg-gray-50 p-4">
              <p className="font-bold">{TYPE_LABELS[selected.type]?.[isEn ? 1 : 0] || selected.type}</p>
              <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{selected.description}</p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-100 p-3">
                <p className="text-xs text-gray-400 flex items-center gap-1"><UserRound size={13} /> {isEn ? 'Complainant' : 'Plaignant'}</p>
                <p className="font-semibold text-sm mt-1">{selected.complainant?.name}</p>
                <p className="text-xs text-gray-500">{selected.complainant?.email}</p>
              </div>
              <div className="rounded-xl border border-gray-100 p-3">
                <p className="text-xs text-gray-400 flex items-center gap-1"><MapPin size={13} /> {isEn ? 'Related pickup' : 'Collecte concernee'}</p>
                <p className="font-semibold text-sm mt-1">#{selected.request?.uuid?.slice(0, 8)}</p>
                <p className="text-xs text-gray-500">{selected.request?.address}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {selected.request?.user?.name} / {selected.request?.collector?.name || (isEn ? 'Unassigned' : 'Non assigne')}
                </p>
              </div>
            </div>

            {selected.evidence?.length > 0 && (
              <div>
                <h3 className="text-sm font-bold mb-2">{isEn ? 'Encrypted evidence' : 'Preuves chiffrees'}</h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {selected.evidence.map((evidence) => (
                    <AuthenticatedComplaintImage
                      key={evidence.id}
                      complaintUuid={selected.uuid}
                      evidence={evidence}
                      className="w-full aspect-square rounded-xl"
                    />
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
                <MessageSquare size={16} /> {isEn ? 'Conversation' : 'Conversation'}
              </h3>
              <div className="space-y-3 max-h-64 overflow-y-auto rounded-xl bg-gray-50 p-3">
                {messages.map((item) => (
                  <div
                    key={item.uuid}
                    className={`rounded-xl p-3 ${
                      item.message_type === 'decision'
                        ? 'bg-green-50 border border-green-200'
                        : item.sender?.role === 'admin'
                          ? 'bg-[#E8F5EE] ml-8'
                          : 'bg-white border border-gray-200 mr-8'
                    }`}
                  >
                    <div className="flex justify-between gap-2">
                      <p className="text-xs font-bold">
                        {item.sender?.role === 'admin' ? (isEn ? 'Administration' : 'Administration') : item.sender?.name}
                      </p>
                      <p className="text-[10px] text-gray-400">{format(new Date(item.created_at), 'dd/MM HH:mm')}</p>
                    </div>
                    <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{item.body}</p>
                  </div>
                ))}
              </div>
              {selected.status !== 'closed' && (
                <div className="flex gap-2 mt-3">
                  <textarea
                    className="input resize-none min-h-[68px]"
                    maxLength={1500}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder={isEn ? 'Ask for information or reply...' : 'Demander une information ou repondre...'}
                  />
                  <button onClick={sendMessage} disabled={saving || !message.trim()} className="btn-primary self-end px-4">
                    <Send size={17} />
                  </button>
                </div>
              )}
            </div>

            {!['resolved', 'closed'].includes(selected.status) && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
                <h3 className="font-bold text-sm text-blue-900">{isEn ? 'Case review' : 'Instruction du dossier'}</h3>
                <div className="flex flex-col sm:flex-row gap-2 mt-3">
                  <select className="input" value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)}>
                    <option value="in_review">{isEn ? 'In review' : 'En cours d instruction'}</option>
                    <option value="awaiting_user">{isEn ? 'Waiting for customer' : 'Informations client attendues'}</option>
                    <option value="awaiting_collector">{isEn ? 'Waiting for collector' : 'Informations collecteur attendues'}</option>
                  </select>
                  <button onClick={updateReview} disabled={saving} className="btn-outline justify-center whitespace-nowrap">
                    {isEn ? 'Update status' : 'Mettre a jour'}
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-green-200 bg-green-50/40 p-4">
              <h3 className="font-bold text-sm text-green-900 flex items-center gap-2">
                <Gavel size={16} /> {isEn ? 'Administrative decision' : 'Decision administrative'}
              </h3>
              <div className="grid sm:grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="label">{isEn ? 'Outcome' : 'Conclusion'} *</label>
                  <select
                    className="input"
                    value={decision.outcome}
                    onChange={(event) => setDecision((current) => ({ ...current, outcome: event.target.value }))}
                  >
                    {OUTCOMES.map(([value, frLabel, enLabel]) => (
                      <option key={value} value={value}>{isEn ? enLabel : frLabel}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">{isEn ? 'Final status' : 'Statut final'} *</label>
                  <select
                    className="input"
                    value={decision.status}
                    onChange={(event) => setDecision((current) => ({ ...current, status: event.target.value }))}
                  >
                    <option value="resolved">{isEn ? 'Resolved (can still reply)' : 'Resolu (reponse encore possible)'}</option>
                    <option value="closed">{isEn ? 'Closed' : 'Ferme definitivement'}</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{isEn ? 'Reasoned decision' : 'Decision motivee'} *</label>
                  <textarea
                    className="input resize-none min-h-[110px]"
                    maxLength={2000}
                    value={decision.summary}
                    onChange={(event) => setDecision((current) => ({ ...current, summary: event.target.value }))}
                    placeholder={isEn
                      ? 'Summarize verified facts, findings and the decision...'
                      : 'Resumer les faits verifies, les constats et la decision...'}
                  />
                </div>
                <div>
                  <label className="label">{isEn ? 'Compensation (FCFA)' : 'Compensation (FCFA)'}</label>
                  <input
                    type="number"
                    min="0"
                    max="10000000"
                    className="input"
                    value={decision.compensation_amount}
                    onChange={(event) => setDecision((current) => ({
                      ...current,
                      compensation_amount: event.target.value,
                    }))}
                  />
                </div>
                <div className="flex items-end">
                  <button onClick={recordDecision} disabled={saving} className="btn-primary w-full justify-center">
                    <Gavel size={16} /> {saving ? (isEn ? 'Saving...' : 'Enregistrement...') : (isEn ? 'Record decision' : 'Enregistrer la decision')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
