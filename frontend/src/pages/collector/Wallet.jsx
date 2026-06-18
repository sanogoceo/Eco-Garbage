import { useEffect, useState } from 'react'
import { ArrowDownToLine, Loader2, WalletCards } from 'lucide-react'
import toast from 'react-hot-toast'
import { collectorApi } from '../../services/api'
import { PageHeader, PageLoader } from '../../components/common'

export default function CollectorWallet() {
  const [data, setData] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ amount: '', method: 'mtn_momo', phone: '' })

  const load = () => collectorApi.wallet().then((response) => setData(response.data.data))
  useEffect(() => { load() }, [])

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      await collectorApi.requestWithdrawal({ ...form, amount: Number(form.amount) })
      toast.success('Demande de retrait envoyee')
      setForm((current) => ({ ...current, amount: '' }))
      await load()
    } catch (error) {
      toast.error(error.response?.data?.message || 'Retrait impossible')
    } finally {
      setSubmitting(false)
    }
  }

  if (!data) return <PageLoader />
  const wallet = data.wallet || {}

  return (
    <div className="fade-up max-w-4xl mx-auto">
      <PageHeader title="Mon portefeuille" subtitle="Gains, commissions et retraits Mobile Money" />
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        {[
          ['Disponible', wallet.available_balance, 'text-[#1A8A3C]'],
          ['En attente', wallet.pending_balance, 'text-orange-500'],
          ['Total gagne', wallet.total_earned, 'text-blue-600'],
        ].map(([label, amount, color]) => (
          <div key={label} className="card p-5">
            <p className="text-xs text-gray-400">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{Number(amount || 0).toLocaleString()} FCFA</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-5">
        <form onSubmit={submit} className="card p-5 h-fit flex flex-col gap-4">
          <h3 className="font-display font-bold flex items-center gap-2">
            <ArrowDownToLine size={18} /> Demander un retrait
          </h3>
          <div>
            <label className="label">Montant (minimum 500 FCFA)</label>
            <input className="input" type="number" min="500" required value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })} />
          </div>
          <div>
            <label className="label">Methode</label>
            <select className="input" value={form.method}
              onChange={(event) => setForm({ ...form, method: event.target.value })}>
              <option value="mtn_momo">MTN Mobile Money</option>
              <option value="orange_money">Orange Money</option>
            </select>
          </div>
          <div>
            <label className="label">Numero Mobile Money</label>
            <input className="input" required placeholder="+2376XXXXXXXX"
              value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </div>
          <button className="btn-primary justify-center" disabled={submitting}>
            {submitting ? <Loader2 size={17} className="spinner" /> : <WalletCards size={17} />}
            Envoyer
          </button>
        </form>

        <div className="card p-5">
          <h3 className="font-display font-bold mb-4">Historique</h3>
          <div className="flex flex-col divide-y divide-gray-100">
            {(data.transactions || []).length === 0 && (
              <p className="text-sm text-gray-400 py-8 text-center">Aucune transaction.</p>
            )}
            {(data.transactions || []).map((transaction) => (
              <div key={transaction.uuid} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{transaction.description}</p>
                  <p className="text-xs text-gray-400">{new Date(transaction.created_at).toLocaleString()}</p>
                </div>
                <p className={`font-bold ${transaction.amount >= 0 ? 'text-[#1A8A3C]' : 'text-red-500'}`}>
                  {transaction.amount >= 0 ? '+' : ''}{Number(transaction.amount).toLocaleString()} FCFA
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
