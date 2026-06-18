import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, Clock,
  FileText, MapPin, ShieldCheck, ShieldX, Truck, Upload, UserRound,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { collectorApplicationApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, PageLoader, Spinner } from '../../components/common'
import GuidedImageCrop from '../../components/common/GuidedImageCrop'
import { formatCmPhone, isValidCmPhone, normalizeCmPhone } from '../../utils/phone'
import { analyzeImageQuality, qualityMessage } from '../../utils/imageQuality'

const STATUS_STYLES = {
  submitted: 'bg-amber-100 text-amber-700',
  under_review: 'bg-blue-100 text-blue-700',
  changes_requested: 'bg-red-100 text-red-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

function ImageUpload({
  label, hint, file, onChange, optional = false,
  optionalLabel = 'optional', capture = 'environment',
  quality, analyzing = false, guided = false, isEn = false,
}) {
  const [preview, setPreview] = useState('')

  useEffect(() => {
    if (!file) {
      setPreview('')
      return undefined
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  return (
    <label className="group block cursor-pointer">
      <span className="label">
        {label} {!optional && <span className="text-red-500">*</span>}
        {optional && <span className="text-gray-400 font-normal"> ({optionalLabel})</span>}
      </span>
      <div className={`relative min-h-36 rounded-2xl border-2 border-dashed overflow-hidden transition ${
        quality && !quality.ok
          ? 'border-red-400 bg-red-50'
          : file
          ? 'border-[#1A8A3C] bg-[#E8F5EE]'
          : 'border-gray-200 bg-gray-50 group-hover:border-[#1A8A3C]/60 group-hover:bg-[#E8F5EE]/40'
      }`}>
        {preview ? (
          <>
            <img src={preview} alt="" className="w-full h-36 object-cover" />
            {guided && (
              <div className="absolute inset-3 border-2 border-dashed border-white rounded-lg shadow-[0_0_0_999px_rgba(0,0,0,0.18)]" />
            )}
            <div className="absolute inset-x-0 bottom-0 p-2 bg-black/55 text-white text-xs flex items-center gap-1.5">
              <CheckCircle2 size={14} /> {file.name}
            </div>
          </>
        ) : (
          <div className="h-36 flex flex-col items-center justify-center text-center px-4">
            <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center text-[#1A8A3C] mb-2">
              <Camera size={20} />
            </div>
            <p className="text-sm font-semibold text-gray-700">
              {isEn ? 'Add a photo' : 'Ajouter une photo'}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">{hint}</p>
          </div>
        )}
      </div>
      <input
        type="file"
        accept="image/jpeg,image/png"
        capture={capture}
        className="sr-only"
        onChange={(event) => {
          onChange(event.target.files?.[0] || null)
          event.target.value = ''
        }}
      />
      {analyzing && (
        <p className="text-xs text-blue-600 mt-2">
          {isEn ? 'Checking image quality...' : 'Analyse de la qualite de l image...'}
        </p>
      )}
      {quality && !analyzing && (
        <div className={`mt-2 rounded-xl p-3 text-xs ${
          quality.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          <p className="font-semibold">
            {quality.ok
              ? (isEn ? 'Quality check passed' : 'Controle qualite valide')
              : (isEn ? 'Photo must be retaken' : 'La photo doit etre reprise')}
          </p>
          {[...quality.errors, ...quality.warnings].map(code => (
            <p key={code} className="mt-1">{qualityMessage(code, isEn)}</p>
          ))}
          <p className="mt-1 opacity-75">
            {quality.metrics.width} x {quality.metrics.height} px
            {' | '}
            {isEn ? 'Light' : 'Lumiere'}: {quality.metrics.brightness}/255
            {' | '}
            {isEn ? 'Sharpness' : 'Nettete'}: {quality.metrics.sharpness}
          </p>
        </div>
      )}
    </label>
  )
}

export default function BecomeCollector() {
  const { i18n } = useTranslation()
  const isEn = i18n.language?.startsWith('en')
  const { user, fetchMe } = useAuth()
  const navigate = useNavigate()
  const [application, setApplication] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState(0)
  const [fieldErrors, setFieldErrors] = useState({})
  const [fileQuality, setFileQuality] = useState({})
  const [analyzingFiles, setAnalyzingFiles] = useState({})
  const [cropTarget, setCropTarget] = useState(null)
  const [form, setForm] = useState({
    full_name: user?.name || '',
    birth_date: '',
    gender: '',
    national_id_number: '',
    national_id_expiry_date: '',
    phone: user?.phone ? formatCmPhone(user.phone) : '',
    city: '',
    neighborhood: '',
    residence_address: user?.address || '',
    service_area: '',
    vehicle_type: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    consent_accepted: false,
  })
  const [files, setFiles] = useState({
    profile_photo: null,
    id_front: null,
    id_back: null,
    selfie_with_id: null,
    vehicle_photo: null,
  })

  const steps = useMemo(() => [
    { icon: UserRound, label: isEn ? 'Identity' : 'Identite' },
    { icon: FileText, label: isEn ? 'Documents' : 'Documents' },
    { icon: MapPin, label: isEn ? 'Activity' : 'Activite' },
    { icon: ShieldCheck, label: isEn ? 'Security' : 'Securite' },
  ], [isEn])

  const maxBirthDate = useMemo(() => {
    const date = new Date()
    date.setFullYear(date.getFullYear() - 18)
    return date.toISOString().slice(0, 10)
  }, [])

  const loadApplication = useCallback(async () => {
    const response = await collectorApplicationApi.current()
    const current = response.data.data
    setApplication(current)
    if (current?.status === 'approved' && user?.role !== 'collector') {
      await fetchMe()
      navigate('/collector', { replace: true })
    }
  }, [fetchMe, navigate, user?.role])

  useEffect(() => {
    loadApplication()
      .catch(() => toast.error(isEn ? 'Unable to load your application' : 'Impossible de charger votre candidature'))
      .finally(() => setLoading(false))
  }, [loadApplication, isEn])

  useEffect(() => {
    if (!application || !['submitted', 'under_review'].includes(application.status)) return undefined
    const interval = setInterval(() => loadApplication().catch(() => {}), 15000)
    return () => clearInterval(interval)
  }, [application, loadApplication])

  useEffect(() => {
    setForm((current) => ({
      ...current,
      full_name: current.full_name || user?.name || '',
      phone: current.phone || (user?.phone ? formatCmPhone(user.phone) : ''),
      residence_address: current.residence_address || user?.address || '',
    }))
  }, [user?.name, user?.phone, user?.address])

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      if (!current[key]) return current
      const nextErrors = { ...current }
      delete nextErrors[key]
      return nextErrors
    })
  }

  const inputClass = (key) => `input ${
    fieldErrors[key] ? 'border-red-400 bg-red-50 focus:border-red-500 focus:ring-red-100' : ''
  }`

  const FieldError = ({ name }) => (
    fieldErrors[name]
      ? <p className="text-xs text-red-600 mt-1" role="alert">{fieldErrors[name]}</p>
      : null
  )

  const showFieldErrors = (errors) => {
    setFieldErrors(errors)
    const firstField = Object.keys(errors)[0]
    toast.error(errors[firstField])
    requestAnimationFrame(() => {
      document.querySelector(`[name="${firstField}"]`)?.focus()
    })
  }
  const inspectAndStoreFile = async (key, value) => {
    setFiles((current) => ({ ...current, [key]: value }))
    setAnalyzingFiles((current) => ({ ...current, [key]: true }))
    try {
      const quality = await analyzeImageQuality(value, key)
      setFileQuality((current) => ({ ...current, [key]: quality }))
      if (!quality.ok) {
        toast.error(qualityMessage(quality.errors[0], isEn))
      } else if (quality.warnings.length) {
        toast(qualityMessage(quality.warnings[0], isEn))
      }
    } catch {
      setFileQuality((current) => ({
        ...current,
        [key]: {
          ok: false,
          errors: ['dimensions_too_small'],
          warnings: [],
          metrics: { width: 0, height: 0, brightness: 0, sharpness: 0 },
        },
      }))
      toast.error(isEn ? 'Unable to read this image' : 'Impossible de lire cette image')
    } finally {
      setAnalyzingFiles((current) => ({ ...current, [key]: false }))
    }
  }

  const setFile = async (key, value) => {
    if (value && !['image/jpeg', 'image/png'].includes(value.type)) {
      toast.error(isEn ? 'Only JPEG and PNG images are accepted' : 'Seules les images JPEG et PNG sont acceptees')
      return
    }
    if (value && value.size > 5 * 1024 * 1024) {
      toast.error(isEn ? 'Each image must be under 5 MB' : 'Chaque image doit faire moins de 5 Mo')
      return
    }
    if (!value) {
      setFiles((current) => ({ ...current, [key]: null }))
      setFileQuality((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      return
    }
    if (['id_front', 'id_back'].includes(key)) {
      setAnalyzingFiles((current) => ({ ...current, [key]: true }))
      try {
        const quality = await analyzeImageQuality(value, key)
        if (!quality.ok) {
          setFiles((current) => ({ ...current, [key]: value }))
          setFileQuality((current) => ({ ...current, [key]: quality }))
          toast.error(qualityMessage(quality.errors[0], isEn))
          return
        }
        setCropTarget({ key, file: value })
      } catch {
        setFiles((current) => ({ ...current, [key]: value }))
        setFileQuality((current) => ({
          ...current,
          [key]: {
            ok: false,
            errors: ['dimensions_too_small'],
            warnings: [],
            metrics: { width: 0, height: 0, brightness: 0, sharpness: 0 },
          },
        }))
        toast.error(isEn ? 'Unable to read this image' : 'Impossible de lire cette image')
      } finally {
        setAnalyzingFiles((current) => ({ ...current, [key]: false }))
      }
      return
    }
    await inspectAndStoreFile(key, value)
  }

  const validateStep = (index) => {
    if (index === 0) {
      const errors = {}
      const normalizedNationalId = form.national_id_number.trim().toUpperCase()
      if (form.full_name.trim().length < 3) {
        errors.full_name = isEn
          ? 'Enter your full name (at least 3 characters).'
          : 'Saisissez votre nom complet (au moins 3 caracteres).'
      }
      if (!form.birth_date) {
        errors.birth_date = isEn
          ? 'Select your date of birth.'
          : 'Selectionnez votre date de naissance.'
      } else if (form.birth_date > maxBirthDate) {
        errors.birth_date = isEn
          ? 'You must be at least 18 years old.'
          : 'Vous devez avoir au moins 18 ans.'
      }
      if (!form.gender) {
        errors.gender = isEn ? 'Select your gender.' : 'Selectionnez votre sexe.'
      }
      if (!/^[A-Z0-9]{8,20}$/.test(normalizedNationalId)) {
        errors.national_id_number = isEn
          ? 'The ID number must contain 8 to 20 letters or digits.'
          : 'Le numero de CNI doit contenir entre 8 et 20 lettres ou chiffres.'
      }
      if (!form.national_id_expiry_date) {
        errors.national_id_expiry_date = isEn
          ? 'Enter the ID expiry date.'
          : 'Saisissez la date d expiration de la CNI.'
      } else if (form.national_id_expiry_date <= new Date().toISOString().slice(0, 10)) {
        errors.national_id_expiry_date = isEn
          ? 'The ID must still be valid.'
          : 'La CNI doit encore etre valide.'
      }
      if (!form.phone) {
        errors.phone = isEn
          ? 'Enter your phone number.'
          : 'Saisissez votre numero de telephone.'
      } else if (!isValidCmPhone(form.phone)) {
        errors.phone = isEn
          ? 'Enter a valid Cameroonian phone number.'
          : 'Saisissez un numero camerounais valide, par exemple 6 99 00 00 02.'
      }
      if (Object.keys(errors).length) {
        showFieldErrors(errors)
        return false
      }
      setFieldErrors({})
    }
    if (index === 1) {
      const requiredTypes = ['profile_photo', 'id_front', 'id_back', 'selfie_with_id']
      if (requiredTypes.some(type => !files[type])) {
        toast.error(isEn ? 'The four identity photos are required' : 'Les quatre photos justificatives sont obligatoires')
        return false
      }
      if (
        requiredTypes.some(type => analyzingFiles[type])
        || requiredTypes.some(type => !fileQuality[type]?.ok)
      ) {
        toast.error(
          isEn
            ? 'Retake the photos that did not pass the quality check'
            : 'Reprenez les photos qui n ont pas passe le controle qualite'
        )
        return false
      }
    }
    if (index === 2 && (!form.city.trim() || !form.neighborhood.trim() || !form.residence_address.trim() || !form.service_area.trim() || !form.vehicle_type)) {
      toast.error(isEn ? 'Complete your address and activity' : 'Completez votre adresse et votre activite')
      return false
    }
    if (
      index === 2
      && files.vehicle_photo
      && (analyzingFiles.vehicle_photo || !fileQuality.vehicle_photo?.ok)
    ) {
      toast.error(
        isEn
          ? 'Retake the vehicle photo before continuing'
          : 'Reprenez la photo du vehicule avant de continuer'
      )
      return false
    }
    if (index === 3) {
      if (
        form.emergency_contact_name.trim().length < 3
        || !form.emergency_contact_phone
        || !isValidCmPhone(form.emergency_contact_phone)
      ) {
        toast.error(isEn ? 'Provide a valid emergency contact' : 'Renseignez un contact d urgence valide')
        return false
      }
      if (!form.consent_accepted) {
        toast.error(isEn ? 'You must accept the terms' : 'Vous devez accepter les conditions')
        return false
      }
    }
    return true
  }

  const next = () => {
    if (validateStep(step)) setStep((current) => Math.min(current + 1, steps.length - 1))
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!validateStep(3)) return

    const data = new FormData()
    Object.entries({
      ...form,
      phone: normalizeCmPhone(form.phone),
      emergency_contact_phone: normalizeCmPhone(form.emergency_contact_phone),
      consent_accepted: String(form.consent_accepted),
    }).forEach(([key, value]) => data.append(key, value))
    Object.entries(files).forEach(([key, value]) => {
      if (value) data.append(key, value)
    })

    setSubmitting(true)
    try {
      const response = await collectorApplicationApi.submit(data)
      setApplication(response.data.data)
      toast.success(isEn ? 'Application submitted' : 'Candidature envoyee')
    } catch (err) {
      toast.error(err.response?.data?.message || (isEn ? 'Submission failed' : 'Echec de l envoi'))
    } finally {
      setSubmitting(false)
    }
  }

  const submitReplacements = async () => {
    const requestedTypes = application?.document_replacement?.requested_types || []
    if (
      requestedTypes.some(type => !files[type])
      || requestedTypes.some(type => analyzingFiles[type])
      || requestedTypes.some(type => !fileQuality[type]?.ok)
    ) {
      return toast.error(
        isEn
          ? 'Add a valid replacement for every requested document'
          : 'Ajoutez une piece valide pour chaque document demande'
      )
    }

    const data = new FormData()
    requestedTypes.forEach(type => data.append(type, files[type]))
    setSubmitting(true)
    try {
      const response = await collectorApplicationApi.replaceDocuments(
        application.uuid,
        data
      )
      setApplication(response.data.data)
      setFiles({
        profile_photo: null,
        id_front: null,
        id_back: null,
        selfie_with_id: null,
        vehicle_photo: null,
      })
      setFileQuality({})
      toast.success(isEn ? 'Documents replaced' : 'Documents remplaces')
    } catch (error) {
      toast.error(
        error.response?.data?.message
        || (isEn ? 'Replacement failed' : 'Le remplacement a echoue')
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <PageLoader />

  if (application?.status === 'changes_requested') {
    const requestedTypes = application.document_replacement?.requested_types || []
    const labels = {
      profile_photo: isEn ? 'Recent identity photo' : 'Photo d identite recente',
      id_front: isEn ? 'ID card - front' : 'CNI recto',
      id_back: isEn ? 'ID card - back' : 'CNI verso',
      selfie_with_id: isEn ? 'Selfie holding your ID' : 'Selfie avec la CNI en main',
      vehicle_photo: isEn ? 'Vehicle photo' : 'Photo du moyen de transport',
    }
    return (
      <div className="fade-up max-w-3xl mx-auto pb-10">
        <PageHeader
          title={isEn ? 'Replace requested documents' : 'Remplacer les documents demandes'}
          subtitle={isEn ? 'Your application remains open' : 'Votre dossier reste ouvert'}
        />
        <div className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-200 flex gap-3">
          <AlertTriangle className="text-amber-600 flex-shrink-0" />
          <div>
            <p className="font-semibold text-amber-800">
              {isEn ? 'The administrator needs clearer documents' : 'L administrateur demande des documents plus lisibles'}
            </p>
            <p className="text-sm text-amber-700 mt-1">
              {application.document_replacement?.reason}
            </p>
          </div>
        </div>
        <div className="card p-5 sm:p-7">
          <div className="grid sm:grid-cols-2 gap-5">
            {requestedTypes.map(type => (
              <ImageUpload
                key={type}
                label={labels[type] || type}
                hint={isEn ? 'Clear, bright and sharp image' : 'Image claire, lumineuse et nette'}
                file={files[type]}
                quality={fileQuality[type]}
                analyzing={analyzingFiles[type]}
                guided={['id_front', 'id_back'].includes(type)}
                isEn={isEn}
                capture={type.includes('selfie') || type === 'profile_photo' ? 'user' : 'environment'}
                onChange={file => setFile(type, file)}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={submitReplacements}
            disabled={submitting}
            className="btn-primary w-full justify-center mt-7"
          >
            {submitting ? <Spinner size="sm" /> : <Upload size={17} />}
            {isEn ? 'Send replacement documents' : 'Envoyer les nouveaux documents'}
          </button>
        </div>
        {cropTarget && (
          <GuidedImageCrop
            file={cropTarget.file}
            isEn={isEn}
            onCancel={() => setCropTarget(null)}
            onConfirm={(file) => {
              const key = cropTarget.key
              setCropTarget(null)
              inspectAndStoreFile(key, file)
            }}
          />
        )}
      </div>
    )
  }

  const hasActiveApplication = application
    && ['submitted', 'under_review'].includes(application.status)
  const collectorVerificationCurrent = user?.role === 'collector'
    && application?.status === 'approved'
    && !application.renewal?.eligible

  if (hasActiveApplication || collectorVerificationCurrent) {
    const labels = {
      submitted: isEn ? 'Pending' : 'En attente',
      under_review: isEn ? 'Under review' : 'En cours de verification',
      approved: isEn ? 'Approved' : 'Approuve',
    }
    return (
      <div className="fade-up max-w-2xl mx-auto">
        <PageHeader
          title={isEn ? 'Collector application' : 'Candidature collecteur'}
          subtitle={isEn ? 'Track your verification status' : 'Suivez le statut de votre dossier'}
        />
        <div className="card p-8 text-center">
          <div className="w-16 h-16 bg-[#E8F5EE] rounded-2xl flex items-center justify-center mx-auto mb-4">
            {application.status === 'approved'
              ? <CheckCircle2 className="text-[#1A8A3C]" size={30} />
              : <Clock className="text-[#1A8A3C]" size={30} />}
          </div>
          <span className={`badge ${STATUS_STYLES[application.status]}`}>{labels[application.status]}</span>
          <h2 className="text-xl font-display font-bold mt-4">
            {collectorVerificationCurrent
              ? (isEn ? 'Your verification is current' : 'Votre verification est a jour')
              : (isEn ? 'Your file has been received' : 'Votre dossier a bien ete recu')}
          </h2>
          <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
            {collectorVerificationCurrent
              ? (
                isEn
                  ? `Valid until ${new Date(application.renewal.valid_until).toLocaleDateString('en-US')}. Renewal opens 60 days before expiry.`
                  : `Valide jusqu au ${new Date(application.renewal.valid_until).toLocaleDateString('fr-FR')}. Le renouvellement ouvre 60 jours avant l echeance.`
              )
              : (
                isEn
                  ? 'The EcoGarbage team is checking your information. You will receive a notification and an email after the decision.'
                  : 'L equipe EcoGarbage verifie vos informations. Vous recevrez une notification et un email apres la decision.'
              )}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="fade-up max-w-4xl mx-auto pb-10">
      <PageHeader
        title={user?.role === 'collector'
          ? (isEn ? 'Renew collector verification' : 'Renouveler la verification collecteur')
          : (isEn ? 'Become a collector' : 'Devenir collecteur')}
        subtitle={user?.role === 'collector'
          ? (isEn ? 'Update your identity documents securely' : 'Mettez a jour vos justificatifs de maniere securisee')
          : (isEn ? 'A secure application in a few minutes' : 'Un dossier securise en quelques minutes')}
      />

      {application?.status === 'rejected' && (
        <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-100 flex gap-3">
          <ShieldX className="text-red-500 flex-shrink-0" />
          <div>
            <p className="font-semibold text-red-700">{isEn ? 'Previous application rejected' : 'Candidature precedente refusee'}</p>
            <p className="text-sm text-red-600 mt-1">{application.review_notes}</p>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="bg-gradient-to-r from-[#166534] to-[#1A8A3C] px-5 py-6 text-white">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            {steps.map(({ icon: Icon, label }, index) => (
              <div key={label} className="flex flex-col items-center relative flex-1">
                {index > 0 && (
                  <div className={`absolute right-1/2 top-5 w-full h-0.5 ${index <= step ? 'bg-white' : 'bg-white/25'}`} />
                )}
                <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center border-2 transition ${
                  index < step
                    ? 'bg-white text-[#1A8A3C] border-white'
                    : index === step
                    ? 'bg-[#F4B942] text-gray-900 border-[#F4B942]'
                    : 'bg-[#1A8A3C] text-white/60 border-white/30'
                }`}>
                  {index < step ? <Check size={18} /> : <Icon size={18} />}
                </div>
                <span className={`text-[10px] sm:text-xs mt-2 font-medium ${index <= step ? 'text-white' : 'text-white/50'}`}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={submit} className="p-5 sm:p-8" noValidate>
          <div className="mb-7">
            <p className="text-xs font-semibold text-[#1A8A3C] uppercase tracking-wider">
              {isEn ? `Step ${step + 1} of ${steps.length}` : `Etape ${step + 1} sur ${steps.length}`}
            </p>
            <h2 className="text-xl font-display font-bold text-gray-900 mt-1">
              {[
                isEn ? 'Personal information' : 'Informations personnelles',
                isEn ? 'Supporting documents' : 'Pieces justificatives',
                isEn ? 'Address and collection activity' : 'Adresse et activite de collecte',
                isEn ? 'Security and confirmation' : 'Securite et confirmation',
              ][step]}
            </h2>
          </div>

          {step === 0 && (
            <div className="grid sm:grid-cols-2 gap-5">
              <div className="sm:col-span-2">
                <label className="label">{isEn ? 'Full name' : 'Nom(s) et prenom(s)'} *</label>
                <input
                  name="full_name"
                  className={inputClass('full_name')}
                  autoComplete="name"
                  aria-invalid={Boolean(fieldErrors.full_name)}
                  value={form.full_name}
                  onChange={(event) => set('full_name', event.target.value)}
                />
                <FieldError name="full_name" />
              </div>
              <div>
                <label className="label">{isEn ? 'Date of birth' : 'Date de naissance'} *</label>
                <input
                  name="birth_date"
                  type="date"
                  min="1900-01-01"
                  max={maxBirthDate}
                  className={inputClass('birth_date')}
                  aria-invalid={Boolean(fieldErrors.birth_date)}
                  value={form.birth_date}
                  onChange={(event) => set('birth_date', event.target.value)}
                />
                <FieldError name="birth_date" />
                <p className="text-[11px] text-gray-400 mt-1">{isEn ? 'You must be at least 18.' : 'Vous devez avoir au moins 18 ans.'}</p>
              </div>
              <div>
                <label className="label">{isEn ? 'Gender' : 'Sexe'} *</label>
                <select
                  name="gender"
                  className={inputClass('gender')}
                  aria-invalid={Boolean(fieldErrors.gender)}
                  value={form.gender}
                  onChange={(event) => set('gender', event.target.value)}
                >
                  <option value="">{isEn ? 'Select' : 'Selectionner'}</option>
                  <option value="male">{isEn ? 'Male' : 'Masculin'}</option>
                  <option value="female">{isEn ? 'Female' : 'Feminin'}</option>
                  <option value="other">{isEn ? 'Other' : 'Autre'}</option>
                  <option value="prefer_not_to_say">{isEn ? 'Prefer not to say' : 'Prefere ne pas preciser'}</option>
                </select>
                <FieldError name="gender" />
              </div>
              <div>
                <label className="label">{isEn ? 'National ID number' : 'Numero de CNI'} *</label>
                <input
                  name="national_id_number"
                  className={inputClass('national_id_number')}
                  inputMode="text"
                  autoComplete="off"
                  aria-invalid={Boolean(fieldErrors.national_id_number)}
                  placeholder={isEn ? '8 to 20 letters or digits' : '8 a 20 lettres ou chiffres'}
                  value={form.national_id_number}
                  onChange={(event) => set(
                    'national_id_number',
                    event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
                  )}
                />
                <FieldError name="national_id_number" />
                <p className="text-[11px] text-gray-400 mt-1">
                  {isEn ? 'Enter the number exactly as shown on your ID.' : 'Saisissez le numero exactement comme sur votre CNI.'}
                </p>
              </div>
              <div>
                <label className="label">{isEn ? 'Phone number' : 'Numero de telephone'} *</label>
                <input
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  className={inputClass('phone')}
                  aria-invalid={Boolean(fieldErrors.phone)}
                  placeholder="+237 6 99 00 00 02"
                  value={form.phone}
                  onChange={(event) => set('phone', formatCmPhone(event.target.value))}
                />
                <FieldError name="phone" />
              </div>
              <div>
                <label className="label">
                  {isEn ? 'ID expiry date' : 'Date d expiration de la CNI'} *
                </label>
                <input
                  name="national_id_expiry_date"
                  type="date"
                  min={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
                  className={inputClass('national_id_expiry_date')}
                  aria-invalid={Boolean(fieldErrors.national_id_expiry_date)}
                  value={form.national_id_expiry_date}
                  onChange={(event) => set('national_id_expiry_date', event.target.value)}
                />
                <FieldError name="national_id_expiry_date" />
              </div>
              <div>
                <label className="label">{isEn ? 'Email address' : 'Adresse e-mail'}</label>
                <input className="input bg-gray-100 text-gray-500 cursor-not-allowed" value={user?.email || ''} disabled />
                <p className="text-[11px] text-gray-400 mt-1">{isEn ? 'Linked to your EcoGarbage account.' : 'Liee a votre compte EcoGarbage.'}</p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-6">
                <ShieldCheck className="text-blue-600 flex-shrink-0" size={20} />
                <p className="text-xs text-blue-700 leading-relaxed">
                  {isEn
                    ? 'Use clear, recent photos. Your documents are private and only authorized administrators can access them.'
                    : 'Utilisez des photos nettes et recentes. Vos documents sont prives et accessibles uniquement aux administrateurs autorises.'}
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-5">
                <ImageUpload label={isEn ? 'Recent identity photo' : 'Photo d identite recente'} hint="JPEG/PNG, 5 Mo max." file={files.profile_photo} quality={fileQuality.profile_photo} analyzing={analyzingFiles.profile_photo} isEn={isEn} onChange={(file) => setFile('profile_photo', file)} capture="user" />
                <ImageUpload label={isEn ? 'ID card - front' : 'CNI recto'} hint={isEn ? 'All text must be readable' : 'Tout le texte doit etre lisible'} file={files.id_front} quality={fileQuality.id_front} analyzing={analyzingFiles.id_front} guided isEn={isEn} onChange={(file) => setFile('id_front', file)} />
                <ImageUpload label={isEn ? 'ID card - back' : 'CNI verso'} hint={isEn ? 'Avoid glare and blur' : 'Evitez les reflets et le flou'} file={files.id_back} quality={fileQuality.id_back} analyzing={analyzingFiles.id_back} guided isEn={isEn} onChange={(file) => setFile('id_back', file)} />
                <ImageUpload label={isEn ? 'Selfie holding your ID' : 'Selfie avec la CNI en main'} hint={isEn ? 'Face and ID visible together' : 'Visage et CNI visibles ensemble'} file={files.selfie_with_id} quality={fileQuality.selfie_with_id} analyzing={analyzingFiles.selfie_with_id} isEn={isEn} onChange={(file) => setFile('selfie_with_id', file)} capture="user" />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <label className="label">{isEn ? 'City' : 'Ville'} *</label>
                  <input className="input" placeholder="Douala" value={form.city} onChange={(event) => set('city', event.target.value)} />
                </div>
                <div>
                  <label className="label">{isEn ? 'Neighborhood' : 'Quartier'} *</label>
                  <input className="input" placeholder="Bonamoussadi" value={form.neighborhood} onChange={(event) => set('neighborhood', event.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{isEn ? 'Residential address' : 'Adresse de residence'} *</label>
                  <textarea className="input resize-none" rows={2} placeholder={isEn ? 'Street, landmark, building...' : 'Rue, point de repere, immeuble...'} value={form.residence_address} onChange={(event) => set('residence_address', event.target.value)} />
                </div>
                <div>
                  <label className="label">{isEn ? 'Preferred collection area' : 'Zone de collecte souhaitee'} *</label>
                  <input className="input" placeholder={isEn ? 'Example: Douala 5' : 'Exemple : Douala 5e'} value={form.service_area} onChange={(event) => set('service_area', event.target.value)} />
                </div>
                <div>
                  <label className="label">{isEn ? 'Transport method' : 'Moyen de transport'} *</label>
                  <select className="input" value={form.vehicle_type} onChange={(event) => set('vehicle_type', event.target.value)}>
                    <option value="">{isEn ? 'Select' : 'Selectionner'}</option>
                    <option value="foot">{isEn ? 'On foot' : 'A pied'}</option>
                    <option value="motorcycle">{isEn ? 'Motorcycle' : 'Moto'}</option>
                    <option value="tricycle">Tricycle</option>
                    <option value="car">{isEn ? 'Car' : 'Voiture'}</option>
                    <option value="van">{isEn ? 'Van' : 'Camionnette'}</option>
                  </select>
                </div>
              </div>
              <div className="max-w-sm">
                <ImageUpload
                  label={isEn ? 'Transport photo' : 'Photo du moyen de transport'}
                  hint={isEn ? 'Optional but recommended' : 'Optionnelle mais recommandee'}
                  file={files.vehicle_photo}
                  quality={fileQuality.vehicle_photo}
                  analyzing={analyzingFiles.vehicle_photo}
                  isEn={isEn}
                  onChange={(file) => setFile('vehicle_photo', file)}
                  optional
                  optionalLabel={isEn ? 'optional' : 'optionnel'}
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <label className="label">{isEn ? 'Emergency contact name' : 'Nom du contact d urgence'} *</label>
                  <input className="input" autoComplete="name" value={form.emergency_contact_name} onChange={(event) => set('emergency_contact_name', event.target.value)} />
                </div>
                <div>
                  <label className="label">{isEn ? 'Emergency contact phone' : 'Telephone du contact d urgence'} *</label>
                  <input type="tel" inputMode="tel" className="input" value={form.emergency_contact_phone} onChange={(event) => set('emergency_contact_phone', formatCmPhone(event.target.value))} />
                </div>
              </div>

              <div className="rounded-2xl bg-gray-50 border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                  <Upload size={17} className="text-[#1A8A3C]" />
                  {isEn ? 'Application summary' : 'Resume du dossier'}
                </h3>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 mt-4 text-sm">
                  <p><span className="text-gray-400">{isEn ? 'Applicant:' : 'Candidat :'}</span> <strong>{form.full_name}</strong></p>
                  <p><span className="text-gray-400">{isEn ? 'City:' : 'Ville :'}</span> <strong>{form.city}</strong></p>
                  <p><span className="text-gray-400">{isEn ? 'Area:' : 'Zone :'}</span> <strong>{form.service_area}</strong></p>
                  <p><span className="text-gray-400">{isEn ? 'Transport:' : 'Transport :'}</span> <strong>{form.vehicle_type}</strong></p>
                </div>
              </div>

              <label className="flex items-start gap-3 p-4 rounded-2xl border border-gray-200 cursor-pointer hover:border-[#1A8A3C] transition">
                <input
                  type="checkbox"
                  className="mt-1 w-4 h-4 accent-[#1A8A3C]"
                  checked={form.consent_accepted}
                  onChange={(event) => set('consent_accepted', event.target.checked)}
                />
                <span className="text-sm text-gray-600 leading-relaxed">
                  {isEn
                    ? 'I accept the terms of use and the privacy policy, including the processing of my identity documents for verification.'
                    : 'J accepte les conditions d utilisation et la politique de confidentialite, y compris le traitement de mes pieces d identite aux fins de verification.'}
                </span>
              </label>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 mt-8 pt-6 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={step === 0 || submitting}
              className="btn-outline justify-center px-4 sm:px-6"
            >
              <ArrowLeft size={17} /> {isEn ? 'Back' : 'Retour'}
            </button>
            {step < steps.length - 1 ? (
              <button type="button" onClick={next} className="btn-primary justify-center">
                {isEn ? 'Continue' : 'Continuer'} <ArrowRight size={17} />
              </button>
            ) : (
              <button type="submit" disabled={submitting} className="btn-primary justify-center">
                {submitting ? <Spinner size="sm" /> : <ShieldCheck size={17} />}
                {submitting
                  ? (isEn ? 'Submitting...' : 'Envoi...')
                  : (isEn ? 'Submit application' : 'Soumettre le dossier')}
              </button>
            )}
          </div>
        </form>
      </div>
      {cropTarget && (
        <GuidedImageCrop
          file={cropTarget.file}
          isEn={isEn}
          onCancel={() => setCropTarget(null)}
          onConfirm={(file) => {
            const key = cropTarget.key
            setCropTarget(null)
            inspectAndStoreFile(key, file)
          }}
        />
      )}
    </div>
  )
}
