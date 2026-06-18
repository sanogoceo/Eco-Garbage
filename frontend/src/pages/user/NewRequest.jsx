import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2, CalendarClock, Loader2, MapPin, Minus, Navigation, Phone, Plus,
  Recycle, Repeat2, Send, TrendingUp, Truck, User, Zap,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { businessContractApi, categoryApi, requestApi } from '../../services/api'
import { getCurrentPosition, getGeolocationStatus } from '../../utils/geolocation'
import { PageHeader, PageLoader } from '../../components/common'
import StructuredAddressFields from '../../components/common/StructuredAddressFields'
import {
  createOperationId,
  enqueueOfflineAction,
  isNetworkError,
} from '../../services/offlineQueue'
import {
  SERVICE_TYPES,
  SCHEDULED_SERVICE_TYPES,
} from '../../utils/serviceTypes'

const SERVICE_ICONS = {
  immediate: Zap,
  scheduled: CalendarClock,
  recurring: Repeat2,
  business: Building2,
  bulk: Truck,
  recyclable: Recycle,
}

const localDateTimeMinimum = () => {
  const date = new Date(Date.now() + 15 * 60 * 1000)
  const offset = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const localDateMinimum = () => localDateTimeMinimum().slice(0, 10)

export default function NewRequest() {
  const { t, i18n } = useTranslation()
  const isEn = i18n.language?.startsWith('en')
  const navigate = useNavigate()
  const [categories, setCategories] = useState([])
  const [businessContracts, setBusinessContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [locating, setLocating] = useState(false)
  const [estimating, setEstimating] = useState(false)
  const [estimate, setEstimate] = useState(null)
  const [assignResult, setAssignResult] = useState(null)
  const [geoError, setGeoError] = useState('')
  const [slots, setSlots] = useState([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState('')
  const [form, setForm] = useState({
    category_id: '',
    service_type: 'immediate',
    address: '',
    city: '',
    district: '',
    address_line: '',
    landmark: '',
    quantity_estimate: '',
    quantity_number: 1,
    notes: '',
    scheduled_at: '',
    schedule_date: '',
    latitude: null,
    longitude: null,
    company_name: '',
    registration_number: '',
    tax_id: '',
    billing_email: '',
    billing_address: '',
    contact_name: '',
    business_contract_id: '',
    business_site_id: '',
  })

  useEffect(() => {
    Promise.allSettled([
      categoryApi.list(),
      businessContractApi.list(),
    ]).then((results) => {
      if (results[0].status === 'fulfilled') {
        setCategories(results[0].value.data.data || [])
      }
      if (results[1].status === 'fulfilled') {
        setBusinessContracts(results[1].value.data.data || [])
      }
    }).catch(() => {
      // Keep UI responsive even if one request fails
    }).finally(() => setLoading(false))
    const geoStatus = getGeolocationStatus()
    if (!geoStatus.supported) setGeoError(geoStatus.reason)
  }, [])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const selectBusinessContract = (contractId) => {
    const contract = businessContracts.find(item => item.id === contractId)
    const firstSite = contract?.sites?.find(site => (
      site.is_active !== false && site.status === 'active'
    ))
    setForm(current => ({
      ...current,
      business_contract_id: contractId,
      business_site_id: firstSite?._id || '',
      company_name: contract?.company_name || '',
      registration_number: contract?.registration_number || '',
      tax_id: contract?.tax_id || '',
      billing_email: contract?.billing_email || '',
      billing_address: contract?.billing_address || '',
      contact_name: contract?.contact_name || '',
      city: firstSite?.city || current.city,
      district: firstSite?.district || current.district,
      address_line: firstSite?.address_line || current.address_line,
      address: firstSite?.address_line || current.address,
      landmark: firstSite?.landmark || current.landmark,
      latitude: firstSite?.latitude ?? current.latitude,
      longitude: firstSite?.longitude ?? current.longitude,
    }))
  }

  const selectBusinessSite = (siteId) => {
    const contract = businessContracts.find(
      item => item.id === form.business_contract_id
    )
    const site = contract?.sites?.find(item => item._id === siteId)
    setForm(current => ({
      ...current,
      business_site_id: siteId,
      city: site?.city || '',
      district: site?.district || '',
      address_line: site?.address_line || '',
      address: site?.address_line || '',
      landmark: site?.landmark || '',
      latitude: site?.latitude ?? null,
      longitude: site?.longitude ?? null,
    }))
  }

  const selectServiceType = (serviceType) => {
    if (serviceType === 'recurring') {
      navigate('/dashboard/recurring')
      return
    }
    setEstimate(null)
    setForm((current) => {
      const selectedCategory = categories.find(category => category.id == current.category_id)
      return {
        ...current,
        service_type: serviceType,
        scheduled_at: serviceType === 'immediate' ? '' : current.scheduled_at,
        schedule_date: serviceType === 'immediate' ? '' : current.schedule_date,
        category_id: serviceType === 'recyclable' && selectedCategory?.is_recyclable !== true
          ? ''
          : current.category_id,
      }
    })
  }

  const loadSlots = useCallback(async () => {
    if (
      !SCHEDULED_SERVICE_TYPES.includes(form.service_type)
      || !form.schedule_date
    ) {
      setSlots([])
      setSlotsError('')
      return
    }
    setSlotsLoading(true)
    setSlotsError('')
    try {
      const response = await requestApi.serviceSlots({
        service_type: form.service_type,
        date: form.schedule_date,
      })
      const availableSlots = response.data.data || []
      setSlots(availableSlots)
      if (
        form.scheduled_at
        && !availableSlots.some(slot => (
          slot.available && slot.start_at === form.scheduled_at
        ))
      ) {
        set('scheduled_at', '')
      }
    } catch (error) {
      setSlots([])
      setSlotsError(
        error.response?.data?.message
        || (isEn
          ? 'Unable to load available time slots.'
          : 'Impossible de charger les créneaux disponibles.')
      )
    } finally {
      setSlotsLoading(false)
    }
  }, [
    form.schedule_date,
    form.scheduled_at,
    form.service_type,
    isEn,
  ])

  useEffect(() => {
    loadSlots()
  }, [loadSlots])

  const getLocation = async () => {
    setLocating(true)
    setGeoError('')
    try {
      const pos = await getCurrentPosition()
      setForm(p => ({ ...p, latitude: pos.coords.latitude, longitude: pos.coords.longitude }))
      toast.success(isEn ? 'GPS position obtained!' : 'Position GPS obtenue !')
    } catch (err) {
      setGeoError(err.message)
      toast.error(isEn ? 'Unable to get location. Check permissions.' : "Impossible d'obtenir votre position. Vérifiez les permissions.")
    } finally {
      setLocating(false)
    }
  }

  const fetchEstimate = useCallback(async () => {
    if (!form.category_id) return
    setEstimating(true)
    try {
      const res = await requestApi.estimate({
        category_id: form.category_id,
        address: form.address,
        city: form.city,
        district: form.district,
        address_line: form.address_line,
        landmark: form.landmark,
        service_type: form.service_type,
        latitude: form.latitude,
        longitude: form.longitude,
        quantity_number: form.quantity_number,
      })
      setEstimate(res.data.data)
    } catch {
      setEstimate(null)
    } finally {
      setEstimating(false)
    }
  }, [
    form.address,
    form.address_line,
    form.category_id,
    form.city,
    form.district,
    form.landmark,
    form.latitude,
    form.longitude,
    form.quantity_number,
    form.service_type,
  ])

  useEffect(() => {
    if (!form.category_id) {
      setEstimate(null)
      return undefined
    }
    const timer = setTimeout(fetchEstimate, 450)
    return () => clearTimeout(timer)
  }, [fetchEstimate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (
      !form.category_id
      || !form.city.trim()
      || !form.district.trim()
      || !form.address_line.trim()
    )
      return toast.error(isEn ? 'Category and address are required' : 'Catégorie et adresse sont obligatoires')
    if (SCHEDULED_SERVICE_TYPES.includes(form.service_type) && !form.scheduled_at)
      return toast.error(isEn ? 'Please choose a collection date' : 'Veuillez choisir une date de collecte')
    if (
      form.service_type === 'business'
      && (
        form.company_name.trim().length < 2
        || form.registration_number.trim().length < 3
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.billing_email)
        || form.billing_address.trim().length < 5
        || form.contact_name.trim().length < 2
      )
    ) {
      return toast.error(
        isEn
          ? 'Complete the company billing information'
          : 'Completez les informations de facturation de l entreprise'
      )
    }
    if (
      !Number.isFinite(Number(form.latitude))
      || !Number.isFinite(Number(form.longitude))
      || Number(form.latitude) < -90 || Number(form.latitude) > 90
      || Number(form.longitude) < -180 || Number(form.longitude) > 180
    )
      return toast.error(isEn
        ? 'GPS position required. Enable geolocation or enter coordinates manually.'
        : 'Position GPS requise. Activez la géolocalisation ou entrez les coordonnées manuellement.'
      )
    setSubmitting(true)
    const payload = { ...form, client_operation_id: createOperationId() }
    try {
      const res = await requestApi.create(payload)
      const data = res.data.data
      if (data.collector_name) {
        setAssignResult(data)
        toast.success(isEn ? 'Collector automatically assigned!' : 'Collecteur assigné automatiquement !')
      } else {
        toast.success(isEn ? 'Request created! Looking for a collector.' : 'Demande créée ! Nous recherchons un collecteur.')
        navigate('/dashboard/requests')
      }
    } catch (err) {
      if (isNetworkError(err)) {
        await enqueueOfflineAction('request.create', payload)
        toast.success(isEn
          ? 'Request saved offline. It will be sent automatically.'
          : 'Demande enregistrée hors connexion. Elle sera envoyée automatiquement.')
        navigate('/dashboard/requests')
      } else {
        toast.error(err.response?.data?.message || t('common.serverError'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <PageLoader />

  if (assignResult) {
    return (
      <div className="fade-up max-w-lg mx-auto mt-10">
        <div className="card p-8 text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-[#E8F5EE] flex items-center justify-center">
            <Navigation size={36} className="text-[#1A8A3C]" />
          </div>
          <h2 className="font-display text-2xl font-bold text-gray-900 mb-2">
            {isEn ? 'Collector on the way!' : 'Collecteur en route !'}
          </h2>
          <p className="text-gray-500 mb-6">
            {isEn ? 'A collector has been automatically assigned to your request.' : 'Un collecteur a été assigné automatiquement à votre demande.'}
          </p>

          <div className="bg-[#E8F5EE] rounded-2xl p-5 mb-6 text-left">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-[#1A8A3C] flex items-center justify-center">
                <User size={24} className="text-white" />
              </div>
              <div>
                <p className="font-bold text-gray-900">{assignResult.collector_name}</p>
                <p className="text-sm text-gray-500 flex items-center gap-1">
                  <Phone size={12} /> {assignResult.collector_phone}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">{isEn ? 'Distance' : 'Distance'}</span>
                <span className="font-semibold">{assignResult.distance_km} km</span>
              </div>
              <div className="flex justify-between border-t border-[#C8EDDA] pt-2">
                <span className="font-semibold text-[#1A8A3C]">{t('user.newRequest.priceEstimate')}</span>
                <span className="font-bold text-[#1A8A3C] text-lg">{assignResult.estimated_price?.toLocaleString()} FCFA</span>
              </div>
            </div>
          </div>

          <button onClick={() => navigate('/dashboard/requests')} className="btn-primary w-full justify-center py-3">
            {t('user.dashboard.myRequests')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fade-up max-w-2xl mx-auto">
      <PageHeader title={t('user.newRequest.title')} subtitle={t('user.newRequest.subtitle')} />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 md:gap-6">
        <div className="card p-6">
          <h3 className="font-display font-bold mb-4">{t('user.newRequest.serviceType')}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {SERVICE_TYPES.map(s => (
              <button key={s.value} type="button" onClick={() => selectServiceType(s.value)}
                className={`p-3.5 rounded-xl border-2 text-left transition-all ${form.service_type === s.value ? 'border-[#1A8A3C] bg-[#E8F5EE]' : 'border-gray-200 hover:border-gray-300'}`}>
                <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                  {(() => {
                    const Icon = SERVICE_ICONS[s.value]
                    return <Icon size={16} className="text-[#1A8A3C]" />
                  })()}
                  {s[isEn ? 'en' : 'fr']}
                </span>
                <p className="text-xs text-gray-400 mt-1">
                  {s[isEn ? 'descriptionEn' : 'descriptionFr']}
                </p>
              </button>
            ))}
          </div>
        </div>

        {form.service_type === 'business' && (
          <div className="card p-6">
            <h3 className="font-display font-bold mb-1">
              {isEn ? 'Company and billing' : 'Entreprise et facturation'}
            </h3>
            <p className="text-xs text-gray-400 mb-4">
              {isEn
                ? 'These details will appear on the invoice.'
                : 'Ces informations apparaitront sur la facture.'}
            </p>
            {!businessContracts.some(contract => contract.status === 'active')
              && businessContracts.some(contract => contract.status === 'pending') && (
              <div className="mb-5 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700">
                {isEn
                  ? 'Your saved business contract is waiting for administrator approval. It will appear here once approved.'
                  : 'Votre contrat entreprise est en attente de validation admin. Il apparaitra ici apres approbation.'}
              </div>
            )}
            {businessContracts.some(contract => contract.status === 'active') && (
              <div className="grid sm:grid-cols-2 gap-4 mb-5 rounded-xl bg-blue-50 border border-blue-100 p-4">
                <div>
                  <label className="label">
                    {isEn ? 'Saved contract' : 'Contrat enregistré'}
                  </label>
                  <select
                    className="input"
                    value={form.business_contract_id}
                    onChange={event => selectBusinessContract(event.target.value)}
                  >
                    <option value="">
                      {isEn ? 'Manual company information' : 'Saisie manuelle'}
                    </option>
                    {businessContracts
                      .filter(contract => contract.status === 'active')
                      .map(contract => (
                        <option key={contract.id} value={contract.id}>
                          {contract.company_name} ({contract.remaining_quota} restantes)
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="label">{isEn ? 'Collection site' : 'Site de collecte'}</label>
                  <select
                    className="input"
                    value={form.business_site_id}
                    disabled={!form.business_contract_id}
                    onChange={event => selectBusinessSite(event.target.value)}
                  >
                    <option value="">{isEn ? 'Select a site' : 'Sélectionner un site'}</option>
                    {businessContracts
                      .find(contract => contract.id === form.business_contract_id)
                      ?.sites?.filter(site => site.is_active !== false)
                      ?.filter(site => site.status === 'active')
                      .map(site => (
                        <option key={site._id} value={site._id}>{site.name}</option>
                      ))}
                  </select>
                </div>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{isEn ? 'Company name' : 'Raison sociale'} *</label>
                <input className="input" value={form.company_name}
                  disabled={Boolean(form.business_contract_id)}
                  onChange={event => set('company_name', event.target.value)} />
              </div>
              <div>
                <label className="label">RCCM / {isEn ? 'Registration' : 'Immatriculation'} *</label>
                <input className="input" value={form.registration_number}
                  disabled={Boolean(form.business_contract_id)}
                  onChange={event => set('registration_number', event.target.value)} />
              </div>
              <div>
                <label className="label">NIU</label>
                <input className="input" value={form.tax_id}
                  disabled={Boolean(form.business_contract_id)}
                  onChange={event => set('tax_id', event.target.value)} />
              </div>
              <div>
                <label className="label">{isEn ? 'Billing email' : 'Email de facturation'} *</label>
                <input type="email" className="input" value={form.billing_email}
                  disabled={Boolean(form.business_contract_id)}
                  onChange={event => set('billing_email', event.target.value)} />
              </div>
              <div>
                <label className="label">{isEn ? 'Billing address' : 'Adresse de facturation'} *</label>
                <input className="input" value={form.billing_address}
                  disabled={Boolean(form.business_contract_id)}
                  onChange={event => set('billing_address', event.target.value)} />
              </div>
              <div>
                <label className="label">{isEn ? 'Contact person' : 'Personne de contact'} *</label>
                <input className="input" value={form.contact_name}
                  disabled={Boolean(form.business_contract_id)}
                  onChange={event => set('contact_name', event.target.value)} />
              </div>
            </div>
          </div>
        )}

        <div className="card p-6">
          <h3 className="font-display font-bold mb-4">{t('user.newRequest.category')} <span className="text-red-500">*</span></h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {categories.map(cat => {
              const incompatible = form.service_type === 'recyclable' && !cat.is_recyclable
              return (
                <button
                  key={cat.id}
                  type="button"
                  disabled={incompatible}
                  onClick={() => set('category_id', cat.id)}
                  className={`p-3.5 rounded-xl border-2 text-left transition-all ${
                    incompatible
                      ? 'border-gray-100 bg-gray-50 opacity-45 cursor-not-allowed'
                      : form.category_id == cat.id
                        ? 'border-[#1A8A3C] bg-[#E8F5EE]'
                        : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="text-sm font-semibold text-gray-800">{cat.name}</p>
                  <p className="text-xs text-[#1A8A3C] mt-0.5 font-medium">
                    {parseFloat(cat.base_price).toLocaleString()} FCFA
                  </p>
                  {cat.is_hazardous && (
                    <span className="text-[10px] text-red-500 font-bold">
                      {isEn ? 'Hazardous' : 'Dangereux'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="card p-6">
          <h3 className="font-display font-bold mb-4">{t('user.newRequest.quantity')}</h3>
          <div className="flex items-center justify-center gap-5">
            <button type="button"
              onClick={() => set('quantity_number', Math.max(1, form.quantity_number - 1))}
              className="w-12 h-12 rounded-full border-2 border-gray-200 flex items-center justify-center hover:border-[#1A8A3C] transition-colors">
              <Minus size={20} />
            </button>
            <div className="text-center">
              <span className="text-4xl font-bold text-[#1A8A3C]">{form.quantity_number}</span>
              <p className="text-xs text-gray-400 mt-1">{isEn ? 'unit(s) / bag(s)' : 'unité(s) / sac(s)'}</p>
            </div>
            <button type="button"
              onClick={() => set('quantity_number', Math.min(20, form.quantity_number + 1))}
              className="w-12 h-12 rounded-full border-2 border-gray-200 flex items-center justify-center hover:border-[#1A8A3C] transition-colors">
              <Plus size={20} />
            </button>
          </div>
        </div>

        <div className="card p-6 flex flex-col gap-5">
          <h3 className="font-display font-bold">{isEn ? 'Collection details' : 'Détails de la collecte'}</h3>

          <div>
            <label className="label">{isEn ? 'Your GPS position' : 'Votre position GPS'} <span className="text-red-500">*</span></label>
            <button type="button" onClick={getLocation} disabled={locating}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 transition-all ${form.latitude ? 'border-[#1A8A3C] bg-[#E8F5EE] text-[#1A8A3C]' : 'border-dashed border-gray-300 text-gray-500 hover:border-[#1A8A3C]'}`}>
              {locating ? <Loader2 size={16} className="spinner" /> : <MapPin size={16} />}
              {locating
                ? (isEn ? 'Locating...' : 'Localisation...')
                : form.latitude
                  ? `📍 ${isEn ? 'Position obtained' : 'Position obtenue'} (${form.latitude.toFixed(4)}, ${form.longitude.toFixed(4)})`
                  : (isEn ? 'Enable geolocation' : 'Activer la géolocalisation')}
            </button>
            {geoError && (
              <div className="mt-2">
                <p className="text-sm text-red-500 mb-2">{geoError}</p>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-800 mb-2">
                    {isEn
                      ? 'Enter your coordinates manually (e.g. Yaoundé: 3.848, 11.502)'
                      : 'Entrez vos coordonnées manuellement (ex. Yaoundé : 3.848, 11.502)'}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs">{isEn ? 'Latitude' : 'Latitude'}</label>
                      <input
                        type="number"
                        step="any"
                        min="-90"
                        max="90"
                        className="input text-sm"
                        placeholder="ex: 3.848"
                        value={form.latitude ?? ''}
                        onChange={e => {
                          const v = e.target.value === '' ? null : Number(e.target.value)
                          if (v === null || (Number.isFinite(v) && v >= -90 && v <= 90)) {
                            set('latitude', v)
                          }
                        }}
                      />
                    </div>
                    <div>
                      <label className="label text-xs">{isEn ? 'Longitude' : 'Longitude'}</label>
                      <input
                        type="number"
                        step="any"
                        min="-180"
                        max="180"
                        className="input text-sm"
                        placeholder="ex: 11.502"
                        value={form.longitude ?? ''}
                        onChange={e => {
                          const v = e.target.value === '' ? null : Number(e.target.value)
                          if (v === null || (Number.isFinite(v) && v >= -180 && v <= 180)) {
                            set('longitude', v)
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <StructuredAddressFields
            isEn={isEn}
            value={form}
            onChange={next => setForm(current => ({
              ...current,
              ...next,
              address: next.address_line,
            }))}
          />

          <div>
            <label className="label">{isEn ? 'Estimated quantity (description)' : 'Quantité estimée (description)'}</label>
            <input className="input" placeholder={isEn ? 'e.g. 3 bags, 2m³, 1 sofa...' : 'Ex: 3 sacs, 2m³, 1 canapé...'} value={form.quantity_estimate}
              onChange={e => set('quantity_estimate', e.target.value)} />
          </div>

          {SCHEDULED_SERVICE_TYPES.includes(form.service_type) && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">
                  {isEn ? 'Collection date' : 'Date de collecte'} <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  className="input"
                  value={form.schedule_date}
                  min={localDateMinimum()}
                  onChange={event => setForm(current => ({
                    ...current,
                    schedule_date: event.target.value,
                    scheduled_at: '',
                  }))}
                />
              </div>
              <div>
                <label className="label">
                  {isEn ? 'Available time slot' : 'Creneau disponible'} <span className="text-red-500">*</span>
                </label>
                {!form.schedule_date ? (
                  <div className="rounded-xl border border-dashed border-gray-300 p-3 text-sm text-gray-400">
                    {isEn
                      ? 'Choose a date to display available slots.'
                      : 'Choisissez une date pour afficher les créneaux.'}
                  </div>
                ) : slotsLoading ? (
                  <div className="rounded-xl border border-gray-200 p-3 text-sm text-gray-500 flex items-center gap-2">
                    <Loader2 size={16} className="spinner" />
                    {isEn ? 'Loading slots...' : 'Chargement des créneaux...'}
                  </div>
                ) : slotsError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                    <p className="text-xs text-red-700">{slotsError}</p>
                    <button
                      type="button"
                      onClick={loadSlots}
                      className="mt-2 text-xs font-semibold text-red-700 underline"
                    >
                      {isEn ? 'Try again' : 'Réessayer'}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                    {slots.filter(slot => slot.available).map(slot => {
                      const selected = form.scheduled_at === slot.start_at
                      return (
                        <button
                          key={slot.start_at}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => set('scheduled_at', slot.start_at)}
                          className={`rounded-xl border-2 p-2.5 text-left transition-all ${
                            selected
                              ? 'border-[#1A8A3C] bg-[#E8F5EE] text-[#1A8A3C]'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-[#1A8A3C]'
                          }`}
                        >
                          <span className="block text-sm font-bold">
                            {new Date(slot.start_at).toLocaleTimeString(
                              isEn ? 'en-US' : 'fr-FR',
                              { hour: '2-digit', minute: '2-digit' }
                            )}
                            {' - '}
                            {new Date(slot.end_at).toLocaleTimeString(
                              isEn ? 'en-US' : 'fr-FR',
                              { hour: '2-digit', minute: '2-digit' }
                            )}
                          </span>
                          <span className="block text-[11px] mt-0.5 opacity-70">
                            {slot.remaining} {isEn ? 'place(s) left' : 'place(s) disponible(s)'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
                {form.schedule_date && !slotsLoading
                  && !slotsError
                  && slots.filter(slot => slot.available).length === 0 && (
                  <p className="text-xs text-red-600 mt-1">
                    {isEn
                      ? 'No available slot on this date. Choose another date.'
                      : 'Aucun créneau disponible à cette date. Choisissez une autre date.'}
                  </p>
                )}
                {form.scheduled_at && (
                  <p className="text-xs font-semibold text-[#1A8A3C] mt-2">
                    {isEn ? 'Selected slot:' : 'Créneau sélectionné :'}{' '}
                    {new Date(form.scheduled_at).toLocaleTimeString(
                      isEn ? 'en-US' : 'fr-FR',
                      { hour: '2-digit', minute: '2-digit' }
                    )}
                  </p>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="label">{t('user.newRequest.notes')}</label>
            <textarea className="input min-h-[80px] resize-none" placeholder={t('user.newRequest.notesPlaceholder')}
              value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>

        {(estimate || form.category_id) && (
          <div className="bg-[#E8F5EE] border border-[#C8EDDA] rounded-2xl p-5">
            <h3 className="font-display font-bold text-[#1A8A3C] mb-3 flex items-center gap-2">
              <TrendingUp size={18} /> {isEn ? 'Live estimate' : 'Estimation en direct'}
              {estimating && <Loader2 size={14} className="spinner" />}
            </h3>
            {estimate ? (
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">{isEn ? 'Waste type' : 'Type de déchet'}</span>
                  <span className="font-medium">{categories.find(c => c.id == form.category_id)?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{isEn ? 'Base price / unit' : 'Prix de base / unité'}</span>
                  <span className="font-medium">{estimate.base_price?.toLocaleString()} FCFA</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{isEn ? 'Quantity' : 'Quantité'}</span>
                  <span className="font-medium">{estimate.quantity} {isEn ? 'unit(s)' : 'unité(s)'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{isEn ? 'Collector distance' : 'Distance collecteur'}</span>
                  <span className="font-medium">{estimate.distance_km > 0 ? `${estimate.distance_km} km` : (isEn ? 'Waiting GPS' : 'En attente GPS')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{isEn ? 'Available collector' : 'Collecteur disponible'}</span>
                  <span className={`font-medium ${estimate.collector_found ? 'text-[#1A8A3C]' : 'text-orange-500'}`}>
                    {estimate.collector_found ? `✅ ${estimate.collector_name}` : (isEn ? '🔍 Searching...' : '🔍 Recherche...')}
                  </span>
                </div>
                {estimate.pricing && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-500">
                        {isEn ? 'Service adjustment' : 'Ajustement du service'}
                      </span>
                      <span className="font-medium">x{estimate.pricing.service_multiplier}</span>
                    </div>
                    {estimate.pricing.service_fee > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">
                          {isEn ? 'Service fixed fee' : 'Frais fixes du service'}
                        </span>
                        <span className="font-medium">
                          {estimate.pricing.service_fee.toLocaleString()} FCFA
                        </span>
                      </div>
                    )}
                    {estimate.pricing.zone_label && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">
                          {isEn ? 'Pricing zone' : 'Zone tarifaire'}
                        </span>
                        <span className="font-medium">
                          {estimate.pricing.zone_label} (x{estimate.pricing.zone_multiplier})
                        </span>
                      </div>
                    )}
                    {estimate.pricing.zone_fee > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">
                          {isEn ? 'Zone fee' : 'Frais de zone'}
                        </span>
                        <span className="font-medium">
                          {estimate.pricing.zone_fee.toLocaleString()} FCFA
                        </span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex justify-between border-t border-[#C8EDDA] pt-2 mt-1">
                  <span className="font-semibold text-[#1A8A3C]">{t('user.newRequest.priceEstimate')}</span>
                  <span className="font-bold text-[#1A8A3C] text-lg">{estimate.estimated_price?.toLocaleString()} FCFA</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                {isEn ? 'Select a category and enable geolocation to see the estimate.' : "Sélectionnez une catégorie et activez la géolocalisation pour voir l'estimation."}
              </p>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={() => navigate(-1)} className="btn-ghost flex-1 justify-center border border-gray-200">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={submitting} className="btn-primary flex-1 justify-center py-3.5">
            {submitting ? <Loader2 size={16} className="spinner" /> : <Send size={16} />}
            {submitting ? t('user.newRequest.submitting') : t('user.newRequest.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
