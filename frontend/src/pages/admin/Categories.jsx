import { useState, useEffect } from 'react'
import { CalendarDays, Edit2, MapPinned, Plus, Settings2, Tag, Trash2 } from 'lucide-react'
import getCategoryIcon from '../../utils/categoryIcons'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { adminApi } from '../../services/api'
import { PageHeader, PageLoader, EmptyState, Modal } from '../../components/common'
import AdminStepUpModal from '../../components/common/AdminStepUpModal'
import { getServiceTypeLabel } from '../../utils/serviceTypes'

const EMPTY_FORM = { name: '', description: '', icon: 'trash', base_price: '', is_hazardous: false, is_recyclable: false, is_active: true }

export default function AdminCategories() {
  const { t, i18n } = useTranslation()
  const isEn = i18n.language?.startsWith('en')
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [serviceConfigurations, setServiceConfigurations] = useState([])
  const [pricingModal, setPricingModal] = useState(false)
  const [pricingForm, setPricingForm] = useState(null)
  const [pricingStepUp, setPricingStepUp] = useState(false)

  const loadData = async () => {
    try {
      const results = await Promise.allSettled([
        adminApi.categories(),
        adminApi.serviceConfigurations(),
      ])
      if (results[0].status === 'fulfilled') {
        setCategories(results[0].value.data.data || [])
      }
      if (results[1].status === 'fulfilled') {
        setServiceConfigurations(results[1].value.data.data || [])
      }
      if (results.some((result) => result.status === 'rejected')) {
        throw results.find((result) => result.status === 'rejected').reason
      }
    } catch (error) {
      toast.error(error.response?.data?.message || t('common.serverError'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { loadData() }, [])

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setModal(true) }
  const openEdit = (cat) => { setEditing(cat); setForm({ ...cat }); setModal(true) }

  const handleSave = async () => {
    if (!form.name || !form.base_price) return toast.error(isEn ? 'Name and price required' : 'Nom et prix requis')
    setSaving(true)
    try {
      if (editing) {
        await adminApi.updateCategory(editing.id, form)
        toast.success(t('admin.categories.updateSuccess'))
      } else {
        await adminApi.createCategory(form)
        toast.success(t('admin.categories.createSuccess'))
      }
      setModal(false)
      loadData()
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.serverError'))
    } finally {
      setSaving(false)
    }
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const openPricing = (configuration) => {
    const configuredDays = new Map(
      (configuration.weekly_schedule || []).map(day => [Number(day.day_of_week), day])
    )
    setPricingForm({
      service_type: configuration.service_type,
      price_multiplier: configuration.price_multiplier,
      fixed_fee: configuration.fixed_fee,
      slot_duration_minutes: configuration.slot_duration_minutes,
      max_requests_per_slot: configuration.max_requests_per_slot,
      zone_pricing: configuration.zone_pricing || [],
      weekly_schedule: Array.from({ length: 7 }, (_, day) => ({
        day_of_week: day,
        is_open: configuredDays.get(day)?.is_open !== false,
        opening_time: configuredDays.get(day)?.opening_time || '07:00',
        closing_time: configuredDays.get(day)?.closing_time || '19:00',
        capacity_override: configuredDays.get(day)?.capacity_override || '',
      })),
      blackout_dates: configuration.blackout_dates || [],
      is_active: configuration.is_active,
    })
    setPricingModal(true)
  }

  const savePricing = async (stepUpToken) => {
    setSaving(true)
    try {
      const response = await adminApi.updateServiceConfiguration(
        pricingForm.service_type,
        pricingForm,
        stepUpToken
      )
      setServiceConfigurations(current => current.map(configuration => (
        configuration.service_type === pricingForm.service_type
          ? response.data.data
          : configuration
      )))
      setPricingModal(false)
      toast.success(isEn
        ? 'Service pricing updated'
        : 'Tarification et capacité mises à jour')
    } catch (error) {
      toast.error(error.response?.data?.message || t('common.serverError'))
      throw error
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fade-up">
      <PageHeader title={t('admin.categories.title')} subtitle={`${categories.length} ${isEn ? 'category(ies)' : 'catégorie(s)'}`}
        action={<button onClick={openCreate} className="btn-primary"><Plus size={16} />{t('admin.categories.add')}</button>} />

      {loading ? <PageLoader /> : categories.length === 0 ? (
        <EmptyState icon={Tag} title={t('admin.categories.noCategories')} description={isEn ? 'Create your first waste category.' : 'Créez votre première catégorie de déchets.'}
          action={<button onClick={openCreate} className="btn-primary"><Plus size={16} />{t('common.create')}</button>} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map(cat => (
            <div key={cat.id} className={`card p-5 ${!cat.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-[#E8F5EE] rounded-xl flex items-center justify-center text-lg">{getCategoryIcon(cat.icon)}</div>
                <button onClick={() => openEdit(cat)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                  <Edit2 size={14} />
                </button>
              </div>
              <h3 className="font-display font-bold text-gray-900 mb-1">{cat.name}</h3>
              <p className="text-xs text-gray-400 mb-3 line-clamp-2">{cat.description}</p>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-[#1A8A3C]">{parseFloat(cat.base_price).toLocaleString()} FCFA</span>
                <div className="flex gap-1.5">
                  {cat.is_hazardous && <span className="badge bg-red-100 text-red-600 text-[10px]">⚠️ {t('admin.categories.hazardous')}</span>}
                  {cat.is_recyclable && <span className="badge bg-green-100 text-green-600 text-[10px]">♻️</span>}
                  {!cat.is_active && <span className="badge bg-gray-100 text-gray-500 text-[10px]">{t('common.inactive')}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <section className="mt-8">
          <div className="mb-4">
            <h2 className="font-display text-lg font-bold text-gray-900">
              {isEn ? 'Pricing and capacity by service' : 'Tarification et capacité par service'}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {isEn
                ? 'Configure the price adjustment and maximum bookings for each time slot.'
                : 'Configurez l ajustement du prix et le nombre maximal de réservations par créneau.'}
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {serviceConfigurations.map(configuration => (
              <div key={configuration.service_type} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display font-bold">
                      {getServiceTypeLabel(configuration.service_type, isEn)}
                    </h3>
                    <span className={`badge mt-2 ${
                      configuration.is_active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {configuration.is_active ? t('common.active') : t('common.inactive')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openPricing(configuration)}
                    className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#1A8A3C]"
                  >
                    <Settings2 size={17} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-5 text-sm">
                  <Data label={isEn ? 'Multiplier' : 'Multiplicateur'} value={`x${configuration.price_multiplier}`} />
                  <Data
                    label={isEn ? 'Fixed fee' : 'Frais fixes'}
                    value={`${Number(configuration.fixed_fee || 0).toLocaleString()} FCFA`}
                  />
                  <Data
                    label={isEn ? 'Slot duration' : 'Durée du créneau'}
                    value={`${configuration.slot_duration_minutes} min`}
                  />
                  <Data
                    label={isEn ? 'Maximum capacity' : 'Capacité maximale'}
                    value={configuration.max_requests_per_slot}
                  />
                  <Data
                    label={isEn ? 'Pricing zones' : 'Zones tarifaires'}
                    value={configuration.zone_pricing?.length || 0}
                  />
                  <Data
                    label={isEn ? 'Closed dates' : 'Dates fermées'}
                    value={configuration.blackout_dates?.length || 0}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <Modal isOpen={modal} onClose={() => setModal(false)} title={editing ? (isEn ? 'Edit category' : 'Modifier la catégorie') : t('admin.categories.add')}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="label">{t('admin.categories.name')} <span className="text-red-500">*</span></label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder={isEn ? 'e.g. Organic waste' : 'Ex: Déchets organiques'} />
          </div>
          <div>
            <label className="label">{isEn ? 'Description' : 'Description'}</label>
            <textarea className="input resize-none" rows={2} value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('admin.categories.basePrice')} <span className="text-red-500">*</span></label>
            <input type="number" className="input" value={form.base_price} onChange={e => set('base_price', e.target.value)} placeholder="500" />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="accent-[#1A8A3C]" checked={form.is_hazardous} onChange={e => set('is_hazardous', e.target.checked)} />
              {t('admin.categories.hazardous')}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="accent-[#1A8A3C]" checked={form.is_recyclable} onChange={e => set('is_recyclable', e.target.checked)} />
              {t('admin.categories.recyclable')}
            </label>
            {editing && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="accent-[#1A8A3C]" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
                {t('admin.categories.active')}
              </label>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setModal(false)} className="btn-ghost flex-1 justify-center border border-gray-200">{t('common.cancel')}</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? t('user.profile.saving') : editing ? t('common.edit') : t('common.create')}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={pricingModal}
        onClose={() => setPricingModal(false)}
        size="xl"
        title={pricingForm
          ? `${isEn ? 'Configure' : 'Configurer'} ${getServiceTypeLabel(pricingForm.service_type, isEn)}`
          : ''}
      >
        {pricingForm && (
          <div className="flex flex-col gap-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <NumberField
                label={isEn ? 'Price multiplier' : 'Multiplicateur de prix'}
                value={pricingForm.price_multiplier}
                min="0.1"
                max="10"
                step="0.05"
                onChange={value => setPricingForm(current => ({ ...current, price_multiplier: value }))}
              />
              <NumberField
                label={isEn ? 'Fixed fee (FCFA)' : 'Frais fixes (FCFA)'}
                value={pricingForm.fixed_fee}
                min="0"
                step="50"
                onChange={value => setPricingForm(current => ({ ...current, fixed_fee: value }))}
              />
              <NumberField
                label={isEn ? 'Slot duration (minutes)' : 'Durée du créneau (minutes)'}
                value={pricingForm.slot_duration_minutes}
                min="15"
                max="240"
                step="15"
                onChange={value => setPricingForm(current => ({ ...current, slot_duration_minutes: value }))}
              />
              <NumberField
                label={isEn ? 'Maximum capacity' : 'Capacité maximale'}
                value={pricingForm.max_requests_per_slot}
                min="1"
                max="500"
                step="1"
                onChange={value => setPricingForm(current => ({ ...current, max_requests_per_slot: value }))}
              />
            </div>
            <label className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 text-sm">
              <input
                type="checkbox"
                className="accent-[#1A8A3C]"
                checked={pricingForm.is_active}
                onChange={event => setPricingForm(current => ({
                  ...current,
                  is_active: event.target.checked,
                }))}
              />
              {isEn ? 'Allow new requests for this service' : 'Autoriser les nouvelles demandes pour ce service'}
            </label>

            <section className="rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold flex items-center gap-2">
                    <MapPinned size={16} className="text-[#1A8A3C]" />
                    {isEn ? 'Pricing by zone' : 'Tarification par zone'}
                  </h3>
                  <p className="text-xs text-gray-400 mt-1">
                    {isEn
                      ? 'A district rule has priority over a city-wide rule.'
                      : 'Une règle de quartier est prioritaire sur une règle générale de ville.'}
                  </p>
                </div>
                <button type="button" className="btn-outline text-xs"
                  onClick={() => setPricingForm(current => ({
                    ...current,
                    zone_pricing: [...current.zone_pricing, {
                      city: '',
                      district: '',
                      price_multiplier: 1,
                      fixed_fee: 0,
                    }],
                  }))}>
                  <Plus size={14} /> {isEn ? 'Zone' : 'Zone'}
                </button>
              </div>
              {pricingForm.zone_pricing.map((zone, index) => (
                <div key={index} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_90px_110px_auto] gap-2 items-end">
                  <div>
                    <label className="label">{isEn ? 'City' : 'Ville'}</label>
                    <input className="input" value={zone.city}
                      onChange={event => setPricingForm(current => ({
                        ...current,
                        zone_pricing: current.zone_pricing.map((item, itemIndex) => (
                          itemIndex === index ? { ...item, city: event.target.value } : item
                        )),
                      }))} />
                  </div>
                  <div>
                    <label className="label">{isEn ? 'District' : 'Quartier'}</label>
                    <input className="input" value={zone.district || ''}
                      onChange={event => setPricingForm(current => ({
                        ...current,
                        zone_pricing: current.zone_pricing.map((item, itemIndex) => (
                          itemIndex === index ? { ...item, district: event.target.value } : item
                        )),
                      }))} />
                  </div>
                  <div>
                    <label className="label">x Prix</label>
                    <input type="number" min="0.1" max="10" step="0.05" className="input"
                      value={zone.price_multiplier}
                      onChange={event => setPricingForm(current => ({
                        ...current,
                        zone_pricing: current.zone_pricing.map((item, itemIndex) => (
                          itemIndex === index
                            ? { ...item, price_multiplier: Number(event.target.value) }
                            : item
                        )),
                      }))} />
                  </div>
                  <div>
                    <label className="label">{isEn ? 'Fee' : 'Frais'}</label>
                    <input type="number" min="0" step="50" className="input"
                      value={zone.fixed_fee}
                      onChange={event => setPricingForm(current => ({
                        ...current,
                        zone_pricing: current.zone_pricing.map((item, itemIndex) => (
                          itemIndex === index
                            ? { ...item, fixed_fee: Number(event.target.value) }
                            : item
                        )),
                      }))} />
                  </div>
                  <button type="button" className="p-2.5 text-red-500"
                    onClick={() => setPricingForm(current => ({
                      ...current,
                      zone_pricing: current.zone_pricing.filter((_, itemIndex) => itemIndex !== index),
                    }))}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </section>

            <section className="rounded-xl border border-gray-200 p-4 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <CalendarDays size={16} className="text-[#1A8A3C]" />
                {isEn ? 'Weekly opening hours' : 'Horaires hebdomadaires'}
              </h3>
              {pricingForm.weekly_schedule.map((day, index) => {
                const labels = isEn
                  ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
                  : ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
                return (
                  <div key={day.day_of_week} className="grid grid-cols-[105px_70px_1fr_1fr_95px] gap-2 items-center text-sm">
                    <span className="font-medium">{labels[day.day_of_week]}</span>
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={day.is_open}
                        onChange={event => setPricingForm(current => ({
                          ...current,
                          weekly_schedule: current.weekly_schedule.map((item, itemIndex) => (
                            itemIndex === index ? { ...item, is_open: event.target.checked } : item
                          )),
                        }))} />
                      {isEn ? 'Open' : 'Ouvert'}
                    </label>
                    <input type="time" className="input" disabled={!day.is_open}
                      value={day.opening_time}
                      onChange={event => setPricingForm(current => ({
                        ...current,
                        weekly_schedule: current.weekly_schedule.map((item, itemIndex) => (
                          itemIndex === index ? { ...item, opening_time: event.target.value } : item
                        )),
                      }))} />
                    <input type="time" className="input" disabled={!day.is_open}
                      value={day.closing_time}
                      onChange={event => setPricingForm(current => ({
                        ...current,
                        weekly_schedule: current.weekly_schedule.map((item, itemIndex) => (
                          itemIndex === index ? { ...item, closing_time: event.target.value } : item
                        )),
                      }))} />
                    <input type="number" min="1" max="500" className="input"
                      disabled={!day.is_open}
                      title={isEn ? 'Capacity override' : 'Capacité spécifique'}
                      placeholder={String(pricingForm.max_requests_per_slot)}
                      value={day.capacity_override}
                      onChange={event => setPricingForm(current => ({
                        ...current,
                        weekly_schedule: current.weekly_schedule.map((item, itemIndex) => (
                          itemIndex === index
                            ? { ...item, capacity_override: event.target.value ? Number(event.target.value) : '' }
                            : item
                        )),
                      }))} />
                  </div>
                )
              })}
            </section>

            <section className="rounded-xl border border-gray-200 p-4">
              <h3 className="font-semibold">{isEn ? 'Exceptional closures' : 'Fermetures exceptionnelles'}</h3>
              <p className="text-xs text-gray-400 mt-1 mb-3">
                {isEn ? 'One date per line (YYYY-MM-DD).' : 'Une date par ligne (AAAA-MM-JJ).'}
              </p>
              <textarea
                className="input min-h-24 font-mono text-sm"
                value={pricingForm.blackout_dates.join('\n')}
                onChange={event => setPricingForm(current => ({
                  ...current,
                  blackout_dates: event.target.value
                    .split(/\s+/)
                    .map(value => value.trim())
                    .filter(Boolean),
                }))}
                placeholder="2026-12-25&#10;2027-01-01"
              />
            </section>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setPricingModal(false)} className="btn-ghost flex-1 justify-center border border-gray-200">
                {t('common.cancel')}
              </button>
              <button onClick={() => setPricingStepUp(true)} className="btn-primary flex-1 justify-center">
                {isEn ? 'Save' : 'Enregistrer'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <AdminStepUpModal
        isOpen={pricingStepUp}
        onClose={() => setPricingStepUp(false)}
        scope="service_configuration"
        title={isEn ? 'Confirm pricing update' : 'Confirmer la tarification'}
        description={isEn
          ? 'This change affects prices and booking capacity for users.'
          : 'Cette modification affecte les prix et la capacité de réservation des utilisateurs.'}
        onVerified={savePricing}
      />
    </div>
  )
}

function Data({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="font-semibold text-gray-800 mt-0.5">{value}</p>
    </div>
  )
}

function NumberField({ label, value, onChange, ...props }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        className="input"
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        {...props}
      />
    </div>
  )
}
