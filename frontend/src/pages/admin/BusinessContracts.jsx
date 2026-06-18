import { useCallback, useEffect, useState } from 'react'
import {
  Building2, CheckCircle, Download, Eye, FileText, PauseCircle, Save, Search, ShieldX,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { adminApi } from '../../services/api'
import { EmptyState, Modal, PageHeader, PageLoader, Spinner } from '../../components/common'
import AdminStepUpModal from '../../components/common/AdminStepUpModal'

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-700',
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-500',
}

const STATUS_LABELS = {
  pending: 'En attente',
  active: 'Actif',
  suspended: 'Suspendu',
  rejected: 'Refuse',
  expired: 'Expire',
}

const SITE_STATUS_LABELS = {
  pending: 'En attente',
  active: 'Valide',
  suspended: 'Suspendu',
  rejected: 'Refuse',
}

function DataField({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="font-medium text-gray-800 break-words">{value || '-'}</p>
    </div>
  )
}

export default function AdminBusinessContracts() {
  const { i18n } = useTranslation()
  const isEn = i18n.language?.startsWith('en')
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const [notes, setNotes] = useState('')
  const [pendingDecision, setPendingDecision] = useState('')
  const [pendingAction, setPendingAction] = useState(null)
  const [terms, setTerms] = useState({
    payment_terms_days: 30,
    credit_limit: 0,
    price_multiplier: 1,
    fixed_fee: 0,
  })
  const [reviewing, setReviewing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await adminApi.businessContracts({
        ...(filter ? { status: filter } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      })
      setContracts(response.data.data || [])
    } catch (error) {
      toast.error(error.response?.data?.message || 'Chargement des contrats impossible')
    } finally {
      setLoading(false)
    }
  }, [filter, search])

  useEffect(() => {
    load()
  }, [load])

  const loadInvoices = async (contractUuid) => {
    setInvoiceLoading(true)
    try {
      const response = await adminApi.businessInvoices(contractUuid)
      setInvoices(response.data.data || [])
    } catch (error) {
      toast.error(error.response?.data?.message || 'Chargement des factures impossible')
    } finally {
      setInvoiceLoading(false)
    }
  }

  const openDetails = (contract) => {
    setSelected(contract)
    setInvoices([])
    setNotes(contract.review_notes || '')
    setTerms({
      payment_terms_days: contract.payment_terms_days ?? 30,
      credit_limit: contract.credit_limit ?? 0,
      price_multiplier: contract.negotiated_pricing?.price_multiplier ?? 1,
      fixed_fee: contract.negotiated_pricing?.fixed_fee ?? 0,
    })
    setPendingDecision('')
    setPendingAction(null)
    loadInvoices(contract.uuid)
  }

  const closeDetails = () => {
    setSelected(null)
    setInvoices([])
    setNotes('')
    setPendingDecision('')
    setPendingAction(null)
  }

  const requestDecision = (decision) => {
    if (decision === 'rejected' && notes.trim().length < 5) {
      return toast.error('Le motif du refus est obligatoire')
    }
    setPendingDecision(decision)
    setPendingAction({ type: 'contract', decision })
  }

  const requestSiteDecision = (site, decision) => {
    setPendingDecision(decision)
    setPendingAction({ type: 'site', siteId: site._id, decision })
  }

  const requestTermsSave = () => {
    setPendingDecision('terms')
    setPendingAction({ type: 'terms' })
  }

  const requestInvoice = () => {
    setPendingDecision('invoice')
    setPendingAction({ type: 'invoice', month: new Date().toISOString().slice(0, 7) })
  }

  const requestInvoiceStatus = (invoice, status) => {
    setPendingDecision(`invoice_${status}`)
    setPendingAction({
      type: 'invoiceStatus',
      invoiceUuid: invoice.uuid,
      status,
      payment_reference: invoice.invoice_number,
    })
  }

  const downloadInvoice = async (invoice) => {
    try {
      const response = await adminApi.businessInvoiceDownload(selected.uuid, invoice.uuid)
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

  const review = async (stepUpToken) => {
    setReviewing(true)
    try {
      if (pendingAction?.type === 'site') {
        await adminApi.reviewBusinessContractSite(
          selected.uuid,
          pendingAction.siteId,
          { decision: pendingAction.decision, notes: notes.trim() },
          stepUpToken
        )
      } else if (pendingAction?.type === 'terms') {
        await adminApi.updateBusinessContractTerms(
          selected.uuid,
          {
            payment_terms_days: Number(terms.payment_terms_days),
            credit_limit: Number(terms.credit_limit),
            negotiated_pricing: {
              price_multiplier: Number(terms.price_multiplier),
              fixed_fee: Number(terms.fixed_fee),
            },
          },
          stepUpToken
        )
      } else if (pendingAction?.type === 'invoice') {
        await adminApi.generateBusinessInvoice(
          selected.uuid,
          { month: pendingAction.month },
          stepUpToken
        )
      } else if (pendingAction?.type === 'invoiceStatus') {
        await adminApi.updateBusinessInvoiceStatus(
          selected.uuid,
          pendingAction.invoiceUuid,
          {
            status: pendingAction.status,
            payment_method: 'bank_transfer',
            payment_reference: pendingAction.payment_reference,
          },
          stepUpToken
        )
      } else {
        await adminApi.reviewBusinessContract(
          selected.uuid,
          { decision: pendingDecision, notes: notes.trim() },
          stepUpToken
        )
      }
      const successMessage = pendingAction?.type === 'terms'
        ? 'Conditions mises a jour'
        : pendingAction?.type === 'invoice'
          ? 'Facture generee'
          : pendingAction?.type === 'invoiceStatus'
            ? 'Facture mise a jour'
          : pendingAction?.type === 'site'
            ? 'Site mis a jour'
            : pendingDecision === 'approved'
              ? 'Contrat approuve'
              : pendingDecision === 'rejected'
                ? 'Contrat refuse'
                : 'Contrat suspendu'
      toast.success(successMessage)
      if (['invoice', 'invoiceStatus'].includes(pendingAction?.type)) {
        await loadInvoices(selected.uuid)
        setPendingDecision('')
        setPendingAction(null)
        return
      }
      closeDetails()
      await load()
    } catch (error) {
      toast.error(error.response?.data?.message || 'Decision impossible')
      throw error
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div className="fade-up">
      <PageHeader
        title={isEn ? 'Business contracts' : 'Contrats entreprises'}
        subtitle={isEn
          ? 'Review company billing, sites and monthly quotas'
          : 'Validez les entreprises, sites de collecte, quotas et facturation'}
      />

      <div className="flex flex-col lg:flex-row gap-3 mb-6">
        <div className="flex gap-2 flex-wrap flex-1">
          {['', 'pending', 'active', 'suspended', 'rejected'].map((status) => (
            <button
              key={status || 'all'}
              type="button"
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
                filter === status
                  ? 'bg-[#1A8A3C] text-white'
                  : 'bg-white text-gray-500 border border-gray-200'
              }`}
            >
              {status ? STATUS_LABELS[status] : 'Tous'}
            </button>
          ))}
        </div>
        <div className="relative lg:w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Rechercher entreprise, RCCM, email..."
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </div>
      </div>

      {loading ? <PageLoader /> : contracts.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Aucun contrat entreprise"
          description="Aucun contrat ne correspond a ce filtre."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Entreprise', 'Client', 'Quota', 'Sites', 'Statut', 'Cree le', ''].map(label => (
                    <th key={label} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {contracts.map(contract => (
                  <tr key={contract.uuid} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-800">{contract.company_name}</p>
                      <p className="text-xs text-gray-400">{contract.registration_number}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-700">{contract.user?.name || '-'}</p>
                      <p className="text-xs text-gray-400">{contract.user?.email}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {contract.used_this_month} / {contract.monthly_quota}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{contract.sites?.length || 0}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${STATUS_STYLES[contract.status] || STATUS_STYLES.pending}`}>
                        {STATUS_LABELS[contract.status] || contract.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {new Date(contract.created_at).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => openDetails(contract)}
                        className="btn-ghost p-2"
                        title="Ouvrir"
                      >
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

      <Modal
        isOpen={!!selected}
        onClose={closeDetails}
        title={selected ? selected.company_name : 'Contrat entreprise'}
        size="xl"
      >
        {selected && (
          <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
            <section className="grid sm:grid-cols-2 gap-4 text-sm">
              <DataField label="Client" value={`${selected.user?.name || '-'} (${selected.user?.email || '-'})`} />
              <DataField label="Telephone client" value={selected.user?.phone} />
              <DataField label="RCCM / Immatriculation" value={selected.registration_number} />
              <DataField label="NIU" value={selected.tax_id} />
              <DataField label="Email de facturation" value={selected.billing_email} />
              <DataField label="Adresse de facturation" value={selected.billing_address} />
              <DataField label="Responsable" value={selected.contact_name} />
              <DataField label="Facturation" value={selected.billing_cycle === 'monthly' ? 'Mensuelle' : 'Par collecte'} />
              <DataField label="Quota mensuel" value={`${selected.used_this_month} / ${selected.monthly_quota}`} />
              <DataField label="Delai de paiement" value={`${selected.payment_terms_days ?? 30} jours`} />
              <DataField label="Plafond de credit" value={`${Number(selected.credit_limit || 0).toLocaleString()} FCFA`} />
              <DataField
                label="Tarif negocie"
                value={`x${selected.negotiated_pricing?.price_multiplier ?? 1} + ${Number(selected.negotiated_pricing?.fixed_fee || 0).toLocaleString()} FCFA`}
              />
              <DataField label="Statut" value={STATUS_LABELS[selected.status] || selected.status} />
            </section>

            <section className="border-t border-gray-100 pt-5">
              <div className="mb-3">
                <h3 className="font-display font-bold text-gray-900">
                  Conditions de paiement et tarifs
                </h3>
                <p className="text-xs text-gray-400">
                  Utilisees pour le paiement differe et les prix entreprise.
                </p>
              </div>
              <div className="grid sm:grid-cols-4 gap-3">
                <div>
                  <label className="label">Delai paiement (jours)</label>
                  <input
                    type="number"
                    min="0"
                    max="90"
                    className="input"
                    value={terms.payment_terms_days}
                    onChange={event => setTerms(current => ({
                      ...current,
                      payment_terms_days: event.target.value,
                    }))}
                  />
                </div>
                <div>
                  <label className="label">Plafond credit</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    value={terms.credit_limit}
                    onChange={event => setTerms(current => ({
                      ...current,
                      credit_limit: event.target.value,
                    }))}
                  />
                </div>
                <div>
                  <label className="label">Multiplicateur</label>
                  <input
                    type="number"
                    min="0.1"
                    max="10"
                    step="0.05"
                    className="input"
                    value={terms.price_multiplier}
                    onChange={event => setTerms(current => ({
                      ...current,
                      price_multiplier: event.target.value,
                    }))}
                  />
                </div>
                <div>
                  <label className="label">Frais fixes</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    value={terms.fixed_fee}
                    onChange={event => setTerms(current => ({
                      ...current,
                      fixed_fee: event.target.value,
                    }))}
                  />
                </div>
              </div>
              <button type="button" onClick={requestTermsSave} className="btn-primary mt-3">
                <Save size={16} /> Enregistrer conditions
              </button>
            </section>

            <section className="border-t border-gray-100 pt-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="font-display font-bold text-gray-900">Factures entreprise</h3>
                  <p className="text-xs text-gray-400">
                    Generez, telechargez et confirmez les paiements mensuels.
                  </p>
                </div>
                <button type="button" onClick={requestInvoice} className="btn-outline text-xs">
                  <FileText size={14} /> Generer mois courant
                </button>
              </div>
              {invoiceLoading ? <PageLoader /> : invoices.length === 0 ? (
                <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-400">
                  Aucune facture generee pour ce contrat.
                </p>
              ) : (
                <div className="space-y-2">
                  {invoices.map(invoice => (
                    <div key={invoice.uuid} className="rounded-xl border border-gray-200 p-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold">{invoice.invoice_number}</p>
                          <p className="text-xs text-gray-400">
                            {invoice.month} - echeance {new Date(invoice.due_at).toLocaleDateString('fr-FR')}
                          </p>
                        </div>
                        <div className="sm:text-right">
                          <p className="font-bold">{Number(invoice.amount || 0).toLocaleString()} FCFA</p>
                          <span className={`badge ${
                            invoice.status === 'paid'
                              ? 'bg-green-100 text-green-700'
                              : invoice.status === 'overdue'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                          }`}>
                            {invoice.status}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <button type="button" onClick={() => downloadInvoice(invoice)}
                          className="btn-outline text-xs">
                          <Download size={14} /> Telecharger
                        </button>
                        {invoice.status !== 'paid' && (
                          <button type="button" onClick={() => requestInvoiceStatus(invoice, 'paid')}
                            className="btn-primary text-xs">
                            <CheckCircle size={14} /> Marquer payee
                          </button>
                        )}
                        {invoice.status !== 'overdue' && invoice.status !== 'paid' && (
                          <button type="button" onClick={() => requestInvoiceStatus(invoice, 'overdue')}
                            className="btn-outline text-xs text-red-600 border-red-200">
                            En retard
                          </button>
                        )}
                        {invoice.status !== 'cancelled' && invoice.status !== 'paid' && (
                          <button type="button" onClick={() => requestInvoiceStatus(invoice, 'cancelled')}
                            className="btn-outline text-xs">
                            Annuler
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="border-t border-gray-100 pt-5">
              <h3 className="font-display font-bold text-gray-900 mb-3">Sites de collecte</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                {selected.sites?.map(site => (
                  <div key={site._id} className="rounded-xl bg-gray-50 p-4 text-sm">
                    <p className="font-semibold text-gray-800">{site.name}</p>
                    <p className="text-gray-500 mt-1">
                      {site.address_line}, {site.district}, {site.city}
                    </p>
                    <p className="text-xs text-gray-400 mt-2">
                      GPS: {site.latitude}, {site.longitude}
                    </p>
                    <span className={`badge mt-2 ${
                      site.status === 'active'
                        ? 'bg-green-100 text-green-700'
                        : site.status === 'rejected'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                    }`}>
                      {SITE_STATUS_LABELS[site.status] || site.status || 'En attente'}
                    </span>
                    {(site.contact_name || site.contact_phone) && (
                      <p className="text-xs text-gray-500 mt-1">
                        Contact: {site.contact_name || '-'} {site.contact_phone || ''}
                      </p>
                    )}
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => requestSiteDecision(site, 'rejected')}
                        className="btn-outline justify-center text-xs text-red-600 border-red-200"
                      >
                        Refuser
                      </button>
                      <button
                        type="button"
                        onClick={() => requestSiteDecision(site, 'suspended')}
                        className="btn-outline justify-center text-xs"
                      >
                        Suspendre
                      </button>
                      <button
                        type="button"
                        onClick={() => requestSiteDecision(site, 'approved')}
                        className="btn-primary justify-center text-xs"
                      >
                        Valider
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="border-t border-gray-100 pt-5">
              <label className="label">Note de decision</label>
              <textarea
                className="input resize-none"
                rows={3}
                value={notes}
                onChange={event => setNotes(event.target.value)}
                placeholder="Motif du refus, reserve, observation administrative..."
              />
              <div className="grid sm:grid-cols-3 gap-3 mt-4">
                <button
                  type="button"
                  disabled={reviewing || selected.status === 'rejected'}
                  onClick={() => requestDecision('rejected')}
                  className="btn-outline justify-center text-red-600 border-red-200"
                >
                  {reviewing ? <Spinner size="sm" /> : <ShieldX size={16} />}
                  Refuser
                </button>
                <button
                  type="button"
                  disabled={reviewing || selected.status === 'suspended'}
                  onClick={() => requestDecision('suspended')}
                  className="btn-outline justify-center text-gray-600 border-gray-200"
                >
                  {reviewing ? <Spinner size="sm" /> : <PauseCircle size={16} />}
                  Suspendre
                </button>
                <button
                  type="button"
                  disabled={reviewing || selected.status === 'active'}
                  onClick={() => requestDecision('approved')}
                  className="btn-primary justify-center"
                >
                  {reviewing ? <Spinner size="sm" /> : <CheckCircle size={16} />}
                  Approuver
                </button>
              </div>
            </section>
          </div>
        )}
      </Modal>

      <AdminStepUpModal
        isOpen={!!pendingDecision}
        onClose={() => setPendingDecision('')}
        scope="business_contract_review"
        title="Confirmer la decision contrat entreprise"
        description="Cette action active ou bloque l'utilisation du contrat pour les collectes entreprise."
        onVerified={review}
      />
    </div>
  )
}
