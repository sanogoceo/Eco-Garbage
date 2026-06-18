import { useEffect, useState } from 'react'
import {
  BarChart3, Building2, Download, Eye, Loader2, MapPin, Pause, Play, Plus, Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { businessContractApi } from '../../services/api'
import { getCurrentPosition } from '../../utils/geolocation'
import { EmptyState, Modal, PageHeader, PageLoader } from '../../components/common'
import StructuredAddressFields from '../../components/common/StructuredAddressFields'

const emptySite = () => ({
  name: '',
  city: '',
  district: '',
  address_line: '',
  landmark: '',
  latitude: '',
  longitude: '',
  contact_name: '',
  contact_phone: '',
})

const emptyForm = () => ({
  company_name: '',
  registration_number: '',
  tax_id: '',
  billing_email: '',
  billing_address: '',
  contact_name: '',
  monthly_quota: 20,
  billing_cycle: 'monthly',
  sites: [emptySite()],
})

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-700',
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-500',
}

const STATUS_LABELS = {
  pending: 'En attente admin',
  active: 'Actif',
  suspended: 'Suspendu',
  rejected: 'Refuse',
  expired: 'Expire',
}

export default function BusinessContracts() {
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [dashboard, setDashboard] = useState(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)

  const load = async () => {
    try {
      const response = await businessContractApi.list()
      setContracts(response.data.data || [])
    } catch (error) {
      toast.error(error.response?.data?.message || 'Chargement des contrats impossible')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const updateSite = (index, changes) => {
    setErrors(current => Object.fromEntries(
      Object.entries(current).filter(([key]) => !key.startsWith(`sites.${index}.`))
    ))
    setForm(current => ({
      ...current,
      sites: current.sites.map((site, siteIndex) => (
        siteIndex === index ? { ...site, ...changes } : site
      )),
    }))
  }

  const setCompanyField = (field, value) => {
    setErrors(current => ({ ...current, [field]: undefined }))
    setForm(current => ({ ...current, [field]: value }))
  }

  const validateForm = () => {
    const nextErrors = {}
    if (form.company_name.trim().length < 2) {
      nextErrors.company_name = 'La raison sociale doit contenir au moins 2 caractères.'
    }
    if (form.registration_number.trim().length < 3) {
      nextErrors.registration_number = 'Saisissez le RCCM ou le numéro d’immatriculation.'
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.billing_email.trim())) {
      nextErrors.billing_email = 'Saisissez un email de facturation valide.'
    }
    if (form.billing_address.trim().length < 5) {
      nextErrors.billing_address = 'L’adresse de facturation doit contenir au moins 5 caractères.'
    }
    if (form.contact_name.trim().length < 2) {
      nextErrors.contact_name = 'Saisissez le nom du responsable du contrat.'
    }
    form.sites.forEach((site, index) => {
      if (site.name.trim().length < 2) {
        nextErrors[`sites.${index}.name`] = `Saisissez le nom du site ${index + 1}.`
      }
      if (!site.city.trim() || !site.district.trim() || !site.address_line.trim()) {
        nextErrors[`sites.${index}.address`] =
          `Complétez la ville, le quartier et l’adresse du site ${index + 1}.`
      }
      if (
        !Number.isFinite(Number(site.latitude))
        || !Number.isFinite(Number(site.longitude))
        || (Number(site.latitude) === 0 && Number(site.longitude) === 0)
      ) {
        nextErrors[`sites.${index}.location`] =
          `Appuyez sur « Positionner ce site » pour le site ${index + 1}.`
      }
    })
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const locateSite = async (index) => {
    try {
      const position = await getCurrentPosition()
      updateSite(index, {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      })
      toast.success('Position du site enregistrée')
    } catch (error) {
      toast.error(error.message)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!validateForm()) {
      toast.error('Corrigez les champs indiqués en rouge.')
      return
    }
    setSaving(true)
    try {
      await businessContractApi.create(form)
      toast.success('Contrat cree. Il attend la validation admin.')
      setForm(emptyForm())
      setErrors({})
      await load()
    } catch (error) {
      setErrors(error.response?.data?.errors || {})
      toast.error(error.response?.data?.message || 'Création du contrat impossible')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (contract) => {
    if (!['active', 'suspended'].includes(contract.status)) {
      toast.error('Ce contrat doit d abord etre valide par l administration')
      return
    }
    try {
      await businessContractApi.update(contract.uuid, {
        status: contract.status === 'active' ? 'suspended' : 'active',
      })
      await load()
    } catch (error) {
      toast.error(error.response?.data?.message || 'Mise à jour impossible')
    }
  }

  const downloadStatement = async (contract) => {
    try {
      const month = new Date().toISOString().slice(0, 7)
      const response = await businessContractApi.monthlyStatement(contract.uuid, month)
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `releve-${contract.company_name}-${month}.html`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error.response?.data?.message || 'Relevé indisponible')
    }
  }

  const openDashboard = async (contract) => {
    setDashboardLoading(true)
    try {
      const response = await businessContractApi.dashboard(contract.uuid)
      setDashboard(response.data.data)
    } catch (error) {
      toast.error(error.response?.data?.message || 'Tableau de bord indisponible')
    } finally {
      setDashboardLoading(false)
    }
  }

  const downloadInvoice = async (invoice) => {
    if (!dashboard?.contract?.uuid) return
    try {
      const response = await businessContractApi.invoiceDownload(
        dashboard.contract.uuid,
        invoice.uuid
      )
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `facture-${invoice.invoice_number}.html`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error.response?.data?.message || 'Telechargement impossible')
    }
  }

  if (loading) return <PageLoader />

  return (
    <div className="fade-up max-w-6xl mx-auto">
      <PageHeader
        title="Contrats entreprises"
        subtitle="Centralisez vos sites, quotas et informations de facturation"
      />

      <div className="grid xl:grid-cols-[440px_1fr] gap-6">
        <form onSubmit={submit} noValidate className="card p-5 space-y-4 h-fit">
          <h2 className="font-display font-bold flex items-center gap-2">
            <Building2 size={18} /> Nouveau contrat
          </h2>
          <div>
            <label className="label">Raison sociale <span className="text-red-500">*</span></label>
            <input className={`input ${errors.company_name ? 'border-red-400' : ''}`}
              placeholder="Ex: Eco Services SARL"
              value={form.company_name}
              onChange={event => setCompanyField('company_name', event.target.value)} />
            <FieldError message={errors.company_name} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">RCCM / Immatriculation <span className="text-red-500">*</span></label>
              <input className={`input ${errors.registration_number ? 'border-red-400' : ''}`}
                placeholder="RC/DLA/2026/B/001"
                value={form.registration_number}
                onChange={event => setCompanyField('registration_number', event.target.value)} />
              <FieldError message={errors.registration_number} />
            </div>
            <div>
              <label className="label">NIU <span className="text-gray-400">(optionnel)</span></label>
              <input className="input" placeholder="M012600000001A"
                value={form.tax_id}
                onChange={event => setCompanyField('tax_id', event.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Email de facturation <span className="text-red-500">*</span></label>
            <input type="email" className={`input ${errors.billing_email ? 'border-red-400' : ''}`}
              placeholder="facturation@entreprise.cm"
              value={form.billing_email}
              onChange={event => setCompanyField('billing_email', event.target.value)} />
            <FieldError message={errors.billing_email} />
          </div>
          <div>
            <label className="label">Adresse de facturation <span className="text-red-500">*</span></label>
            <textarea className={`input ${errors.billing_address ? 'border-red-400' : ''}`}
              placeholder="Rue, quartier et ville"
              value={form.billing_address}
              onChange={event => setCompanyField('billing_address', event.target.value)} />
            <FieldError message={errors.billing_address} />
          </div>
          <div>
            <label className="label">Responsable du contrat <span className="text-red-500">*</span></label>
            <input className={`input ${errors.contact_name ? 'border-red-400' : ''}`}
              placeholder="Nom et prénom"
              value={form.contact_name}
              onChange={event => setCompanyField('contact_name', event.target.value)} />
            <FieldError message={errors.contact_name} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Quota mensuel</label>
              <input type="number" min="1" max="10000" className="input"
                value={form.monthly_quota}
                onChange={event => setForm({ ...form, monthly_quota: Number(event.target.value) })} />
            </div>
            <div>
              <label className="label">Facturation</label>
              <select className="input" value={form.billing_cycle}
                onChange={event => setForm({ ...form, billing_cycle: event.target.value })}>
                <option value="monthly">Mensuelle consolidée</option>
                <option value="per_collection">Par collecte</option>
              </select>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Sites de collecte</h3>
              <button type="button" className="btn-outline text-xs"
                onClick={() => setForm(current => ({
                  ...current,
                  sites: [...current.sites, emptySite()],
                }))}>
                <Plus size={14} /> Ajouter
              </button>
            </div>
            {form.sites.map((site, index) => (
              <div key={index} className="rounded-xl border border-gray-200 p-4 space-y-3">
                <div className="flex gap-2">
                  <input className={`input ${errors[`sites.${index}.name`] ? 'border-red-400' : ''}`}
                    placeholder={`Nom du site ${index + 1}`}
                    value={site.name}
                    onChange={event => updateSite(index, { name: event.target.value })} />
                  {form.sites.length > 1 && (
                    <button type="button" className="p-2 text-red-500"
                      onClick={() => setForm(current => ({
                        ...current,
                        sites: current.sites.filter((_, siteIndex) => siteIndex !== index),
                      }))}>
                      <Trash2 size={17} />
                    </button>
                  )}
                </div>
                <FieldError message={errors[`sites.${index}.name`]} />
                <StructuredAddressFields
                  value={site}
                  onChange={next => updateSite(index, next)}
                />
                <FieldError message={errors[`sites.${index}.address`]} />
                <button type="button" onClick={() => locateSite(index)}
                  className={`btn-outline w-full justify-center ${
                    errors[`sites.${index}.location`]
                      ? 'border-red-400 text-red-600'
                      : site.latitude
                        ? 'border-green-500 text-green-700'
                        : ''
                  }`}>
                  <MapPin size={16} />
                  {site.latitude ? 'Position GPS enregistrée' : 'Positionner ce site'}
                </button>
                <FieldError message={errors[`sites.${index}.location`]} />
                <div className="grid grid-cols-2 gap-3">
                  <input className="input" placeholder="Contact du site"
                    value={site.contact_name}
                    onChange={event => updateSite(index, { contact_name: event.target.value })} />
                  <input className="input" placeholder="Téléphone du site"
                    value={site.contact_phone}
                    onChange={event => updateSite(index, { contact_phone: event.target.value })} />
                </div>
              </div>
            ))}
          </div>

          <button className="btn-primary w-full justify-center" disabled={saving}>
            {saving ? <Loader2 size={17} className="spinner" /> : <Building2 size={17} />}
            Créer le contrat
          </button>
        </form>

        <div className="space-y-4">
          {contracts.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="Aucun contrat entreprise"
              description="Créez un contrat pour réutiliser vos sites et votre facturation."
            />
          ) : contracts.map(contract => (
            <article key={contract.uuid} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display font-bold text-lg">{contract.company_name}</h2>
                  <p className="text-sm text-gray-400">{contract.registration_number}</p>
                  <span className={`badge mt-2 ${STATUS_STYLES[contract.status] || STATUS_STYLES.pending}`}>
                    {STATUS_LABELS[contract.status] || contract.status}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => downloadStatement(contract)}
                    className="btn-outline p-2" title="Relevé mensuel">
                    <Download size={17} />
                  </button>
                  <button type="button" onClick={() => openDashboard(contract)}
                    className="btn-outline p-2" title="Tableau entreprise">
                    <Eye size={17} />
                  </button>
                  {['active', 'suspended'].includes(contract.status) && (
                    <button type="button" onClick={() => toggle(contract)} className="btn-outline p-2">
                      {contract.status === 'active' ? <Pause size={17} /> : <Play size={17} />}
                    </button>
                  )}
                </div>
              </div>
              {contract.status === 'pending' && (
                <p className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
                  Ce contrat est en attente de validation par l administrateur. Il apparaitra
                  dans la creation de collecte entreprise apres approbation.
                </p>
              )}
              {contract.status === 'rejected' && contract.review_notes && (
                <p className="mt-3 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  Motif du refus: {contract.review_notes}
                </p>
              )}
              <div className="mt-4 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full bg-[#1A8A3C]"
                  style={{
                    width: `${Math.min(100, (contract.used_this_month / contract.monthly_quota) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {contract.used_this_month} / {contract.monthly_quota} collectes utilisées ce mois
              </p>
              <div className="grid sm:grid-cols-2 gap-3 mt-4">
                {contract.sites.map(site => (
                  <div key={site._id} className="rounded-xl bg-gray-50 p-3">
                    <p className="font-semibold text-sm">{site.name}</p>
                    <span className={`badge mt-1 ${
                      site.status === 'active'
                        ? 'bg-green-100 text-green-700'
                        : site.status === 'rejected'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                    }`}>
                      {site.status === 'active'
                        ? 'Site valide'
                        : site.status === 'rejected'
                          ? 'Site refuse'
                          : 'Validation site en attente'}
                    </span>
                    <p className="text-xs text-gray-500 mt-1">
                      {site.address_line}, {site.district}, {site.city}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
      <Modal
        isOpen={!!dashboard || dashboardLoading}
        onClose={() => setDashboard(null)}
        title="Tableau de bord entreprise"
        size="xl"
      >
        {dashboardLoading ? <PageLoader /> : dashboard && (
          <div className="space-y-5">
            <div className="grid sm:grid-cols-4 gap-3">
              <Stat label="Collectes du mois" value={dashboard.stats.requests} />
              <Stat
                label="Depenses du mois"
                value={`${Number(dashboard.stats.total_amount || 0).toLocaleString()} FCFA`}
              />
              <Stat
                label="Encours differe"
                value={`${Number(dashboard.stats.outstanding_amount || 0).toLocaleString()} FCFA`}
              />
              <Stat
                label="Credit restant"
                value={`${Number(dashboard.stats.credit_remaining || 0).toLocaleString()} FCFA`}
              />
            </div>
            <section className="rounded-xl border border-gray-200 p-4">
              <h3 className="font-display font-bold flex items-center gap-2 mb-3">
                <BarChart3 size={16} className="text-[#1A8A3C]" />
                Activite par site
              </h3>
              {dashboard.by_site.length === 0 ? (
                <p className="text-sm text-gray-400">Aucune collecte ce mois.</p>
              ) : dashboard.by_site.map(row => (
                <div key={row.label} className="flex justify-between text-sm py-2 border-b border-gray-50 last:border-0">
                  <span>{row.label}</span>
                  <strong>{row.count}</strong>
                </div>
              ))}
            </section>
            <section className="rounded-xl border border-gray-200 p-4">
              <h3 className="font-display font-bold mb-3">Factures recentes</h3>
              {dashboard.invoices.length === 0 ? (
                <p className="text-sm text-gray-400">Aucune facture generee.</p>
              ) : dashboard.invoices.map(invoice => (
                <div key={invoice.uuid} className="flex justify-between gap-3 text-sm py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="font-semibold">{invoice.invoice_number}</p>
                    <p className="text-xs text-gray-400">
                      {invoice.month} - echeance {new Date(invoice.due_at).toLocaleDateString('fr-FR')}
                    </p>
                    <button type="button" onClick={() => downloadInvoice(invoice)}
                      className="text-xs font-semibold text-[#1A8A3C] underline mt-1">
                      Telecharger
                    </button>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{Number(invoice.amount || 0).toLocaleString()} FCFA</p>
                    <p className="text-xs text-gray-400">{invoice.status}</p>
                  </div>
                </div>
              ))}
            </section>
          </div>
        )}
      </Modal>
    </div>
  )
}

function FieldError({ message }) {
  return message ? <p className="text-xs text-red-500 mt-1">{message}</p> : null
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-[#E8F5EE] p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-display font-bold text-[#1A8A3C] mt-1">{value}</p>
    </div>
  )
}
