import { useState, useEffect } from 'react'
import { Search, UserCheck, UserX, Users, Plus, Trash2, Eye } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { adminApi } from '../../services/api'
import { PageHeader, PageLoader, EmptyState, ConfirmDialog, Modal, Pagination } from '../../components/common'
import AdminStepUpModal from '../../components/common/AdminStepUpModal'
import { format } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import { isValidCmPhone, formatCmPhone, normalizeCmPhone } from '../../utils/phone'

const ROLE_COLORS = { user: 'bg-blue-100 text-blue-700', collector: 'bg-green-100 text-green-700', admin: 'bg-purple-100 text-purple-700' }

const EMPTY_FORM = { name: '', email: '', phone: '', role: 'user', password: '' }

export default function AdminUsers() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const dateLocale = i18n.language?.startsWith('en') ? enUS : fr
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const LIMIT = 15
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [deleteDialog, setDeleteDialog] = useState(null)
  const [createModal, setCreateModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [stepUpTarget, setStepUpTarget] = useState(null)

  const ROLE_LABELS = { user: t('roles.user'), collector: t('roles.collector'), admin: t('roles.admin') }

  const fetchUsers = async (params = {}) => {
    setLoading(true)
    try {
      const { data } = await adminApi.users({ ...params, limit: LIMIT })
      setUsers(data.data || [])
      setTotal(data.pagination?.total || 0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { setPage(1); fetchUsers({ role: roleFilter, search, page: 1 }) }, [roleFilter])
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); fetchUsers({ role: roleFilter, search, page: 1 }) }, 400)
    return () => clearTimeout(t)
  }, [search])

  const handlePageChange = (p) => { setPage(p); fetchUsers({ role: roleFilter, search, page: p }) }

  const handleToggle = async (stepUpToken) => {
    if (!stepUpTarget) return
    try {
      await adminApi.toggleUser(
        stepUpTarget.userId,
        { is_active: !stepUpTarget.is_active },
        stepUpToken
      )
      toast.success(t('admin.users.statusSuccess'))
      setStepUpTarget(null)
      fetchUsers({ role: roleFilter, search })
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.serverError'))
    }
  }

  const handleCreateUser = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password)
      return toast.error(t('admin.users.name') + ', ' + t('admin.users.email') + ', ' + t('admin.users.password') + ' requis')
    if (form.phone && !isValidCmPhone(form.phone))
      return toast.error('Numéro de téléphone camerounais invalide')
    setSaving(true)
    try {
      await adminApi.createUser({ ...form, phone: normalizeCmPhone(form.phone) })
      toast.success(t('admin.users.createSuccess'))
      setCreateModal(false)
      setForm(EMPTY_FORM)
      fetchUsers({ role: roleFilter, search })
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.serverError'))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteUser = async () => {
    if (!deleteDialog) return
    try {
      await adminApi.deleteUser(deleteDialog.userId)
      toast.success(t('admin.users.deleteSuccess'))
      setDeleteDialog(null)
      fetchUsers({ role: roleFilter, search })
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.serverError'))
    }
  }

  return (
    <div className="fade-up">
      <PageHeader title={t('admin.users.title')} subtitle={`${total} ${t('admin.users.title').toLowerCase()}`}
        action={<button onClick={() => { setForm(EMPTY_FORM); setCreateModal(true) }} className="btn-primary"><Plus size={16} />{t('common.create')}</button>} />

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative w-full sm:flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-10" placeholder={t('admin.users.search')} value={search}
            onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="">{t('admin.users.filterRole')}</option>
          <option value="user">{t('roles.user')}</option>
          <option value="collector">{t('roles.collector')}</option>
          <option value="admin">{t('roles.admin')}</option>
        </select>
      </div>

      {loading ? <PageLoader /> : users.length === 0 ? (
        <EmptyState icon={Users} title={t('admin.users.noUsers')} description={t('admin.users.noUsersDesc')} />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/50">
                <tr>
                  {[t('admin.users.name'), t('admin.users.role'), t('admin.users.phone'), t('admin.users.status'), i18n.language?.startsWith('en') ? 'Registered' : 'Inscrit le', t('admin.users.actions')].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map(u => (
                  <tr key={u._id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-[#E8F5EE] rounded-lg flex items-center justify-center text-[#1A8A3C] font-bold text-xs flex-shrink-0">
                          {u.name?.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-800">{u.name}</p>
                          <p className="text-xs text-gray-400">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${ROLE_COLORS[u.role]}`}>{ROLE_LABELS[u.role]}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{u.phone || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {u.is_active ? `✓ ${t('common.active')}` : `✗ ${i18n.language?.startsWith('en') ? 'Suspended' : 'Suspendu'}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {format(new Date(u.created_at), 'dd MMM yyyy', { locale: dateLocale })}
                    </td>
                    <td className="px-4 py-3">
                      {u.role !== 'admin' && (
                        <div className="flex items-center gap-2">
                          {u.role === 'collector' && (
                            <button
                              onClick={() => navigate(`/admin/collectors/${u._id}`)}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[#E8F5EE] text-[#1A8A3C] hover:bg-[#C8EDDA] transition-all"
                              title={i18n.language?.startsWith('en') ? 'View profile' : 'Voir le profil'}>
                              <Eye size={13} />
                              {i18n.language?.startsWith('en') ? 'File' : 'Dossier'}
                            </button>
                          )}
                          <button
                            onClick={() => setConfirmDialog({ userId: u._id, is_active: u.is_active, name: u.name })}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                              u.is_active
                                ? 'bg-red-50 text-red-500 hover:bg-red-100'
                                : 'bg-green-50 text-green-600 hover:bg-green-100'
                            }`}>
                            {u.is_active ? <><UserX size={13} />{t('admin.users.suspend')}</> : <><UserCheck size={13} />{t('admin.users.activate')}</>}
                          </button>
                          <button
                            onClick={() => setDeleteDialog({ userId: u._id, name: u.name })}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-50 text-gray-500 hover:bg-red-50 hover:text-red-500 transition-all">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination page={page} total={total} limit={LIMIT} onChange={handlePageChange} />

      <ConfirmDialog
        isOpen={!!confirmDialog}
        onClose={() => setConfirmDialog(null)}
        onConfirm={() => setStepUpTarget(confirmDialog)}
        title={confirmDialog?.is_active ? (i18n.language?.startsWith('en') ? 'Suspend account' : 'Suspendre le compte') : (i18n.language?.startsWith('en') ? 'Activate account' : 'Activer le compte')}
        message={`${i18n.language?.startsWith('en') ? 'Are you sure you want to' : 'Êtes-vous sûr de vouloir'} ${confirmDialog?.is_active ? (i18n.language?.startsWith('en') ? 'suspend' : 'suspendre') : (i18n.language?.startsWith('en') ? 'activate' : 'activer')} ${i18n.language?.startsWith('en') ? 'the account of' : 'le compte de'} ${confirmDialog?.name} ?`}
        confirmLabel={confirmDialog?.is_active ? t('admin.users.suspend') : t('admin.users.activate')}
        danger={confirmDialog?.is_active}
      />

      <AdminStepUpModal
        isOpen={!!stepUpTarget}
        onClose={() => setStepUpTarget(null)}
        scope="user_status"
        title={i18n.language?.startsWith('en') ? 'Confirm account status change' : 'Confirmer le changement du compte'}
        onVerified={handleToggle}
      />

      <ConfirmDialog
        isOpen={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={handleDeleteUser}
        title={t('admin.users.deleteUser')}
        message={t('admin.users.deleteConfirm')}
        confirmLabel={t('common.delete')}
        danger
      />

      <Modal isOpen={createModal} onClose={() => setCreateModal(false)} title={i18n.language?.startsWith('en') ? 'New user' : 'Nouvel utilisateur'}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="label">{t('admin.users.name')} *</label>
            <input className="input" placeholder={i18n.language?.startsWith('en') ? 'Full name' : 'Nom et prénom'} value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="label">{t('admin.users.email')} *</label>
            <input className="input" type="email" placeholder="email@exemple.com" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="label">{t('admin.users.phone')}</label>
            <input className="input" placeholder="+237 6 XX XX XX XX" value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: formatCmPhone(e.target.value) }))} />
          </div>
          <div>
            <label className="label">{t('admin.users.role')} *</label>
            <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="user">{t('roles.user')}</option>
              <option value="admin">{t('roles.admin')}</option>
            </select>
          </div>
          <div>
            <label className="label">{t('admin.users.password')} *</label>
            <input className="input" type="password" placeholder={i18n.language?.startsWith('en') ? 'Min. 8 chars, 1 uppercase, 1 digit' : 'Min. 8 caractères, 1 majuscule, 1 chiffre'} value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          </div>
          <div className="flex gap-3 mt-2">
            <button onClick={() => setCreateModal(false)} className="btn-ghost flex-1 justify-center border border-gray-200">{t('common.cancel')}</button>
            <button onClick={handleCreateUser} disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? (i18n.language?.startsWith('en') ? 'Creating...' : 'Création...') : (i18n.language?.startsWith('en') ? 'Create account' : 'Créer le compte')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
