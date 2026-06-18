import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreditCard, Download, Loader2, Smartphone } from 'lucide-react'
import { format } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { paymentApi } from '../../services/api'
import { PageHeader, PageLoader, EmptyState, StatusBadge } from '../../components/common'
import { createOperationId } from '../../services/offlineQueue'
import { useAuth } from '../../context/AuthContext'

export default function Payments() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const dateLocale = i18n.language?.startsWith('en') ? enUS : fr
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState('')

  const loadPayments = () => paymentApi.list()
    .then((response) => setPayments(response.data.data || []))
    .finally(() => setLoading(false))

  useEffect(() => { loadPayments() }, [])

  const initiate = async (payment, provider) => {
    setProcessing(`${payment.uuid}:${provider}`)
    try {
      const response = await paymentApi.initiate({
        payment_uuid: payment.uuid,
        method: 'mobile_money',
        provider,
        payer_phone: user?.phone,
      }, createOperationId())
      toast.success(response.data.message)
      await loadPayments()
    } catch (error) {
      toast.error(error.response?.data?.message || 'Impossible d’initier le paiement')
    } finally {
      setProcessing('')
    }
  }

  const downloadReceipt = async (payment) => {
    setProcessing(`${payment.uuid}:receipt`)
    try {
      const response = await paymentApi.receipt(payment.uuid)
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      const isBusiness = payment.service_type === 'business'
      const documentNumber = isBusiness
        ? payment.invoice_number
        : payment.receipt_number
      link.download = `${isBusiness ? 'facture' : 'recu'}-ecogarbage-${documentNumber || payment.uuid}.html`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Reçu indisponible')
    } finally {
      setProcessing('')
    }
  }

  const total = payments
    .filter((payment) => payment.status === 'completed')
    .reduce((sum, payment) => sum + parseFloat(payment.amount || 0), 0)

  return (
    <div className="fade-up">
      <PageHeader title={t('user.payments.title')} subtitle={t('user.payments.subtitle')} />
      {loading ? <PageLoader /> : payments.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title={t('user.payments.noPayments')}
          description={t('user.payments.noPaymentsDesc')}
        />
      ) : (
        <>
          <div className="bg-[#1A8A3C] rounded-2xl p-6 text-white mb-6">
            <p className="text-white/60 text-sm">{t('user.payments.amount')}</p>
            <p className="text-3xl font-display font-bold mt-1">
              {total.toLocaleString()} FCFA
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {payments.map((payment) => {
              const isBusiness = payment.service_type === 'business'
              return (
              <div key={payment.uuid} className="card p-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-[#E8F5EE] rounded-xl flex items-center justify-center flex-shrink-0">
                    <CreditCard size={18} className="text-[#1A8A3C]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{payment.category_name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {payment.paid_at
                        ? format(new Date(payment.paid_at), 'dd MMM yyyy HH:mm', { locale: dateLocale })
                        : t('status.pending')}
                      {payment.provider && ` · ${payment.provider}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-[#1A8A3C]">
                      {parseFloat(payment.amount).toLocaleString()} FCFA
                    </p>
                    <StatusBadge status={payment.status} />
                  </div>
                </div>

                {['pending', 'failed'].includes(payment.status) && (
                  <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-gray-100">
                    {[
                      ['mtn_momo', 'MTN MoMo'],
                      ['orange_money', 'Orange Money'],
                    ].map(([provider, label]) => (
                      <button
                        key={provider}
                        type="button"
                        className="btn-outline justify-center text-xs"
                        disabled={Boolean(processing)}
                        onClick={() => initiate(payment, provider)}
                      >
                        {processing === `${payment.uuid}:${provider}`
                          ? <Loader2 size={15} className="spinner" />
                          : <Smartphone size={15} />}
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                {payment.status === 'processing' && (
                  <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    La transaction a été initiée. EcoGarbage attend la confirmation signée du fournisseur.
                  </p>
                )}

                {['completed', 'refund_pending', 'refunded'].includes(payment.status) && (
                  <button
                    type="button"
                    onClick={() => downloadReceipt(payment)}
                    disabled={Boolean(processing)}
                    className="btn-ghost mt-3 w-full justify-center border border-gray-200 text-xs"
                  >
                    {processing === `${payment.uuid}:receipt`
                      ? <Loader2 size={15} className="spinner" />
                      : <Download size={15} />}
                    {isBusiness ? 'Télécharger la facture' : 'Télécharger le reçu'}
                  </button>
                )}
              </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
