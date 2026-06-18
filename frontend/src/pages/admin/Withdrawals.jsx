import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { adminApi } from '../../services/api'
import { PageHeader, PageLoader } from '../../components/common'

export default function AdminWithdrawals() {
  const [rows, setRows] = useState(null)
  const load = () => adminApi.withdrawals().then((response) => setRows(response.data.data || []))
  useEffect(() => { load() }, [])

  const review = async (uuid, decision) => {
    try {
      await adminApi.reviewWithdrawal(uuid, { decision })
      toast.success('Retrait mis a jour')
      await load()
    } catch (error) {
      toast.error(error.response?.data?.message || 'Operation impossible')
    }
  }

  if (!rows) return <PageLoader />
  return (
    <div className="fade-up">
      <PageHeader title="Retraits collecteurs" subtitle="Validation et paiement des gains Mobile Money" />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr><th className="p-4">Collecteur</th><th>Montant</th><th>Methode</th><th>Statut</th><th className="p-4">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.uuid}>
                <td className="p-4"><p className="font-medium">{row.collector_id?.name}</p><p className="text-xs text-gray-400">{row.phone}</p></td>
                <td className="font-bold">{Number(row.amount).toLocaleString()} FCFA</td>
                <td>{row.method}</td><td>{row.status}</td>
                <td className="p-4 flex gap-2">
                  {row.status === 'pending' && <>
                    <button className="btn-primary px-3 py-2" onClick={() => review(row.uuid, 'approved')}>Approuver</button>
                    <button className="btn-outline px-3 py-2 text-red-500" onClick={() => review(row.uuid, 'rejected')}>Refuser</button>
                  </>}
                  {row.status === 'approved' && <button className="btn-primary px-3 py-2" onClick={() => review(row.uuid, 'paid')}>Marquer paye</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
