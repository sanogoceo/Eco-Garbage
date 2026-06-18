import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  Award,
  CheckCircle,
  Image as ImageIcon,
  MapPin,
  ShieldCheck,
  Star,
  Truck,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { enUS, fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { adminApi } from '../../services/api'
import { Modal, PageLoader, StatCard } from '../../components/common'
import AdminStepUpModal from '../../components/common/AdminStepUpModal'

const VERIFICATION_COLORS = {
  verified: 'bg-green-100 text-green-700',
  submitted: 'bg-blue-100 text-blue-700',
  pending: 'bg-yellow-100 text-yellow-700',
  rejected: 'bg-red-100 text-red-600',
}

const DOCUMENTS = {
  fr: [
    { type: 'profile_photo', label: 'Photo de profil' },
    { type: 'id_front', label: 'CNI - Recto' },
    { type: 'id_back', label: 'CNI - Verso' },
    { type: 'selfie_with_id', label: 'Selfie avec CNI' },
    { type: 'vehicle_photo', label: 'Photo du moyen de transport' },
  ],
  en: [
    { type: 'profile_photo', label: 'Profile photo' },
    { type: 'id_front', label: 'ID - Front' },
    { type: 'id_back', label: 'ID - Back' },
    { type: 'selfie_with_id', label: 'Selfie with ID' },
    { type: 'vehicle_photo', label: 'Vehicle photo' },
  ],
}

const GENDER_LABELS = {
  fr: {
    male: 'Masculin',
    female: 'Feminin',
    other: 'Autre',
    prefer_not_to_say: 'Non precise',
  },
  en: {
    male: 'Male',
    female: 'Female',
    other: 'Other',
    prefer_not_to_say: 'Not specified',
  },
}

const VEHICLE_LABELS = {
  fr: {
    foot: 'A pied',
    motorcycle: 'Moto',
    tricycle: 'Tricycle',
    car: 'Voiture',
    van: 'Camionnette',
  },
  en: {
    foot: 'On foot',
    motorcycle: 'Motorcycle',
    tricycle: 'Tricycle',
    car: 'Car',
    van: 'Van',
  },
}

function ImageModal({ src, title, onClose }) {
  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-3xl max-h-[90vh] overflow-auto"
        onClick={event => event.stopPropagation()}
      >
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
          >
            &times;
          </button>
        </div>
        <div className="p-4">
          <img
            src={src}
            alt={title}
            className="max-w-full max-h-[75vh] object-contain mx-auto"
          />
        </div>
      </div>
    </div>
  )
}

function DataField({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="font-medium text-gray-800 break-words">{value || '-'}</p>
    </div>
  )
}

export default function CollectorDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const isEn = i18n.language?.startsWith('en')
  const language = isEn ? 'en' : 'fr'
  const dateLocale = isEn ? enUS : fr
  const [collector, setCollector] = useState(null)
  const [documents, setDocuments] = useState({})
  const [loading, setLoading] = useState(true)
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [documentsError, setDocumentsError] = useState(false)
  const [imgModal, setImgModal] = useState(null)
  const [certificationModal, setCertificationModal] = useState(false)
  const [certificationStepUp, setCertificationStepUp] = useState(false)
  const [certificationForm, setCertificationForm] = useState({
    status: 'none',
    certificate_number: '',
    issued_at: '',
    expires_at: '',
    notes: '',
  })

  useEffect(() => {
    let active = true
    const objectUrls = []

    const load = async () => {
      setLoading(true)
      setDocuments({})
      setDocumentsError(false)

      try {
        const response = await adminApi.getCollectorDetails(id)
        const detail = response.data.data
        if (!active) return
        setCollector(detail)

        const application = detail.collector_application
        const availableDocuments = Object.entries(application?.documents || {})
          .filter(([, exists]) => exists)

        if (availableDocuments.length > 0) {
          setDocumentsLoading(true)
          const results = await Promise.allSettled(
            availableDocuments.map(async ([type]) => {
              const documentResponse = await adminApi.collectorApplicationDocument(
                application.uuid,
                type
              )
              if (!active) return null
              const url = URL.createObjectURL(documentResponse.data)
              objectUrls.push(url)
              return [type, url]
            })
          )

          if (active) {
            const loadedDocuments = results
              .filter(result => result.status === 'fulfilled' && result.value)
              .map(result => result.value)
            setDocuments(Object.fromEntries(loadedDocuments))
            setDocumentsError(loadedDocuments.length !== availableDocuments.length)
          }
        }
      } catch {
        if (active) {
          toast.error(isEn ? 'Collector not found' : 'Collecteur introuvable')
          navigate('/admin/users')
        }
      } finally {
        if (active) {
          setLoading(false)
          setDocumentsLoading(false)
        }
      }
    }

    load()
    return () => {
      active = false
      objectUrls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [id, isEn, navigate])

  if (loading) return <PageLoader />
  if (!collector) return null

  const cp = collector.collector_profile || {}
  const application = collector.collector_application
  const initials = collector.name
    ?.split(' ')
    .map(name => name[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'C'
  const profilePhoto = documents.profile_photo
  const verificationLabel = {
    verified: isEn ? 'Verified' : 'Verifie',
    submitted: isEn ? 'Submitted' : 'Soumis',
    pending: isEn ? 'Pending' : 'En attente',
    rejected: isEn ? 'Rejected' : 'Rejete',
  }[cp.verification_status] || cp.verification_status

  const formatDate = value => (
    value ? format(new Date(value), 'dd MMM yyyy', { locale: dateLocale }) : '-'
  )
  const certification = cp.hazardous_certification || {}
  const certificationValid = certification.status === 'verified'
    && certification.expires_at
    && new Date(certification.expires_at) > new Date()

  const openCertification = () => {
    setCertificationForm({
      status: certification.status || 'none',
      certificate_number: certification.certificate_number || '',
      issued_at: certification.issued_at
        ? new Date(certification.issued_at).toISOString().slice(0, 10)
        : '',
      expires_at: certification.expires_at
        ? new Date(certification.expires_at).toISOString().slice(0, 10)
        : '',
      notes: certification.notes || '',
    })
    setCertificationModal(true)
  }

  const requestCertificationSave = () => {
    if (
      certificationForm.status === 'verified'
      && (
        certificationForm.certificate_number.trim().length < 3
        || !certificationForm.issued_at
        || !certificationForm.expires_at
      )
    ) {
      toast.error(isEn
        ? 'Certificate number and validity dates are required'
        : 'Le numéro et les dates de validité du certificat sont requis')
      return
    }
    setCertificationStepUp(true)
  }

  const saveCertification = async (stepUpToken) => {
    try {
      const response = await adminApi.updateHazardousCertification(
        id,
        certificationForm,
        stepUpToken
      )
      setCollector(current => ({
        ...current,
        collector_profile: {
          ...current.collector_profile,
          hazardous_certification: response.data.data,
        },
      }))
      setCertificationModal(false)
      toast.success(isEn
        ? 'Hazardous waste certification updated'
        : 'Certification déchets dangereux mise à jour')
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn
        ? 'Unable to update the certification'
        : 'Impossible de mettre à jour la certification'))
      throw error
    }
  }

  return (
    <div className="fade-up max-w-5xl mx-auto">
      <button
        onClick={() => navigate('/admin/users')}
        className="btn-ghost p-2 mb-4 -ml-1 flex items-center gap-2"
      >
        <ArrowLeft size={18} />
        {isEn ? 'Back to users' : 'Retour aux utilisateurs'}
      </button>

      <div className="card p-6 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
          <button
            type="button"
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden bg-[#E8F5EE] flex-shrink-0 flex items-center justify-center border-4 border-[#1A8A3C]"
            onClick={() => profilePhoto && setImgModal({
              src: profilePhoto,
              title: isEn ? 'Profile photo' : 'Photo de profil',
            })}
          >
            {profilePhoto ? (
              <img
                src={profilePhoto}
                alt={collector.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-3xl font-bold text-[#1A8A3C] font-display">
                {initials}
              </span>
            )}
          </button>

          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-display font-bold text-gray-900">
              {application?.full_name || collector.name}
            </h1>
            <p className="text-sm text-gray-400">{collector.email}</p>
            <p className="text-sm text-gray-500 mt-0.5">
              {application?.phone || collector.phone || '-'}
            </p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`badge ${VERIFICATION_COLORS[cp.verification_status] || 'bg-gray-100 text-gray-500'}`}>
                {cp.verification_status === 'verified'
                  ? <ShieldCheck size={12} />
                  : <AlertCircle size={12} />}
                {verificationLabel}
              </span>
              <span className={`badge ${cp.is_available ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {cp.is_available
                  ? (isEn ? 'Available' : 'Disponible')
                  : (isEn ? 'Offline' : 'Hors ligne')}
              </span>
              <span className={`badge ${collector.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                {collector.is_active
                  ? (isEn ? 'Active' : 'Actif')
                  : (isEn ? 'Suspended' : 'Suspendu')}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
        <StatCard
          icon={Truck}
          label={isEn ? 'Total collections' : 'Total collectes'}
          value={collector.stats?.totalRequests ?? 0}
          color="green"
        />
        <StatCard
          icon={CheckCircle}
          label={isEn ? 'Completed' : 'Terminees'}
          value={collector.stats?.completedRequests ?? 0}
          color="blue"
        />
        <StatCard
          icon={Star}
          label={isEn ? 'Avg rating' : 'Note moyenne'}
          value={cp.rating_avg ? `${Number(cp.rating_avg).toFixed(1)}/5` : '-'}
          color="yellow"
        />
      </div>

      <section className={`card p-5 mb-5 border ${
        certificationValid
          ? 'border-green-200 bg-green-50/40'
          : 'border-amber-200 bg-amber-50/40'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              certificationValid
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              <Award size={20} />
            </div>
            <div>
              <h2 className="font-display font-bold">
                {isEn ? 'Hazardous waste certification' : 'Certification déchets dangereux'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {certificationValid
                  ? (isEn
                    ? `Valid until ${formatDate(certification.expires_at)}`
                    : `Valide jusqu au ${formatDate(certification.expires_at)}`)
                  : (isEn
                    ? 'This collector cannot receive hazardous waste jobs.'
                    : 'Ce collecteur ne peut pas recevoir de missions de déchets dangereux.')}
              </p>
              {certification.certificate_number && (
                <p className="text-xs text-gray-400 mt-1">
                  {isEn ? 'Certificate' : 'Certificat'}: {certification.certificate_number}
                </p>
              )}
            </div>
          </div>
          <button type="button" onClick={openCertification} className="btn-outline justify-center">
            {isEn ? 'Manage certification' : 'Gérer la certification'}
          </button>
        </div>
      </section>

      {!application && (
        <div className="card p-5 mb-5 bg-amber-50 border border-amber-200 text-amber-800">
          <p className="font-semibold">
            {isEn ? 'No approved application found' : 'Aucun dossier approuve trouve'}
          </p>
          <p className="text-sm mt-1">
            {isEn
              ? 'This may be a legacy collector account created before the application workflow.'
              : 'Il peut s agir d un ancien compte collecteur cree avant le workflow de candidature.'}
          </p>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 flex flex-col gap-5">
          <section className="card p-6">
            <h2 className="font-display font-bold mb-4">
              {isEn ? 'Personal information' : 'Informations personnelles'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <DataField
                label={isEn ? 'Full name' : 'Nom complet'}
                value={application?.full_name || collector.name}
              />
              <DataField
                label={isEn ? 'National ID number' : 'Numero de CNI'}
                value={application?.national_id_number}
              />
              <DataField
                label={isEn ? 'ID expiry date' : 'Date d expiration de la CNI'}
                value={formatDate(application?.national_id_expiry_date)}
              />
              <DataField
                label={isEn ? 'Date of birth' : 'Date de naissance'}
                value={formatDate(application?.birth_date)}
              />
              <DataField
                label={isEn ? 'Gender' : 'Sexe'}
                value={GENDER_LABELS[language][application?.gender]}
              />
              <DataField label="Email" value={collector.email} />
              <DataField
                label={isEn ? 'Phone' : 'Telephone'}
                value={application?.phone || collector.phone}
              />
            </div>
          </section>

          <section className="card p-6">
            <h2 className="font-display font-bold mb-4">
              {isEn ? 'Address and collection activity' : 'Adresse et activite de collecte'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <DataField label={isEn ? 'City' : 'Ville'} value={application?.city} />
              <DataField
                label={isEn ? 'Neighborhood' : 'Quartier'}
                value={application?.neighborhood}
              />
              <DataField
                label={isEn ? 'Residential address' : 'Adresse de residence'}
                value={application?.residence_address || collector.address}
              />
              <DataField
                label={isEn ? 'Collection area' : 'Zone de collecte'}
                value={application?.service_area || cp.service_area}
              />
              <DataField
                label={isEn ? 'Transport' : 'Moyen de transport'}
                value={
                  VEHICLE_LABELS[language][application?.vehicle_type || cp.vehicle_type]
                  || application?.vehicle_type
                  || cp.vehicle_type
                }
              />
              <DataField
                label={isEn ? 'Plate number' : 'Immatriculation'}
                value={application?.vehicle_plate || cp.vehicle_plate}
              />
            </div>

            {cp.last_location_update && (
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-400">
                <MapPin size={12} />
                {isEn ? 'Last GPS update:' : 'Derniere mise a jour GPS :'}{' '}
                {format(
                  new Date(cp.last_location_update),
                  'dd MMM yyyy HH:mm',
                  { locale: dateLocale }
                )}
              </div>
            )}
          </section>

          <section className="card p-6">
            <h2 className="font-display font-bold mb-4">
              {isEn ? 'Security and account' : 'Securite et compte'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <DataField
                label={isEn ? 'Emergency contact' : 'Contact d urgence'}
                value={application?.emergency_contact?.name}
              />
              <DataField
                label={isEn ? 'Emergency phone' : 'Telephone d urgence'}
                value={application?.emergency_contact?.phone}
              />
              <DataField
                label={isEn ? 'Registered on' : 'Inscrit le'}
                value={formatDate(collector.created_at)}
              />
              <DataField
                label={isEn ? 'Application approved on' : 'Dossier approuve le'}
                value={formatDate(application?.reviewed_at)}
              />
              <DataField
                label={isEn ? 'Verification valid until' : 'Verification valide jusqu au'}
                value={formatDate(
                  application?.verification_valid_until
                  || cp.verification_expires_at
                )}
              />
              <DataField
                label={isEn ? 'Email verified' : 'Email verifie'}
                value={collector.is_verified ? (isEn ? 'Yes' : 'Oui') : (isEn ? 'No' : 'Non')}
              />
              <DataField
                label={isEn ? 'Privacy consent' : 'Consentement confidentialite'}
                value={application?.consent?.accepted
                  ? (isEn ? 'Accepted' : 'Accepte')
                  : '-'}
              />
            </div>

            {(application?.review_notes || cp.verification_notes) && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-1">
                  {isEn ? 'Verification notes' : 'Notes de verification'}
                </p>
                <p className="text-sm text-gray-600 italic">
                  {application?.review_notes || cp.verification_notes}
                </p>
              </div>
            )}

            {application?.identity_verification && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-2">
                  {isEn ? 'Identity controls' : 'Controles d identite'}
                </p>
                <div className="grid sm:grid-cols-2 gap-2 text-xs">
                  {[
                    [application.identity_verification.profile_matches_selfie, isEn ? 'Profile / selfie match' : 'Photo / selfie concordants'],
                    [application.identity_verification.selfie_matches_id, isEn ? 'Selfie / ID match' : 'Selfie / CNI concordants'],
                    [application.identity_verification.id_readable, isEn ? 'ID readable' : 'CNI lisible'],
                    [application.identity_verification.id_not_expired, isEn ? 'ID valid' : 'CNI valide'],
                  ].map(([valid, label]) => (
                    <span
                      key={label}
                      className={`rounded-lg px-3 py-2 font-semibold ${
                        valid
                          ? 'bg-green-50 text-green-700'
                          : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {valid ? 'OK' : 'Non'} - {label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          <h2 className="font-display font-bold flex items-center gap-2">
            <ShieldCheck size={16} className="text-[#1A8A3C]" />
            {isEn ? 'Secure documents' : 'Documents securises'}
          </h2>

          <p className="text-xs text-gray-400">
            {isEn
              ? 'Each consultation is protected and recorded in the audit log.'
              : 'Chaque consultation est protegee et enregistree dans le journal d audit.'}
          </p>

          {documentsLoading && (
            <p className="text-sm text-gray-400">
              {isEn ? 'Loading documents...' : 'Chargement des documents...'}
            </p>
          )}

          {documentsError && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
              {isEn
                ? 'Some documents could not be loaded.'
                : 'Certains documents n ont pas pu etre charges.'}
            </div>
          )}

          {DOCUMENTS[language].map(({ type, label }) => {
            const url = documents[type]
            const wasProvided = application?.documents?.[type]

            return url ? (
              <button
                key={type}
                type="button"
                onClick={() => setImgModal({ src: url, title: label })}
                className="w-full bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition group text-left"
              >
                <div className="aspect-video bg-gray-50 overflow-hidden flex items-center justify-center">
                  <img
                    src={url}
                    alt={label}
                    className="w-full h-full object-cover group-hover:scale-105 transition"
                  />
                </div>
                <div className="p-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <ImageIcon size={14} />
                  {label}
                </div>
              </button>
            ) : (
              <div
                key={type}
                className="w-full bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 p-4 text-center"
              >
                <ImageIcon className="mx-auto text-gray-300 mb-1" size={28} />
                <p className="text-xs text-gray-400">
                  {label} - {wasProvided
                    ? (isEn ? 'unavailable' : 'indisponible')
                    : (isEn ? 'not provided or expired' : 'non fourni ou expire')}
                </p>
              </div>
            )
          })}

          {application?.documents_delete_at && (
            <p className="text-xs text-gray-400">
              {isEn ? 'Scheduled deletion:' : 'Suppression programmee :'}{' '}
              {formatDate(application.documents_delete_at)}
            </p>
          )}
        </aside>
      </div>

      {imgModal && (
        <ImageModal
          src={imgModal.src}
          title={imgModal.title}
          onClose={() => setImgModal(null)}
        />
      )}

      <Modal
        isOpen={certificationModal}
        onClose={() => setCertificationModal(false)}
        title={isEn ? 'Hazardous waste certification' : 'Certification déchets dangereux'}
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="label">{isEn ? 'Status' : 'Statut'}</label>
            <select
              className="input"
              value={certificationForm.status}
              onChange={event => setCertificationForm(current => ({
                ...current,
                status: event.target.value,
              }))}
            >
              <option value="none">{isEn ? 'Not certified' : 'Non certifié'}</option>
              <option value="pending">{isEn ? 'Pending review' : 'En vérification'}</option>
              <option value="verified">{isEn ? 'Verified' : 'Certifié'}</option>
              <option value="rejected">{isEn ? 'Rejected' : 'Refusé'}</option>
            </select>
          </div>

          {certificationForm.status === 'verified' && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="label">
                  {isEn ? 'Certificate number' : 'Numéro du certificat'} *
                </label>
                <input
                  className="input"
                  value={certificationForm.certificate_number}
                  onChange={event => setCertificationForm(current => ({
                    ...current,
                    certificate_number: event.target.value,
                  }))}
                />
              </div>
              <div>
                <label className="label">{isEn ? 'Issue date' : 'Date de délivrance'} *</label>
                <input
                  type="date"
                  className="input"
                  value={certificationForm.issued_at}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={event => setCertificationForm(current => ({
                    ...current,
                    issued_at: event.target.value,
                  }))}
                />
              </div>
              <div>
                <label className="label">{isEn ? 'Expiry date' : 'Date d expiration'} *</label>
                <input
                  type="date"
                  className="input"
                  value={certificationForm.expires_at}
                  min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                  onChange={event => setCertificationForm(current => ({
                    ...current,
                    expires_at: event.target.value,
                  }))}
                />
              </div>
            </div>
          )}

          <div>
            <label className="label">{isEn ? 'Administrative notes' : 'Notes administratives'}</label>
            <textarea
              className="input resize-none"
              rows={3}
              maxLength={500}
              value={certificationForm.notes}
              onChange={event => setCertificationForm(current => ({
                ...current,
                notes: event.target.value,
              }))}
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setCertificationModal(false)}
              className="btn-ghost flex-1 justify-center border border-gray-200"
            >
              {isEn ? 'Cancel' : 'Annuler'}
            </button>
            <button type="button" onClick={requestCertificationSave} className="btn-primary flex-1 justify-center">
              {isEn ? 'Save' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </Modal>

      <AdminStepUpModal
        isOpen={certificationStepUp}
        onClose={() => setCertificationStepUp(false)}
        scope="collector_review"
        title={isEn ? 'Confirm certification' : 'Confirmer la certification'}
        description={isEn
          ? 'This decision controls access to hazardous waste jobs.'
          : 'Cette décision contrôle l accès aux missions de déchets dangereux.'}
        onVerified={saveCertification}
      />
    </div>
  )
}
