import { useState, useEffect } from 'react'
import { Search, UserPlus, CheckCircle, XCircle, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { adminApi, requestApi } from '../../services/api'
import { PageHeader, StatusBadge, PageLoader, EmptyState, Modal, Pagination } from '../../components/common'
import { format } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import { createOperationId } from '../../services/offlineQueue'
import AdminStepUpModal from '../../components/common/AdminStepUpModal'

export default function AdminRequests() {
  const { t, i18n } = useTranslation()
  const dateLocale = i18n.language?.startsWith('en') ? enUS : fr
  const isEn = i18n.language?.startsWith('en')
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [collectors, setCollectors] = useState([])
  const [assignModal, setAssignModal] = useState(null)
  const [selectedCollector, setSelectedCollector] = useState('')
  const [refundModal, setRefundModal] = useState(null)
  const [refundReason, setRefundReason] = useState('')
  const [refunding, setRefunding] = useState(false)
  const [refundStepUp, setRefundStepUp] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const LIMIT = 15

  const loadData = async (p = page) => {
    setLoading(true)
    try {
      const params = { limit: LIMIT, page: p }
      if (statusFilter) params.status = statusFilter
      const { data } = await adminApi.requests(params)
      setRequests(data.data || [])
      setTotal(data.pagination?.total || 0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { setPage(1); loadData(1) }, [statusFilter])

  useEffect(() => {
    adminApi.users({ role: 'collector', limit: 100 }).then(r => setCollectors(r.data.data || []))
  }, [])

  const handleAssign = async () => {
    if (!selectedCollector) return toast.error(isEn ? 'Select a collector' : 'Sélectionnez un collecteur')
    try {
      await requestApi.assign(assignModal.uuid, { collector_id: selectedCollector })
      toast.success(isEn ? 'Collector assigned!' : 'Collecteur assigné !')
      setAssignModal(null)
      loadData()
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.serverError'))
    }
  }

  const handleApprove = async (uuid) => {
    try {
      await requestApi.updateStatus(uuid, { status: 'approved' })
      toast.success(isEn ? 'Request approved' : 'Demande approuvée')
      loadData()
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.serverError'))
    }
  }

  const handleReject = async (uuid) => {
    try {
      await requestApi.updateStatus(uuid, { status: 'cancelled' })
      toast.success(isEn ? 'Request rejected' : 'Demande rejetée')
      loadData()
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.serverError'))
    }
  }

  const requestRefundConfirmation = () => {
    if (refundReason.trim().length < 5) {
      return toast.error(isEn ? 'A detailed reason is required' : 'Un motif détaillé est obligatoire')
    }
    setRefundStepUp(true)
  }

  const handleRefund = async (stepUpToken) => {
    if (refundReason.trim().length < 5) {
      return toast.error(isEn ? 'A detailed reason is required' : 'Un motif détaillé est obligatoire')
    }
    setRefunding(true)
    try {
      await adminApi.refundPayment(
        refundModal.payment_uuid,
        { reason: refundReason.trim() },
        createOperationId(),
        stepUpToken
      )
      toast.success(isEn
        ? 'Refund initiated. Provider confirmation pending.'
        : 'Remboursement initié. Confirmation du fournisseur en attente.')
      setRefundModal(null)
      setRefundReason('')
      setRefundStepUp(false)
      loadData()
    } catch (error) {
      toast.error(error.response?.data?.message || t('common.serverError'))
    } finally {
      setRefunding(false)
    }
  }

  const filtered = requests.filter(r =>
    !search || r.user_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.category_name?.toLowerCase().includes(search.toLowerCase())
  )

  const headers = [
    t('admin.requests.user'), t('admin.requests.category'), t('admin.requests.address'),
    t('admin.requests.status'), t('admin.requests.price'), t('admin.requests.date'),
    t('admin.requests.collector'), isEn ? 'Actions' : 'Actions'
  ]

  return (
    <div className="fade-up">
      <PageHeader title={t('admin.requests.title')} subtitle={`${total} ${isEn ? 'request(s)' : 'demande(s)'}`} />

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative w-full sm:flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-10" placeholder={t('common.search') + '...'} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">{t('admin.requests.filterStatus')}</option>
          {['pending','approved','assigned','on_way','in_progress','completed','cancelled','failed'].map(s => (
            <option key={s} value={s}>{t(`status.${s}`)}</option>
          ))}
        </select>
      </div>

      {loading ? <PageLoader /> : filtered.length === 0 ? (
        <EmptyState title={t('admin.requests.noRequests')} description={t('admin.requests.noRequestsDesc')} />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/50">
                <tr>
                  {headers.map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(r => (
                  <tr key={r.uuid} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{r.user_name}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.category_name}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-[180px] truncate">{r.address}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 text-[#1A8A3C] font-semibold whitespace-nowrap">
                      {r.estimated_price ? `${parseFloat(r.estimated_price).toLocaleString()} FCFA` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {format(new Date(r.created_at), 'dd MMM', { locale: dateLocale })}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{r.collector_name || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {r.status === 'pending' && (
                          <>
                            <button onClick={() => handleApprove(r.uuid)}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-semibold hover:bg-green-100 transition-all">
                              <CheckCircle size={13} /> {isEn ? 'Approve' : 'Approuver'}
                            </button>
                            <button onClick={() => handleReject(r.uuid)}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100 transition-all">
                              <XCircle size={13} /> {isEn ? 'Reject' : 'Rejeter'}
                            </button>
                          </>
                        )}
                        {r.status === 'approved' && (
                          <button onClick={() => setAssignModal(r)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#E8F5EE] text-[#1A8A3C] rounded-lg text-xs font-semibold hover:bg-[#C8EDDA] transition-all">
                            <UserPlus size={13} /> {isEn ? 'Assign' : 'Assigner'}
                          </button>
                        )}
                        {r.payment_status === 'completed' && r.payment_uuid && (
                          <button
                            onClick={() => setRefundModal(r)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg text-xs font-semibold hover:bg-orange-100 transition-all"
                          >
                            <RotateCcw size={13} /> {isEn ? 'Refund' : 'Rembourser'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Pagination page={page} total={total} limit={LIMIT} onChange={p => { setPage(p); loadData(p) }} />

      <Modal isOpen={!!assignModal} onClose={() => setAssignModal(null)} title={isEn ? 'Assign a collector' : 'Assigner un collecteur'}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-500">
            {isEn ? 'Request from:' : 'Demande de :'} <strong className="">{assignModal?.user_name}</strong> — {assignModal?.category_name}
          </p>
          <div>
            <label className="label">{t('roles.collector')}</label>
            <select className="input" value={selectedCollector} onChange={e => setSelectedCollector(e.target.value)}>
              <option value="">{isEn ? 'Select a collector...' : 'Sélectionnez un collecteur...'}</option>
              {collectors.map(c => <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setAssignModal(null)} className="btn-ghost flex-1 justify-center border border-gray-200">{t('common.cancel')}</button>
            <button onClick={handleAssign} className="btn-primary flex-1 justify-center">{t('common.confirm')}</button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!refundModal}
        onClose={() => setRefundModal(null)}
        title={isEn ? 'Refund payment' : 'Rembourser le paiement'}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-500">
            {isEn
              ? 'The full amount will be refunded after provider confirmation.'
              : 'Le montant total sera remboursé après confirmation du fournisseur.'}
          </p>
          <textarea
            className="input min-h-[100px] resize-none"
            value={refundReason}
            onChange={(event) => setRefundReason(event.target.value)}
            placeholder={isEn ? 'Refund reason...' : 'Motif du remboursement...'}
          />
          <div className="flex gap-3">
            <button
              onClick={() => setRefundModal(null)}
              className="btn-ghost flex-1 justify-center border border-gray-200"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={requestRefundConfirmation}
              disabled={refunding}
              className="btn-primary flex-1 justify-center"
            >
              {refunding ? (isEn ? 'Processing...' : 'Traitement...') : t('common.confirm')}
            </button>
          </div>
        </div>
      </Modal>
      <AdminStepUpModal
        isOpen={refundStepUp}
        onClose={() => setRefundStepUp(false)}
        scope="payment_refund"
        title={isEn ? 'Confirm refund' : 'Confirmer le remboursement'}
        onVerified={handleRefund}
      />
    </div>
  )
}
