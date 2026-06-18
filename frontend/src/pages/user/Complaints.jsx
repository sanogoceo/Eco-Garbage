import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Camera, ImagePlus, MapPin, MessageCircle, MessageSquare,
  Plus, Send, ShieldCheck, Truck,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { enUS, fr } from 'date-fns/locale'
import { complaintApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import {
  EmptyState, Modal, PageHeader, PageLoader, StatusBadge,
} from '../../components/common'
import AuthenticatedComplaintImage from '../../components/common/AuthenticatedComplaintImage'

const TYPES = [
  ['missed_pickup', 'Collecte manquee', 'Missed pickup'],
  ['incorrect_pricing', 'Tarif incorrect', 'Incorrect pricing'],
  ['collector_misconduct', 'Comportement du collecteur', 'Collector misconduct'],
  ['service_quality', 'Qualite du service', 'Service quality'],
  ['damaged_property', 'Bien endommage', 'Damaged property'],
  ['payment_issue', 'Probleme de paiement', 'Payment issue'],
  ['other', 'Autre', 'Other'],
]

const OUTCOMES = {
  upheld: ['Reclamation acceptee', 'Complaint upheld'],
  rejected: ['Reclamation rejetee', 'Complaint rejected'],
  partial: ['Partiellement acceptee', 'Partially upheld'],
  refund: ['Remboursement recommande', 'Refund recommended'],
  warning: ['Avertissement emis', 'Warning issued'],
  no_action: ['Aucune action', 'No action'],
}

const typeLabel = (type, isEn) => {
  const item = TYPES.find(([value]) => value === type)
  return item ? item[isEn ? 2 : 1] : type
}

export default function Complaints() {
  const { i18n } = useTranslation()
  const { user } = useAuth()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const isEn = i18n.language?.startsWith('en')
  const dateLocale = isEn ? enUS : fr
  const perspective = user?.role === 'collector' && location.pathname.startsWith('/dashboard')
    ? { perspective: 'user' }
    : undefined
  const [complaints, setComplaints] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [message, setMessage] = useState('')
  const [photos, setPhotos] = useState([])
  const [extraPhotos, setExtraPhotos] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [sending, setSending] = useState(false)
  const [form, setForm] = useState({
    request_uuid: searchParams.get('request') || '',
    type: 'service_quality',
    description: '',
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const results = await Promise.allSettled([
        complaintApi.mine(perspective),
        complaintApi.eligibleRequests(perspective),
      ])
      if (results[0].status === 'fulfilled') {
        setComplaints(results[0].value.data.data || [])
      }
      if (results[1].status === 'fulfilled') {
        setRequests(results[1].value.data.data || [])
      }
      if (results.some((result) => result.status === 'rejected')) {
        throw results.find((result) => result.status === 'rejected').reason
      }
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn ? 'Unable to load disputes' : 'Impossible de charger les litiges'))
    } finally {
      setLoading(false)
    }
  }, [isEn, location.pathname, user?.role])

  useEffect(() => { loadData() }, [loadData])

  const openDetail = async (complaint) => {
    try {
      const results = await Promise.allSettled([
        complaintApi.get(complaint.uuid),
        complaintApi.messages(complaint.uuid),
      ])
      if (results[0].status === 'fulfilled') {
        setSelected(results[0].value.data.data)
      }
      if (results[1].status === 'fulfilled') {
        setMessages(results[1].value.data.data || [])
      }
      if (results.some((result) => result.status === 'rejected')) {
        throw results.find((result) => result.status === 'rejected').reason
      }
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn ? 'Unable to open dispute' : 'Impossible d ouvrir le litige'))
    }
  }

  const submitComplaint = async () => {
    if (!form.request_uuid) {
      return toast.error(isEn ? 'Select the related pickup' : 'Selectionnez la collecte concernee')
    }
    if (form.description.trim().length < 20) {
      return toast.error(isEn ? 'Provide at least 20 characters' : 'Decrivez le probleme en au moins 20 caracteres')
    }
    if (photos.length > 4) {
      return toast.error(isEn ? 'Maximum 4 photos' : 'Maximum 4 photos')
    }
    setSubmitting(true)
    try {
      const data = new FormData()
      data.append('request_uuid', form.request_uuid)
      data.append('type', form.type)
      data.append('description', form.description.trim())
      photos.forEach((photo) => data.append('photos', photo))
      await complaintApi.create(data)
      toast.success(isEn ? 'Dispute submitted' : 'Litige transmis a l administration')
      setCreateOpen(false)
      setForm({ request_uuid: '', type: 'service_quality', description: '' })
      setPhotos([])
      await loadData()
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn ? 'Submission failed' : 'Echec de l envoi'))
    } finally {
      setSubmitting(false)
    }
  }

  const sendMessage = async () => {
    const body = message.trim()
    if (!body) return
    setSending(true)
    try {
      await complaintApi.sendMessage(selected.uuid, body)
      setMessage('')
      await openDetail(selected)
      await loadData()
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn ? 'Message not sent' : 'Message non envoye'))
    } finally {
      setSending(false)
    }
  }

  const addEvidence = async () => {
    if (!extraPhotos.length) return
    setSubmitting(true)
    try {
      const data = new FormData()
      extraPhotos.forEach((photo) => data.append('photos', photo))
      await complaintApi.addEvidence(selected.uuid, data)
      setExtraPhotos([])
      await openDetail(selected)
      toast.success(isEn ? 'Evidence added' : 'Preuves ajoutees')
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn ? 'Upload failed' : 'Envoi impossible'))
    } finally {
      setSubmitting(false)
    }
  }

  const currentUserId = user?.id || user?._id
  const activeCount = useMemo(
    () => complaints.filter((item) => !['resolved', 'closed'].includes(item.status)).length,
    [complaints]
  )

  return (
    <div className="fade-up">
      <PageHeader
        title={isEn ? 'Collection disputes' : 'Litiges de collecte'}
        subtitle={isEn
          ? `${activeCount} active case(s) - secure exchanges with administration`
          : `${activeCount} dossier(s) actif(s) - echanges securises avec l administration`}
        action={(
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            <Plus size={16} /> {isEn ? 'Open a dispute' : 'Ouvrir un litige'}
          </button>
        )}
      />

      {loading ? <PageLoader /> : complaints.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={isEn ? 'No disputes' : 'Aucun litige'}
          description={isEn
            ? 'Report a problem related to one of your pickups.'
            : 'Signalez un probleme lie a l une de vos collectes.'}
          action={(
            <button onClick={() => setCreateOpen(true)} className="btn-primary">
              <Plus size={16} /> {isEn ? 'Open a dispute' : 'Ouvrir un litige'}
            </button>
          )}
        />
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {complaints.map((complaint) => (
            <button
              type="button"
              key={complaint.uuid}
              onClick={() => openDetail(complaint)}
              className="card p-5 text-left hover:border-[#1A8A3C]/30 hover:-translate-y-0.5 transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display font-bold text-gray-900">
                    {typeLabel(complaint.type, isEn)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    #{complaint.request?.uuid?.slice(0, 8)} - {format(new Date(complaint.created_at), 'dd MMM yyyy HH:mm', { locale: dateLocale })}
                  </p>
                </div>
                <StatusBadge status={complaint.status} />
              </div>
              <p className="text-sm text-gray-600 mt-3 line-clamp-2">{complaint.description}</p>
              <div className="flex items-center justify-between mt-4 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <Camera size={14} /> {complaint.evidence?.length || 0} photo(s)
                </span>
                <span className="flex items-center gap-1">
                  <MessageCircle size={14} /> {isEn ? 'Open conversation' : 'Ouvrir la conversation'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title={isEn ? 'New collection dispute' : 'Nouveau litige de collecte'}
        size="xl"
      >
        <div className="space-y-4">
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-sm text-blue-700">
            {isEn
              ? 'Describe facts precisely. Your photos are encrypted and only accessible to the parties and administration.'
              : 'Decrivez les faits precisement. Vos photos sont chiffrees et accessibles uniquement aux parties et a l administration.'}
          </div>
          <div>
            <label className="label">{isEn ? 'Related pickup' : 'Collecte concernee'} *</label>
            <select
              className="input"
              value={form.request_uuid}
              onChange={(event) => setForm((current) => ({ ...current, request_uuid: event.target.value }))}
            >
              <option value="">{isEn ? 'Select a pickup' : 'Selectionner une collecte'}</option>
              {requests.map((request) => (
                <option key={request.uuid} value={request.uuid}>
                  #{request.uuid.slice(0, 8)} - {request.address} ({request.status})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{isEn ? 'Issue type' : 'Type de probleme'} *</label>
            <select
              className="input"
              value={form.type}
              onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
            >
              {TYPES.map(([value, frLabel, enLabel]) => (
                <option key={value} value={value}>{isEn ? enLabel : frLabel}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{isEn ? 'Detailed description' : 'Description detaillee'} *</label>
            <textarea
              className="input resize-none min-h-[130px]"
              maxLength={2000}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder={isEn
                ? 'Explain what happened, when, and the expected resolution...'
                : 'Expliquez ce qui s est passe, quand, et la solution attendue...'}
            />
            <p className="text-xs text-gray-400 text-right mt-1">{form.description.length}/2000</p>
          </div>
          <div>
            <label className="label">{isEn ? 'Photo evidence (optional)' : 'Preuves photo (optionnel)'}</label>
            <label className="border-2 border-dashed border-gray-200 rounded-xl p-5 flex flex-col items-center cursor-pointer hover:border-[#1A8A3C]/50">
              <ImagePlus className="text-[#1A8A3C]" />
              <span className="text-sm font-medium mt-2">
                {photos.length
                  ? `${photos.length} photo(s)`
                  : (isEn ? 'Choose up to 4 photos' : 'Choisir jusqu a 4 photos')}
              </span>
              <span className="text-xs text-gray-400 mt-1">JPEG/PNG - 5 Mo maximum par photo</span>
              <input
                type="file"
                className="hidden"
                accept="image/jpeg,image/png"
                multiple
                onChange={(event) => setPhotos([...event.target.files].slice(0, 4))}
              />
            </label>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setCreateOpen(false)} className="btn-outline flex-1 justify-center">
              {isEn ? 'Cancel' : 'Annuler'}
            </button>
            <button onClick={submitComplaint} disabled={submitting} className="btn-primary flex-1 justify-center">
              {submitting ? (isEn ? 'Sending...' : 'Envoi...') : (isEn ? 'Submit case' : 'Transmettre le dossier')}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${typeLabel(selected.type, isEn)} - #${selected.uuid.slice(0, 8)}` : ''}
        size="xl"
      >
        {selected && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <StatusBadge status={selected.status} />
              <span className="text-xs text-gray-400">
                {format(new Date(selected.created_at), 'dd MMM yyyy HH:mm', { locale: dateLocale })}
              </span>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400">{isEn ? 'Pickup' : 'Collecte'}</p>
                <p className="font-semibold text-sm mt-1">#{selected.request?.uuid?.slice(0, 8)}</p>
                <p className="text-xs text-gray-500 flex items-start gap-1 mt-1">
                  <MapPin size={13} className="mt-0.5" /> {selected.request?.address}
                </p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-400">{isEn ? 'Parties' : 'Parties concernees'}</p>
                <p className="text-sm mt-1">{selected.request?.user?.name || '-'}</p>
                <p className="text-sm flex items-center gap-1"><Truck size={13} /> {selected.request?.collector?.name || '-'}</p>
              </div>
            </div>

            {selected.evidence?.length > 0 && (
              <div>
                <h3 className="font-semibold text-sm mb-2">{isEn ? 'Photo evidence' : 'Preuves photo'}</h3>
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

            {selected.decision && (
              <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
                <p className="text-xs font-semibold text-green-700 uppercase">{isEn ? 'Administrative decision' : 'Decision administrative'}</p>
                <p className="font-bold text-green-900 mt-1">
                  {OUTCOMES[selected.decision.outcome]?.[isEn ? 1 : 0] || selected.decision.outcome}
                </p>
                <p className="text-sm text-green-800 mt-2">{selected.decision.summary}</p>
                {selected.decision.compensation_amount > 0 && (
                  <p className="text-sm font-bold mt-2">
                    {isEn ? 'Compensation' : 'Compensation'}: {selected.decision.compensation_amount.toLocaleString()} FCFA
                  </p>
                )}
              </div>
            )}

            <div>
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <MessageSquare size={16} /> {isEn ? 'Case conversation' : 'Conversation du dossier'}
              </h3>
              <div className="space-y-3 max-h-72 overflow-y-auto rounded-xl bg-gray-50 p-3">
                {messages.map((item) => {
                  const mine = item.sender?.id === currentUserId
                  const administrative = item.sender?.role === 'admin'
                  return (
                    <div key={item.uuid} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                        item.message_type === 'decision'
                          ? 'bg-green-100 text-green-900 border border-green-200'
                          : mine ? 'bg-[#1A8A3C] text-white' : 'bg-white border border-gray-200'
                      }`}>
                        <p className={`text-xs font-semibold mb-1 ${mine && item.message_type === 'message' ? 'text-green-100' : 'text-gray-500'}`}>
                          {administrative ? (isEn ? 'Administration' : 'Administration') : item.sender?.name}
                        </p>
                        <p className="text-sm whitespace-pre-wrap">{item.body}</p>
                        <p className={`text-[10px] mt-1 ${mine && item.message_type === 'message' ? 'text-green-100' : 'text-gray-400'}`}>
                          {format(new Date(item.created_at), 'dd/MM HH:mm')}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {selected.status !== 'closed' && (
              <>
                <div className="flex gap-2">
                  <textarea
                    className="input resize-none min-h-[70px]"
                    maxLength={1500}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder={isEn ? 'Write a secure message...' : 'Ecrire un message securise...'}
                  />
                  <button onClick={sendMessage} disabled={sending || !message.trim()} className="btn-primary self-end px-4">
                    <Send size={17} />
                  </button>
                </div>
                <div className="rounded-xl border border-gray-200 p-3">
                  <label className="label">{isEn ? 'Add evidence' : 'Ajouter des preuves'}</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="file"
                      className="input"
                      accept="image/jpeg,image/png"
                      multiple
                      onChange={(event) => setExtraPhotos([...event.target.files].slice(0, 4))}
                    />
                    <button
                      onClick={addEvidence}
                      disabled={submitting || !extraPhotos.length}
                      className="btn-outline justify-center whitespace-nowrap"
                    >
                      <ImagePlus size={16} /> {isEn ? 'Add' : 'Ajouter'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
