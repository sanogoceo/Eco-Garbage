import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, X, Star, ShieldCheck, Archive, KeyRound, Camera, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { requestApi, ratingApi } from '../../services/api'
import { StatusBadge, PageLoader, Modal } from '../../components/common'
import LiveRouteMap from '../../components/common/LiveRouteMap'
import RequestChat from '../../components/common/RequestChat'
import { subscribeToRequest } from '../../services/realtime'
import AuthenticatedProofImage from '../../components/common/AuthenticatedProofImage'
import AuthenticatedCollectorPhoto from '../../components/common/AuthenticatedCollectorPhoto'
import { format } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import { getServiceTypeLabel } from '../../utils/serviceTypes'

export default function RequestDetail() {
  const { t, i18n } = useTranslation()
  const dateLocale = i18n.language?.startsWith('en') ? enUS : fr
  const isEn = i18n.language?.startsWith('en')
  const { uuid } = useParams()
  const navigate = useNavigate()
  const [req, setReq] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cancelDialog, setCancelDialog] = useState(false)
  const [ratingModal, setRatingModal] = useState(false)
  const [score, setScore] = useState(5)
  const [comment, setComment] = useState('')
  const [archiving, setArchiving] = useState(false)
  const [completionCode, setCompletionCode] = useState(null)
  const [codeLoading, setCodeLoading] = useState(false)
  const [cancelForm, setCancelForm] = useState({ reason: 'changed_mind', details: '' })

  const TIMELINE = [
    { status: 'pending',     label: isEn ? 'Received'  : 'Reçue',      icon: '📨' },
    { status: 'approved',    label: isEn ? 'Approved'  : 'Approuvée',  icon: '✅' },
    { status: 'assigned',    label: isEn ? 'Assigned'  : 'Assigné',    icon: '👤' },
    { status: 'on_way',      label: isEn ? 'En route'  : 'En route',   icon: '🚛' },
    { status: 'in_progress', label: isEn ? 'Ongoing'   : 'En cours',   icon: '⚙️' },
    { status: 'completed',   label: isEn ? 'Done'      : 'Terminée',   icon: '🎉' },
  ]

  const fetchReq = async () => {
    try {
      const { data } = await requestApi.get(uuid)
      setReq(data.data)
    } catch {
      toast.error(isEn ? 'Request not found' : 'Demande introuvable')
      navigate('/dashboard/requests')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchReq() }, [uuid])

  useEffect(() => subscribeToRequest(uuid, {
    location_updated: (payload) => setReq((current) => current ? { ...current, ...payload } : current),
    status_updated: () => fetchReq(),
  }), [uuid])

  useEffect(() => {
    if (!req) return
    if (!['on_way', 'in_progress'].includes(req.status)) return
    const timer = setInterval(fetchReq, 10000)
    return () => clearInterval(timer)
  }, [req?.status])

  useEffect(() => {
    if (req?.status !== 'in_progress') {
      setCompletionCode(null)
      return
    }
    setCodeLoading(true)
    requestApi.completionCode(uuid)
      .then((response) => setCompletionCode(response.data.data))
      .catch(() => setCompletionCode(null))
      .finally(() => setCodeLoading(false))
  }, [req?.status, uuid])

  const handleCancel = async () => {
    try {
      const response = await requestApi.cancel(uuid, cancelForm)
      toast.success(t('user.requests.cancelSuccess'))
      if (response.data.data?.cancellation_fee) {
        toast(`Frais d'annulation: ${response.data.data.cancellation_fee.toLocaleString()} FCFA`)
      }
      setCancelDialog(false)
      fetchReq()
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.serverError'))
    }
  }

  const handleRating = async () => {
    try {
      await ratingApi.create({ request_uuid: uuid, score, comment })
      toast.success(isEn ? 'Rating saved!' : 'Note enregistrée !')
      setRatingModal(false)
      fetchReq()
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.serverError'))
    }
  }

  const handleArchive = async () => {
    setArchiving(true)
    try {
      await requestApi.archive(uuid)
      toast.success(isEn ? 'Request archived' : 'Demande archivée')
      navigate('/dashboard/archived')
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.serverError'))
    } finally {
      setArchiving(false)
    }
  }

  if (loading) return <PageLoader />
  if (!req) return null

  const canCancel = !['completed','cancelled','in_progress'].includes(req.status)
  const canRate = req.status === 'completed' && !req.rating_score
  const canArchive = ['completed','cancelled','failed'].includes(req.status)

  const ORDER = ['pending','approved','assigned','on_way','in_progress','completed']
  const currentIdx = ORDER.indexOf(req.status)

  const details = [
    [isEn ? 'Waste type'      : 'Type de déchet',  req.category_name],
    [isEn ? 'Service type'    : 'Type de service',  getServiceTypeLabel(req.service_type, isEn)],
    [isEn ? 'Address'         : 'Adresse',           req.address],
    ...(req.address_details ? [
      [isEn ? 'City' : 'Ville', req.address_details.city || '—'],
      [isEn ? 'District' : 'Quartier', req.address_details.district || '—'],
      [isEn ? 'Landmark' : 'Repère', req.address_details.landmark || '—'],
    ] : []),
    [isEn ? 'Quantity'        : 'Quantité',          req.quantity_number ? `${req.quantity_number} ${isEn ? 'unit(s)' : 'unité(s)'}` : req.quantity_estimate || '—'],
    [isEn ? 'Distance'        : 'Distance',          req.distance_km ? `${req.distance_km} km` : '—'],
    [isEn ? 'Estimated price' : 'Prix estimé',       req.estimated_price ? `${parseFloat(req.estimated_price).toLocaleString()} FCFA` : '—'],
    [isEn ? 'Final price'     : 'Prix final',        req.final_price ? `${parseFloat(req.final_price).toLocaleString()} FCFA` : '—'],
    ...(req.scheduled_at ? [[
      isEn ? 'Scheduled slot' : 'Créneau réservé',
      format(new Date(req.scheduled_at), 'dd MMM yyyy HH:mm', { locale: dateLocale }),
    ]] : []),
    ...(req.pricing ? [
      [
        isEn ? 'Base and quantity' : 'Base et quantité',
        `${Number(req.pricing.base_subtotal || 0).toLocaleString()} FCFA`,
      ],
      [
        isEn ? 'Distance fee' : 'Frais de distance',
        `${Number(req.pricing.distance_fee || 0).toLocaleString()} FCFA`,
      ],
      [
        isEn ? 'Service adjustment' : 'Ajustement du service',
        `x${req.pricing.service_multiplier || 1}`,
      ],
      [
        isEn ? 'Service fixed fee' : 'Frais fixes du service',
        `${Number(req.pricing.service_fee || 0).toLocaleString()} FCFA`,
      ],
      [
        isEn ? 'Zone adjustment' : 'Ajustement de zone',
        req.pricing.zone_label
          ? `${req.pricing.zone_label} (x${req.pricing.zone_multiplier || 1})`
          : `x${req.pricing.zone_multiplier || 1}`,
      ],
      [
        isEn ? 'Zone fee' : 'Frais de zone',
        `${Number(req.pricing.zone_fee || 0).toLocaleString()} FCFA`,
      ],
    ] : []),
    ...(req.business_details ? [
      [isEn ? 'Company' : 'Entreprise', req.business_details.company_name],
      ['RCCM', req.business_details.registration_number],
      ['NIU', req.business_details.tax_id || '—'],
      [isEn ? 'Billing email' : 'Email de facturation', req.business_details.billing_email],
      [isEn ? 'Billing address' : 'Adresse de facturation', req.business_details.billing_address],
      [isEn ? 'Company contact' : 'Contact entreprise', req.business_details.contact_name],
    ] : []),
    [isEn ? 'Created on'      : 'Créée le',          format(new Date(req.created_at), 'dd MMM yyyy HH:mm', { locale: dateLocale })],
    [isEn ? 'Collector'       : 'Collecteur',        req.collector_name || (isEn ? 'Not assigned' : 'Non assigné')],
    [isEn ? 'Collector phone' : 'Tél. collecteur',   req.collector_phone || '—'],
  ]

  return (
    <div className="fade-up max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
        <div>
          <h1 className="text-xl font-display font-bold">{isEn ? 'Collection detail' : 'Détail de la collecte'}</h1>
          <p className="text-sm text-gray-400">#{req.uuid?.slice(0,8).toUpperCase()}</p>
        </div>
        <div className="ml-auto"><StatusBadge status={req.status} /></div>
      </div>

      {!['cancelled','failed'].includes(req.status) && (
        <div className="card p-6 mb-5">
          <h3 className="font-display font-bold mb-5">{isEn ? 'Progress' : 'Progression'}</h3>
          <div className="flex items-start gap-0">
            {TIMELINE.map((step, i) => {
              const done = i <= currentIdx
              const active = i === currentIdx
              return (
                <div key={step.status} className="flex-1 flex flex-col items-center gap-1 relative">
                  {i < TIMELINE.length - 1 && (
                    <div className={`absolute top-4 left-1/2 w-full h-0.5 ${done && i < currentIdx ? 'bg-[#1A8A3C]' : 'bg-gray-200'}`} />
                  )}
                  <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all ${done ? 'bg-[#1A8A3C] text-white' : 'bg-gray-100 text-gray-400'} ${active ? 'ring-4 ring-[#E8F5EE] scale-110' : ''}`}>
                    {step.icon}
                  </div>
                  <p className={`text-[10px] text-center leading-tight mt-1 ${done ? 'text-[#1A8A3C] font-semibold' : 'text-gray-400'}`}>{step.label}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {['assigned','on_way','in_progress'].includes(req.status) && (
        <div className="card p-6 mb-5">
          <h3 className="font-display font-bold mb-4">
            {isEn ? '🗺️ Live route' : '🗺️ Trajet en temps réel'}
          </h3>
          <LiveRouteMap
            userLocation={req.latitude && req.longitude ? { latitude: req.latitude, longitude: req.longitude } : null}
            collectorLocation={req.collector_location}
            userLabel={isEn ? 'Collection address' : 'Adresse de collecte'}
            collectorLabel={isEn ? 'Collector' : 'Collecteur'}
          />
          <p className="text-xs text-gray-400 mt-3">
            {isEn
              ? 'Updates every 10 seconds while the collector is on the way.'
              : 'Mise à jour toutes les 10 secondes pendant le trajet du collecteur.'}
          </p>
          {req.eta_minutes && (
            <div className="mt-3 rounded-xl bg-[#E8F5EE] p-3 text-sm text-[#1A8A3C] font-semibold">
              Arrivee estimee dans {req.eta_minutes} min · {req.remaining_distance_km} km restants
            </div>
          )}
        </div>
      )}

      {req.collector_name && ['assigned','on_way','in_progress','completed'].includes(req.status) && (
        <div className="card p-5 mb-5 border-2 border-[#C8EDDA] bg-gradient-to-br from-[#F0FBF7] to-white">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck size={16} className="text-[#1A8A3C]" />
            <h3 className="font-display font-bold text-[#1A8A3C]">
              {isEn ? 'Your collector — security verification' : 'Votre collecteur — vérification sécurité'}
            </h3>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-xl overflow-hidden bg-[#E8F5EE] flex-shrink-0 flex items-center justify-center border-2 border-[#1A8A3C]">
              <AuthenticatedCollectorPhoto
                requestUuid={uuid}
                collectorName={req.collector_name}
                className="w-full h-full"
              />
            </div>
            <div className="flex-1">
              <p className="font-bold text-gray-900 text-lg">{req.collector_name}</p>
              {req.collector_phone && (
                <a href={`tel:${req.collector_phone}`} className="text-sm text-[#1A8A3C] font-medium hover:underline block">
                  📞 {req.collector_phone}
                </a>
              )}
              <div className="mt-2 p-2 bg-white rounded-lg border border-[#C8EDDA] text-xs text-gray-600">
                <p className="font-semibold text-[#1A8A3C] mb-0.5">🔒 {isEn ? 'Security measure' : 'Mesure de sécurité'}</p>
                <p>{isEn
                  ? 'Please verify this photo matches the person coming to your home.'
                  : 'Vérifiez que cette photo correspond à la personne venant à votre domicile.'}</p>
              </div>
              {!req.collector_photo_available && (
                <p className="mt-2 text-xs font-semibold text-orange-700">
                  {isEn
                    ? 'Verified photo unavailable. Do not share the completion code before checking the collector.'
                    : 'Photo validee indisponible. Ne communiquez pas le code avant de verifier le collecteur.'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {req?.status === 'in_progress' && codeLoading && (
        <div className="card p-5 mb-5 border-2 border-orange-200 bg-orange-50 flex items-center justify-center gap-2 text-orange-700 text-sm font-medium">
          <Loader2 size={18} className="spinner" />
          {isEn ? 'Loading confirmation code...' : 'Chargement du code de confirmation...'}
        </div>
      )}

      {completionCode?.code && !codeLoading && (
        <div className="card p-5 mb-5 border-2 border-orange-200 bg-orange-50 text-center">
          <KeyRound size={22} className="mx-auto text-orange-600 mb-2" />
          <p className="text-sm font-semibold text-orange-800">Code de confirmation de fin</p>
          <p className="text-3xl tracking-[0.35em] font-bold text-orange-700 my-2">{completionCode.code}</p>
          <p className="text-xs text-orange-700">Donnez ce code au collecteur seulement apres avoir verifie le travail.</p>
        </div>
      )}

      {req.collector_id && !['cancelled', 'failed'].includes(req.status) && (
        <RequestChat requestUuid={uuid} />
      )}

      <div className="card p-6 mb-5">
        <h3 className="font-display font-bold mb-4">{isEn ? 'Information' : 'Informations'}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {details.map(([k, v]) => (
            <div key={k}>
              <p className="text-xs text-gray-400 mb-0.5">{k}</p>
              <p className="text-sm font-medium text-gray-800 break-words">{v}</p>
            </div>
          ))}
        </div>
        {req.notes && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400 mb-1">{isEn ? 'Instructions' : 'Instructions'}</p>
            <p className="text-sm text-gray-600">{req.notes}</p>
          </div>
        )}
      </div>

      {req.proofs?.length > 0 && (
        <div className="card p-5 mb-5">
          <h3 className="font-display font-bold flex items-center gap-2 mb-3">
            <Camera size={18} className="text-[#1A8A3C]" /> Preuves de collecte
          </h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {req.proofs.map((proof) => (
              <div key={proof._id} className="rounded-xl border border-gray-200 overflow-hidden">
                <AuthenticatedProofImage requestUuid={uuid} proof={proof} className="w-full h-36" />
                <div className="p-3">
                  <p className="font-semibold text-sm">{proof.type === 'before' ? 'Photo avant' : 'Photo apres'}</p>
                  <p className="text-xs text-gray-400 mt-1">{new Date(proof.captured_at).toLocaleString()}</p>
                  <p className="text-xs text-gray-400">{proof.location?.latitude?.toFixed(5)}, {proof.location?.longitude?.toFixed(5)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {req.status === 'completed' && (
        <div className={`rounded-2xl p-4 mb-5 flex items-center justify-between ${req.payment_status === 'completed' ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
          <div>
            <p className="text-sm font-semibold">
              {req.payment_status === 'completed'
                ? (isEn ? '✅ Payment completed' : '✅ Paiement effectué')
                : (isEn ? '⏳ Payment pending'   : '⏳ Paiement en attente')}
            </p>
            {(req.payment_amount || req.final_price) && (
              <p className="text-xs text-gray-500 mt-0.5">
                {parseFloat(req.payment_amount || req.final_price).toLocaleString()} FCFA
              </p>
            )}
          </div>
          {req.payment_status !== 'completed' && (
            <Link to="/dashboard/payments" className="btn-primary text-xs px-4 py-2">
              {isEn ? 'Pay now' : 'Payer maintenant'}
            </Link>
          )}
        </div>
      )}

      {req.rating_score && (
        <div className="card p-4 mb-5">
          <p className="text-sm font-semibold mb-1">{isEn ? 'Your rating' : 'Votre évaluation'}</p>
          <div className="flex gap-0.5 text-yellow-400">{'★'.repeat(req.rating_score)}{'☆'.repeat(5-req.rating_score)}</div>
          {req.rating_comment && <p className="text-xs text-gray-400 mt-1 italic">"{req.rating_comment}"</p>}
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        {canRate && (
          <button onClick={() => setRatingModal(true)} className="btn-primary flex-1 justify-center">
            <Star size={16} /> {isEn ? 'Rate collector' : 'Noter le collecteur'}
          </button>
        )}
        {canCancel && (
          <button onClick={() => setCancelDialog(true)}
            className="flex-1 justify-center inline-flex items-center gap-2 border-2 border-red-300 text-red-500 px-6 py-3 rounded-xl font-semibold text-sm hover:bg-red-50 transition-all">
            <X size={16} /> {isEn ? 'Cancel request' : 'Annuler la demande'}
          </button>
        )}
        {canArchive && (
          <button onClick={handleArchive} disabled={archiving}
            className="flex-1 justify-center inline-flex items-center gap-2 border-2 border-gray-300 text-gray-600 px-6 py-3 rounded-xl font-semibold text-sm hover:bg-gray-50 transition-all disabled:opacity-50">
            <Archive size={16} /> {archiving ? (isEn ? 'Archiving...' : 'Archivage...') : (isEn ? 'Archive' : 'Archiver')}
          </button>
        )}
        <Link to={`/dashboard/complaints?request=${uuid}`} className="btn-ghost flex-1 justify-center border border-gray-200">
          💬 {isEn ? 'Report a problem' : 'Signaler un problème'}
        </Link>
      </div>

      <Modal isOpen={cancelDialog} onClose={() => setCancelDialog(false)} title="Annuler la collecte" size="sm">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-500">
            {req.cancellation_fee_estimate > 0
              ? `Frais prevus: ${Number(req.cancellation_fee_estimate).toLocaleString()} FCFA.`
              : 'Cette annulation est actuellement sans frais.'}
          </p>
          <div>
            <label className="label">Motif</label>
            <select className="input" value={cancelForm.reason}
              onChange={(event) => setCancelForm({ ...cancelForm, reason: event.target.value })}>
              <option value="changed_mind">J'ai change d'avis</option>
              <option value="duplicate">Demande en double</option>
              <option value="collector_delay">Retard du collecteur</option>
              <option value="price">Prix trop eleve</option>
              <option value="address_error">Erreur d'adresse</option>
              <option value="other">Autre</option>
            </select>
          </div>
          <textarea className="input" maxLength={500} placeholder="Details optionnels"
            value={cancelForm.details}
            onChange={(event) => setCancelForm({ ...cancelForm, details: event.target.value })} />
          <div className="flex gap-3">
            <button onClick={() => setCancelDialog(false)} className="btn-ghost flex-1 justify-center border border-gray-200">Retour</button>
            <button onClick={handleCancel} className="flex-1 rounded-xl bg-red-500 text-white font-semibold">Confirmer</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={ratingModal} onClose={() => setRatingModal(false)} title={isEn ? 'Rate the collector' : 'Évaluer le collecteur'}>
        <div className="flex flex-col gap-4">
          <div className="text-center">
            <p className="text-sm text-gray-500 mb-3">
              {isEn ? 'Collector:' : 'Collecteur :'} <strong>{req.collector_name}</strong>
            </p>
            <div className="flex justify-center gap-2">
              {[1,2,3,4,5].map(n => (
                <button key={n} type="button" onClick={() => setScore(n)}
                  className={`text-3xl transition-transform hover:scale-125 ${n <= score ? 'text-yellow-400' : 'text-gray-300'}`}>★</button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">{score}/5</p>
          </div>
          <textarea className="input resize-none min-h-[80px]"
            placeholder={isEn ? 'Optional comment...' : 'Commentaire optionnel...'}
            value={comment} onChange={e => setComment(e.target.value)} />
          <div className="flex gap-3">
            <button onClick={() => setRatingModal(false)} className="btn-ghost flex-1 justify-center border border-gray-200">{t('common.cancel')}</button>
            <button onClick={handleRating} className="btn-primary flex-1 justify-center">{t('common.send')}</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
