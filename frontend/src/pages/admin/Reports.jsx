import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { adminApi } from '../../services/api'
import { PageHeader, PageLoader } from '../../components/common'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid
} from 'recharts'

const COLORS = ['#1A8A3C', '#27AE60', '#4ade80', '#86efac', '#bbf7d0', '#C8EDDA', '#fbbf24', '#f87171']

export default function AdminReports() {
  const { t, i18n } = useTranslation()
  const isEn = i18n.language?.startsWith('en')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('month')

  const PERIOD_OPTIONS = [
    { value: 'week',  label: t('admin.reports.week') },
    { value: 'month', label: t('admin.reports.month') },
    { value: 'year',  label: t('admin.reports.year') },
  ]

  useEffect(() => {
    setLoading(true)
    adminApi.reports({ period }).then(r => setData(r.data.data)).finally(() => setLoading(false))
  }, [period])

  const statusLabel = (s) => t(`status.${s}`) || s

  return (
    <div className="fade-up">
      <PageHeader
        title={t('admin.reports.title')}
        subtitle={t('admin.reports.subtitle')}
        action={
          <div className="flex bg-gray-100 p-1 rounded-xl gap-1">
            {PERIOD_OPTIONS.map(p => (
              <button key={p.value} onClick={() => setPeriod(p.value)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${period === p.value ? 'bg-white text-[#1A8A3C] shadow-sm' : 'text-gray-500'}`}>
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {loading ? <PageLoader /> : !data ? (
        <div className="card p-12 text-center text-gray-400">
          <p className="text-4xl mb-3">📊</p>
          <p className="font-semibold">{isEn ? 'Unable to load reports' : 'Impossible de charger les rapports'}</p>
          <p className="text-sm mt-1">{isEn ? 'Check your connection or try another period.' : 'Vérifiez votre connexion ou essayez une autre période.'}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">

          {data.dailyRevenue?.length > 0 && (
            <div className="card p-6">
              <h3 className="font-display font-bold mb-6">{t('admin.reports.revenue')} (FCFA)</h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.dailyRevenue}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: '1px solid #E8F5EE', fontSize: '12px' }}
                    formatter={(v) => [`${parseFloat(v).toLocaleString()} FCFA`, isEn ? 'Revenue' : 'Revenu']}
                  />
                  <Line type="monotone" dataKey="amount" stroke="#1A8A3C" strokeWidth={2.5} dot={{ fill: '#1A8A3C', r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-6">

            {data.byCategory?.length > 0 && (
              <div className="card p-6">
                <h3 className="font-display font-bold mb-6">{t('admin.reports.byCategory')}</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data.byCategory} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#6b7280' }} width={100} />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: '1px solid #E8F5EE', fontSize: '12px' }}
                      formatter={(v, n) => [n === 'count' ? `${v} ${t('admin.reports.collections').toLowerCase()}` : `${parseFloat(v).toLocaleString()} FCFA`, n === 'count' ? t('admin.reports.collections') : t('admin.reports.revenueLabel')]}
                    />
                    <Bar dataKey="count" fill="#1A8A3C" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}


            {data.byStatus?.length > 0 && (
              <div className="card p-6">
                <h3 className="font-display font-bold mb-6">{t('admin.reports.byStatus')}</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={data.byStatus} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={90}
                      label={({ status, percent }) => `${statusLabel(status)} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}>
                      {data.byStatus.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, n) => [v, statusLabel(n)]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>


          {data.byCategory?.length > 0 && (
            <div className="card p-6">
              <h3 className="font-display font-bold mb-4">{t('admin.reports.revenueLabel')} {isEn ? 'by category' : 'par catégorie'}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100">
                    <tr>
                      <th className="text-left py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.categories.name')}</th>
                      <th className="text-right py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.reports.collections')}</th>
                      <th className="text-right py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.reports.revenueLabel')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.byCategory.map((cat, i) => (
                      <tr key={i}>
                        <td className="py-3 font-medium text-gray-700">{cat.name}</td>
                        <td className="py-3 text-right text-gray-500">{cat.count}</td>
                        <td className="py-3 text-right font-semibold text-[#1A8A3C]">{parseFloat(cat.revenue || 0).toLocaleString()} FCFA</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.byCategory?.length === 0 && data.byStatus?.length === 0 && (
            <div className="card p-12 text-center text-gray-400">
              <p className="text-4xl mb-3">📊</p>
              <p className="font-semibold">{t('admin.reports.noData')}</p>
              <p className="text-sm mt-1">{isEn ? 'Charts will appear once collections are completed.' : 'Les graphiques apparaîtront dès que des collectes seront complétées.'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
