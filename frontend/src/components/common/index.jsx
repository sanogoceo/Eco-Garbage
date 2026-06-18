import { Leaf } from 'lucide-react'
import { useTranslation } from 'react-i18next'


export function Spinner({ size = 'md', className = '' }) {
  const s = size === 'sm' ? 'w-5 h-5 border-2' : size === 'lg' ? 'w-10 h-10 border-4' : 'w-8 h-8 border-4'
  return <span className={`${s} border-[#1A8A3C] border-t-transparent rounded-full spinner inline-block ${className}`} />
}

export function PageLoader() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <Spinner size="lg" />
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      </div>
    </div>
  )
}


export function StatusBadge({ status }) {
  const { t } = useTranslation()
  const label = t(`status.${status}`, { defaultValue: status })
  return <span className={`badge-${status} badge`}>{label}</span>
}


export function StatCard({ icon: Icon, label, value, sub, color = 'green', trend }) {
  const colors = {
    green:  { bg: 'bg-[#E8F5EE]',  text: 'text-[#1A8A3C]' },
    yellow: { bg: 'bg-yellow-50',  text: 'text-yellow-600' },
    blue:   { bg: 'bg-blue-50',      text: 'text-blue-600' },
    red:    { bg: 'bg-red-50',        text: 'text-red-500' },
    purple: { bg: 'bg-purple-50',  text: 'text-purple-600' },
  }
  const c = colors[color] || colors.green
  return (
    <div className="card p-3 md:p-5">
      <div className="flex items-start justify-between mb-2 md:mb-3">
        <div className={`w-9 md:w-11 h-9 md:h-11 ${c.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
          <Icon size={16} className={`${c.text} md:w-[20px] md:h-[20px]`} />
        </div>
        {trend !== undefined && (
          <span className={`text-xs font-semibold ${trend >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {trend >= 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <p className="text-lg md:text-2xl font-display font-bold text-gray-900">{value}</p>
      <p className="text-xs md:text-sm font-medium text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}


export function EmptyState({ icon: Icon = Leaf, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 md:py-16 text-center">
      <div className="w-12 md:w-16 h-12 md:h-16 bg-[#E8F5EE] rounded-2xl flex items-center justify-center mb-3 md:mb-4">
        <Icon size={24} className={`text-[#1A8A3C] md:w-[28px] md:h-[28px]`} />
      </div>
      <h3 className="text-base md:text-lg font-semibold text-gray-700 mb-1 md:mb-2">{title}</h3>
      <p className="text-xs md:text-sm text-gray-400 max-w-xs">{description}</p>
      {action && <div className="mt-4 md:mt-6">{action}</div>}
    </div>
  )
}


export function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  if (!isOpen) return null
  const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-xl w-full max-h-[92vh] flex flex-col ${sizes[size]} fade-up`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-display font-bold">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">✕</button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}


export function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, confirmLabel, danger = false }) {
  const { t } = useTranslation()
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-gray-600 mb-6">{message}</p>
      <div className="flex gap-3">
        <button onClick={onClose} className="btn-outline flex-1 justify-center">{t('common.cancel')}</button>
        <button
          onClick={() => { onConfirm(); onClose(); }}
          className={`flex-1 justify-center ${danger ? 'inline-flex items-center gap-2 bg-red-500 text-white px-6 py-3 rounded-xl font-semibold text-sm hover:bg-red-600 transition-all' : 'btn-primary'}`}
        >
          {confirmLabel || t('common.confirm')}
        </button>
      </div>
    </Modal>
  )
}


export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="text-sm text-gray-400 mt-1">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}


export function Field({ label, error, required, children }) {
  return (
    <div className="form-group">
      {label && (
        <label className="label">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}


export function Table({ columns, data, emptyMessage }) {
  const { t } = useTranslation()
  const msg = emptyMessage || t('common.noData')
  if (!data?.length) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-12 text-sm text-gray-400">{msg}</div>
      </div>
    )
  }
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100">
            <tr>
              {columns.map(col => (
                <th key={col.key} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                {columns.map(col => (
                  <td key={col.key} className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    {col.render ? col.render(row) : row[col.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


export function Select({ options, value, onChange, placeholder, className = '' }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={`input ${className}`}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}


export function Pagination({ page, total, limit, onChange }) {
  const { t } = useTranslation()
  const totalPages = Math.ceil(total / limit)
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-2 mt-6">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}
        className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
        {t('common.previous')}
      </button>
      <span className="text-sm text-gray-500">{t('common.page')} {page} {t('common.of')} {totalPages}</span>
      <button disabled={page >= totalPages} onClick={() => onChange(page + 1)}
        className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
        {t('common.next')}
      </button>
    </div>
  )
}
