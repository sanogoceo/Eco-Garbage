import { useCallback, useEffect, useState } from 'react'
import { CheckCircle, Eye, FileCheck2, RefreshCw, ShieldX } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { adminApi } from '../../services/api'
import { EmptyState, Modal, PageHeader, PageLoader, Spinner } from '../../components/common'
import AdminStepUpModal from '../../components/common/AdminStepUpModal'

const STATUS_STYLES = {
  submitted: 'bg-amber-100 text-amber-700',
  under_review: 'bg-blue-100 text-blue-700',
  changes_requested: 'bg-red-100 text-red-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

const STATUS_LABELS = {
  fr: { submitted: 'En attente', under_review: 'En verification', changes_requested: 'Documents demandes', approved: 'Approuve', rejected: 'Refuse' },
  en: { submitted: 'Pending', under_review: 'Under review', changes_requested: 'Documents requested', approved: 'Approved', rejected: 'Rejected' },
}

const GENDER_LABELS = {
  fr: { male: 'Masculin', female: 'Feminin', other: 'Autre', prefer_not_to_say: 'Non precise' },
  en: { male: 'Male', female: 'Female', other: 'Other', prefer_not_to_say: 'Not specified' },
}

const VEHICLE_LABELS = {
  fr: { foot: 'A pied', motorcycle: 'Moto', tricycle: 'Tricycle', car: 'Voiture', van: 'Camionnette' },
  en: { foot: 'On foot', motorcycle: 'Motorcycle', tricycle: 'Tricycle', car: 'Car', van: 'Van' },
}

const DOCUMENT_LABELS = {
  fr: {
    profile_photo: 'Photo d identite',
    id_front: 'CNI recto',
    id_back: 'CNI verso',
    selfie_with_id: 'Selfie avec CNI',
    vehicle_photo: 'Photo du transport',
  },
  en: {
    profile_photo: 'Identity photo',
    id_front: 'ID front',
    id_back: 'ID back',
    selfie_with_id: 'Selfie with ID',
    vehicle_photo: 'Transport photo',
  },
}

const EMPTY_IDENTITY_CHECKS = {
  profile_matches_selfie: false,
  selfie_matches_id: false,
  id_readable: false,
  id_not_expired: false,
}

function DataField({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="font-medium text-gray-800 break-words">{value || '-'}</p>
    </div>
  )
}

export default function CollectorApplications() {
  const { i18n } = useTranslation()
  const isEn = i18n.language?.startsWith('en')
  const language = isEn ? 'en' : 'fr'
  const [applications, setApplications] = useState([])
  const [filter, setFilter] = useState('submitted')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [documents, setDocuments] = useState({})
  const [notes, setNotes] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [pendingDecision, setPendingDecision] = useState('')
  const [identityChecks, setIdentityChecks] = useState(EMPTY_IDENTITY_CHECKS)
  const [replacementTypes, setReplacementTypes] = useState([])
  const [replacementReason, setReplacementReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await adminApi.collectorApplications(filter ? { status: filter } : {})
      setApplications(response.data.data || [])
    } catch {
      toast.error(isEn ? 'Unable to load applications' : 'Impossible de charger les candidatures')
    } finally {
      setLoading(false)
    }
  }, [filter, isEn])

  useEffect(() => {
    load()
  }, [load])

  const closeDetails = () => {
    Object.values(documents).forEach((url) => URL.revokeObjectURL(url))
    setDocuments({})
    setSelected(null)
    setNotes('')
    setIdentityChecks(EMPTY_IDENTITY_CHECKS)
    setReplacementTypes([])
    setReplacementReason('')
  }

  const openDetails = async (application) => {
    setDetailsLoading(true)
    setSelected(application)
    try {
      const detailResponse = await adminApi.collectorApplication(application.uuid)
      const detail = detailResponse.data.data
      setSelected(detail)
      setNotes(detail.review_notes || '')
      setIdentityChecks({
        profile_matches_selfie: Boolean(detail.identity_verification?.profile_matches_selfie),
        selfie_matches_id: Boolean(detail.identity_verification?.selfie_matches_id),
        id_readable: Boolean(detail.identity_verification?.id_readable),
        id_not_expired: Boolean(detail.identity_verification?.id_not_expired),
      })

      const documentLoadResults = await Promise.allSettled(
        Object.entries(detail.documents || {})
          .filter(([, exists]) => exists)
          .map(async ([type]) => {
            const response = await adminApi.collectorApplicationDocument(detail.uuid, type)
            return [type, URL.createObjectURL(response.data)]
          })
      )
      const entries = documentLoadResults
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value)
      if (!entries.length && Object.entries(detail.documents || {}).some(([, exists]) => exists)) {
        console.warn('Failed to load collector application documents', documentLoadResults)
      }
      setDocuments(Object.fromEntries(entries))
    } catch {
      toast.error(isEn ? 'Unable to open this application' : 'Impossible d ouvrir ce dossier')
      setSelected(null)
    } finally {
      setDetailsLoading(false)
    }
  }

  const requestReview = (decision) => {
    if (decision === 'request_documents') {
      if (!replacementTypes.length) {
        return toast.error(
          isEn ? 'Select at least one document' : 'Selectionnez au moins un document'
        )
      }
      if (replacementReason.trim().length < 10) {
        return toast.error(
          isEn
            ? 'Explain why the documents must be replaced'
            : 'Expliquez pourquoi les documents doivent etre remplaces'
        )
      }
    }
    if (decision === 'rejected' && !notes.trim()) {
      return toast.error(isEn ? 'A rejection reason is required' : 'Le motif du refus est obligatoire')
    }
    if (
      decision === 'approved'
      && Object.values(identityChecks).some(value => value !== true)
    ) {
      return toast.error(
        isEn
          ? 'Complete all identity checks before approval'
          : 'Completez tous les controles d identite avant l approbation'
      )
    }
    setPendingDecision(decision)
  }

  const review = async (stepUpToken) => {
    const decision = pendingDecision
    setReviewing(true)
    try {
      if (decision === 'request_documents') {
        await adminApi.requestCollectorDocuments(
          selected.uuid,
          {
            document_types: replacementTypes,
            reason: replacementReason.trim(),
          },
          stepUpToken
        )
        toast.success(
          isEn
            ? 'Replacement request sent'
            : 'Demande de remplacement envoyee'
        )
      } else {
        await adminApi.reviewCollectorApplication(
          selected.uuid,
          {
            decision,
            notes,
            identity_verification: identityChecks,
          },
          stepUpToken
        )
        toast.success(decision === 'approved'
          ? (isEn ? 'Application approved' : 'Candidature approuvee')
          : (isEn ? 'Application rejected' : 'Candidature refusee'))
      }
      closeDetails()
      setPendingDecision('')
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || (isEn ? 'Review failed' : 'La decision a echoue'))
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div className="fade-up">
      <PageHeader
        title={isEn ? 'Collector applications' : 'Candidatures collecteur'}
        subtitle={isEn ? 'Review identity, address and collection activity' : 'Verifiez l identite, l adresse et l activite de collecte'}
      />

      <div className="flex gap-2 mb-6 flex-wrap">
        {['', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected'].map((status) => (
          <button
            key={status || 'all'}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
              filter === status ? 'bg-[#1A8A3C] text-white' : 'bg-white text-gray-500 border border-gray-200'
            }`}
          >
            {status ? STATUS_LABELS[language][status] : (isEn ? 'All' : 'Toutes')}
          </button>
        ))}
      </div>

      {loading ? <PageLoader /> : applications.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title={isEn ? 'No applications' : 'Aucune candidature'}
          description={isEn ? 'No application matches this filter.' : 'Aucun dossier ne correspond a ce filtre.'}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {[isEn ? 'Applicant' : 'Candidat', isEn ? 'Area' : 'Zone', isEn ? 'Transport' : 'Transport', isEn ? 'Status' : 'Statut', isEn ? 'Submitted' : 'Soumis le', ''].map((label, index) => (
                    <th key={`${label}-${index}`} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {applications.map((application) => (
                  <tr key={application.uuid} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-800">{application.full_name || application.user?.name}</p>
                      <p className="text-xs text-gray-400">{application.user?.email}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{application.service_area}</td>
                    <td className="px-4 py-3 text-gray-600">{VEHICLE_LABELS[language][application.vehicle_type] || application.vehicle_type}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${STATUS_STYLES[application.status]}`}>
                        {STATUS_LABELS[language][application.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {new Date(application.submitted_at).toLocaleDateString(isEn ? 'en-US' : 'fr-FR')}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => openDetails(application)} className="btn-ghost p-2" title={isEn ? 'Open' : 'Ouvrir'}>
                        <Eye size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={!!selected} onClose={closeDetails} title={isEn ? 'Collector application' : 'Dossier collecteur'} size="xl">
        {detailsLoading ? <PageLoader /> : selected && (
          <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
            <section>
              <h3 className="font-display font-bold text-gray-900 mb-3">
                {isEn ? 'Personal information' : 'Informations personnelles'}
              </h3>
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                <DataField label={isEn ? 'Full name' : 'Nom(s) et prenom(s)'} value={selected.full_name || selected.user?.name} />
                <DataField label="Email" value={selected.user?.email} />
                <DataField label={isEn ? 'Phone' : 'Telephone'} value={selected.phone} />
                <DataField
                  label={isEn ? 'Date of birth' : 'Date de naissance'}
                  value={selected.birth_date ? new Date(selected.birth_date).toLocaleDateString(isEn ? 'en-US' : 'fr-FR') : '-'}
                />
                <DataField label={isEn ? 'Gender' : 'Sexe'} value={GENDER_LABELS[language][selected.gender]} />
                <DataField label={isEn ? 'National ID number' : 'Numero de CNI'} value={selected.national_id_number} />
                <DataField
                  label={isEn ? 'ID expiry date' : 'Date d expiration de la CNI'}
                  value={selected.national_id_expiry_date
                    ? new Date(selected.national_id_expiry_date).toLocaleDateString(isEn ? 'en-US' : 'fr-FR')
                    : '-'}
                />
                <DataField
                  label={isEn ? 'Application type' : 'Type de dossier'}
                  value={selected.application_type === 'renewal'
                    ? (isEn ? 'Renewal' : 'Renouvellement')
                    : (isEn ? 'Initial application' : 'Premiere candidature')}
                />
              </div>
            </section>

            <section className="border-t border-gray-100 pt-5">
              <h3 className="font-display font-bold text-gray-900 mb-3">
                {isEn ? 'Address and activity' : 'Adresse et activite'}
              </h3>
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                <DataField label={isEn ? 'City' : 'Ville'} value={selected.city} />
                <DataField label={isEn ? 'Neighborhood' : 'Quartier'} value={selected.neighborhood} />
                <DataField label={isEn ? 'Residential address' : 'Adresse de residence'} value={selected.residence_address} />
                <DataField label={isEn ? 'Collection area' : 'Zone de collecte'} value={selected.service_area} />
                <DataField label={isEn ? 'Transport' : 'Moyen de transport'} value={VEHICLE_LABELS[language][selected.vehicle_type] || selected.vehicle_type} />
              </div>
            </section>

            <section className="border-t border-gray-100 pt-5">
              <h3 className="font-display font-bold text-gray-900 mb-3">{isEn ? 'Security' : 'Securite'}</h3>
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                <DataField label={isEn ? 'Emergency contact' : 'Contact d urgence'} value={selected.emergency_contact?.name} />
                <DataField label={isEn ? 'Emergency phone' : 'Telephone d urgence'} value={selected.emergency_contact?.phone} />
                <DataField
                  label={isEn ? 'Privacy consent' : 'Consentement confidentialite'}
                  value={selected.consent?.accepted ? (isEn ? 'Accepted' : 'Accepte') : '-'}
                />
                <DataField
                  label={isEn ? 'Accepted at' : 'Accepte le'}
                  value={selected.consent?.accepted_at
                    ? new Date(selected.consent.accepted_at).toLocaleString(isEn ? 'en-US' : 'fr-FR')
                    : '-'}
                />
              </div>
            </section>

            <section className="border-t border-gray-100 pt-5">
              <h3 className="font-display font-bold text-gray-900 mb-3">
                {isEn ? 'Supporting documents' : 'Pieces justificatives'}
              </h3>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(documents).map(([type, url]) => (
                  <div key={type}>
                    <p className="text-xs font-semibold text-gray-500 mb-2">{DOCUMENT_LABELS[language][type] || type}</p>
                    <a href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt="" className="w-full aspect-video object-cover rounded-xl border border-gray-200" />
                    </a>
                  </div>
                ))}
              </div>
            </section>

            {['submitted', 'under_review'].includes(selected.status) ? (
              <section className="border-t border-gray-100 pt-5">
                <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <h3 className="font-display font-bold text-amber-900 flex items-center gap-2">
                    <RefreshCw size={17} />
                    {isEn ? 'Request document replacement' : 'Demander le remplacement de documents'}
                  </h3>
                  <p className="text-xs text-amber-700 mt-1 mb-3">
                    {isEn
                      ? 'The application stays open. Only the selected documents must be uploaded again.'
                      : 'Le dossier reste ouvert. Seules les pieces selectionnees devront etre renvoyees.'}
                  </p>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {Object.entries(DOCUMENT_LABELS[language]).map(([type, label]) => (
                      <label
                        key={type}
                        className="flex items-center gap-2 rounded-lg bg-white border border-amber-200 px-3 py-2 text-sm text-amber-900 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          className="accent-amber-600"
                          checked={replacementTypes.includes(type)}
                          onChange={(event) => setReplacementTypes(current => (
                            event.target.checked
                              ? [...current, type]
                              : current.filter(item => item !== type)
                          ))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <textarea
                    className="input resize-none mt-3 bg-white"
                    rows={3}
                    placeholder={isEn
                      ? 'Example: ID front is blurry and unreadable...'
                      : 'Exemple : le recto de la CNI est flou et illisible...'}
                    value={replacementReason}
                    onChange={event => setReplacementReason(event.target.value)}
                  />
                  <button
                    disabled={reviewing}
                    onClick={() => requestReview('request_documents')}
                    className="btn-outline justify-center w-full mt-3 text-amber-700 border-amber-300"
                  >
                    {reviewing ? <Spinner size="sm" /> : <RefreshCw size={16} />}
                    {isEn ? 'Request selected documents' : 'Demander les pieces selectionnees'}
                  </button>
                </div>
                <div className="mb-5">
                  <h3 className="font-display font-bold text-gray-900 mb-2">
                    {isEn ? 'Mandatory identity comparison' : 'Comparaison d identite obligatoire'}
                  </h3>
                  <p className="text-xs text-gray-500 mb-3">
                    {isEn
                      ? 'Compare the profile photo, selfie and ID manually. Automated facial recognition is not used to make the decision.'
                      : 'Comparez manuellement la photo de profil, le selfie et la CNI. Aucune reconnaissance faciale automatique ne prend la decision.'}
                  </p>
                  {selected.national_id_expiry_date
                    && new Date(selected.national_id_expiry_date) <= new Date() && (
                    <div className="mb-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 font-semibold">
                      {isEn ? 'The ID is expired. Approval is blocked.' : 'La CNI est expiree. L approbation est bloquee.'}
                    </div>
                  )}
                  <div className="grid sm:grid-cols-2 gap-3">
                    {[
                      ['profile_matches_selfie', isEn ? 'Profile photo matches selfie' : 'La photo de profil correspond au selfie'],
                      ['selfie_matches_id', isEn ? 'Selfie matches ID portrait' : 'Le selfie correspond au portrait de la CNI'],
                      ['id_readable', isEn ? 'ID is clear and readable' : 'La CNI est nette et lisible'],
                      ['id_not_expired', isEn ? 'ID is not expired' : 'La CNI n est pas expiree'],
                    ].map(([key, label]) => (
                      <label
                        key={key}
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                          identityChecks[key]
                            ? 'bg-green-50 border-green-200 text-green-800'
                            : 'bg-white border-gray-200 text-gray-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 w-4 h-4 accent-[#1A8A3C]"
                          checked={identityChecks[key]}
                          disabled={
                            key === 'id_not_expired'
                            && selected.national_id_expiry_date
                            && new Date(selected.national_id_expiry_date) <= new Date()
                          }
                          onChange={(event) => setIdentityChecks(current => ({
                            ...current,
                            [key]: event.target.checked,
                          }))}
                        />
                        <span className="text-sm font-medium">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <label className="label">
                  {isEn ? 'Decision note (required for rejection)' : 'Note de decision (obligatoire pour un refus)'}
                </label>
                <textarea className="input resize-none" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
                <div className="grid sm:grid-cols-2 gap-3 mt-4">
                  <button disabled={reviewing} onClick={() => requestReview('rejected')} className="btn-outline justify-center text-red-600 border-red-200">
                    {reviewing ? <Spinner size="sm" /> : <ShieldX size={16} />}
                    {isEn ? 'Reject' : 'Refuser'}
                  </button>
                  <button disabled={reviewing} onClick={() => requestReview('approved')} className="btn-primary justify-center">
                    {reviewing ? <Spinner size="sm" /> : <CheckCircle size={16} />}
                    {isEn ? 'Approve' : 'Approuver'}
                  </button>
                </div>
              </section>
            ) : (
              <div className={`p-4 rounded-xl ${selected.status === 'approved' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                <p className="font-semibold">{STATUS_LABELS[language][selected.status]}</p>
                {selected.review_notes && <p className="text-sm mt-1">{selected.review_notes}</p>}
              </div>
            )}
          </div>
        )}
      </Modal>
      <AdminStepUpModal
        isOpen={!!pendingDecision}
        onClose={() => setPendingDecision('')}
        scope="collector_review"
        title={pendingDecision === 'request_documents'
          ? (isEn ? 'Confirm document replacement request' : 'Confirmer la demande de remplacement')
          : (isEn ? 'Confirm collector decision' : 'Confirmer la decision collecteur')}
        onVerified={review}
      />
    </div>
  )
}
