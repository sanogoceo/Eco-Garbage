import { useEffect, useState } from 'react'
import { Copy, Lock, Save, ShieldCheck, Smartphone, Trash2, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { authApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Spinner } from '../../components/common'
import { isValidCmPhone, formatCmPhone, normalizeCmPhone } from '../../utils/phone'

export default function Profile() {
  const { t } = useTranslation()
  const { user, updateUser } = useAuth()
  const [tab, setTab] = useState('info')
  const [info, setInfo] = useState({ name: user?.name || '', phone: user?.phone ? formatCmPhone(user.phone) : '', address: user?.address || '' })
  const [phoneError, setPhoneError] = useState('')
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [saving, setSaving] = useState(false)
  const [sessions, setSessions] = useState([])
  const [securitySetup, setSecuritySetup] = useState(null)
  const [securityCode, setSecurityCode] = useState('')
  const [backupCodes, setBackupCodes] = useState([])
  const [disableForm, setDisableForm] = useState({ password: '', code: '' })

  const loadSessions = async () => {
    if (user?.role !== 'admin') return
    try {
      const response = await authApi.sessions()
      setSessions(response.data.data || [])
    } catch {
      // The profile remains usable if the session list is temporarily unavailable.
    }
  }

  useEffect(() => {
    if (tab === 'security') loadSessions()
  }, [tab])

  const handleSaveInfo = async (e) => {
    e.preventDefault()
    if (!info.name) return toast.error(t('user.profile.name') + ' requis')
    if (info.phone && !isValidCmPhone(info.phone)) return toast.error('Numéro de téléphone camerounais invalide')
    setSaving(true)
    try {
      const normalized = normalizeCmPhone(info.phone)
      await authApi.updateProfile({ ...info, phone: normalized })
      updateUser({ name: info.name, phone: normalized, address: info.address })
      toast.success(t('user.profile.profileSuccess'))
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.serverError'))
    } finally {
      setSaving(false)
    }
  }

  const handleChangePw = async (e) => {
    e.preventDefault()
    if (!pw.currentPassword || !pw.newPassword) return toast.error('Tous les champs sont requis')
    if (pw.newPassword !== pw.confirm) return toast.error('Les mots de passe ne correspondent pas')
    if (pw.newPassword.length < 6) return toast.error('Mot de passe trop court')
    setSaving(true)
    try {
      await authApi.changePassword({ currentPassword: pw.currentPassword, newPassword: pw.newPassword })
      toast.success(t('user.profile.passwordSuccess'))
      setPw({ currentPassword: '', newPassword: '', confirm: '' })
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.serverError'))
    } finally {
      setSaving(false)
    }
  }

  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U'

  const startTwoFactor = async () => {
    setSaving(true)
    try {
      const response = await authApi.enrollAdminTwoFactor()
      setSecuritySetup(response.data.data)
      setSecurityCode('')
    } catch (error) {
      toast.error(error.response?.data?.message || t('common.serverError'))
    } finally {
      setSaving(false)
    }
  }

  const enableTwoFactor = async () => {
    if (!/^\d{6}$/.test(securityCode)) return toast.error('Code à 6 chiffres requis')
    setSaving(true)
    try {
      const response = await authApi.enableAdminTwoFactor(securityCode)
      setBackupCodes(response.data.data.backup_codes || [])
      setSecuritySetup(null)
      setSecurityCode('')
      updateUser({ two_factor_enabled: true })
      toast.success('Double authentification activée')
    } catch (error) {
      toast.error(error.response?.data?.message || t('common.serverError'))
    } finally {
      setSaving(false)
    }
  }

  const disableTwoFactor = async () => {
    setSaving(true)
    try {
      await authApi.disableAdminTwoFactor(disableForm)
      updateUser({ two_factor_enabled: false })
      setDisableForm({ password: '', code: '' })
      toast.success('Double authentification désactivée')
    } catch (error) {
      toast.error(error.response?.data?.message || t('common.serverError'))
    } finally {
      setSaving(false)
    }
  }

  const revokeSession = async (session) => {
    try {
      const response = await authApi.revokeSession(session.uuid)
      if (response.data.data?.current_session_revoked) {
        window.location.href = '/login'
        return
      }
      await loadSessions()
      toast.success('Session révoquée')
    } catch (error) {
      toast.error(error.response?.data?.message || t('common.serverError'))
    }
  }

  return (
    <div className="fade-up max-w-xl mx-auto">
      <PageHeader title={t('user.profile.title')} subtitle={t('user.profile.subtitle')} />


      <div className="card p-6 mb-6 flex items-center gap-4">
        <div className="w-16 h-16 bg-[#1A8A3C] rounded-2xl flex items-center justify-center text-white font-display font-bold text-2xl">
          {initials}
        </div>
        <div>
          <p className="text-lg font-display font-bold">{user?.name}</p>
          <p className="text-sm text-[#1A8A3C] font-medium">{t(`roles.${user?.role}`)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{user?.email}</p>
        </div>
      </div>


      <div className="flex gap-2 mb-6 bg-gray-100 p-1 rounded-xl">
        {[
          ['info',     User, t('user.profile.title').split(' ')[1] || 'Info'],
          ['password', Lock, t('user.profile.changePassword')],
          ...(user?.role === 'admin'
            ? [['security', ShieldCheck, 'Sécurité']]
            : []),
        ].map(([id, Icon, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all
              ${tab === id
                ? 'bg-white text-[#1A8A3C] shadow-sm'
                : 'text-gray-500'}`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {tab === 'info' && (
        <form onSubmit={handleSaveInfo} className="card p-6 flex flex-col gap-5">
          <div>
            <label className="label">{t('user.profile.name')} <span className="text-red-500">*</span></label>
            <input className="input" value={info.name} onChange={e => setInfo(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="label">{t('user.profile.email')}</label>
            <input className="input opacity-60 cursor-not-allowed" value={user?.email} disabled />
          </div>
          <div>
            <label className="label">{t('user.profile.phone')}</label>
            <input className={`input ${phoneError ? 'border-red-400 focus:ring-red-200' : ''}`}
              placeholder="+237 6 XX XX XX XX"
              value={info.phone}
              onChange={e => {
                const formatted = formatCmPhone(e.target.value)
                setInfo(p => ({ ...p, phone: formatted }))
                setPhoneError(formatted.replace(/[\s]/g, '').length > 4 && !isValidCmPhone(formatted) ? 'Numéro invalide' : '')
              }} />
            {phoneError && <p className="text-xs text-red-500 mt-1">{phoneError}</p>}
          </div>
          <div>
            <label className="label">{t('user.profile.address')}</label>
            <textarea className="input resize-none" rows={2} value={info.address} onChange={e => setInfo(p => ({ ...p, address: e.target.value }))} />
          </div>
          <button type="submit" disabled={saving} className="btn-primary justify-center">
            {saving ? <Spinner size="sm" /> : <Save size={16} />}
            {saving ? t('user.profile.saving') : t('user.profile.saveProfile')}
          </button>
        </form>
      )}

      {tab === 'password' && (
        <form onSubmit={handleChangePw} className="card p-6 flex flex-col gap-5">
          <div>
            <label className="label">{t('user.profile.currentPassword')}</label>
            <input type="password" className="input" value={pw.currentPassword} onChange={e => setPw(p => ({ ...p, currentPassword: e.target.value }))} />
          </div>
          <div>
            <label className="label">{t('user.profile.newPassword')}</label>
            <input type="password" className="input" value={pw.newPassword} onChange={e => setPw(p => ({ ...p, newPassword: e.target.value }))} />
          </div>
          <div>
            <label className="label">{t('user.profile.confirmPassword')}</label>
            <input type="password" className="input" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
          </div>
          <button type="submit" disabled={saving} className="btn-primary justify-center">
            {saving ? <Spinner size="sm" /> : <Lock size={16} />}
            {saving ? t('user.profile.saving') : t('user.profile.savePassword')}
          </button>
        </form>
      )}

      {tab === 'security' && user?.role === 'admin' && (
        <div className="space-y-6">
          <section className="card p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display font-bold flex items-center gap-2">
                  <ShieldCheck size={18} className="text-[#1A8A3C]" />
                  Double authentification
                </h2>
                <p className="text-sm text-gray-400 mt-1">
                  Code TOTP compatible avec Google et Microsoft Authenticator.
                </p>
              </div>
              <span className={`badge ${user.two_factor_enabled ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                {user.two_factor_enabled ? 'Activée' : 'Inactive'}
              </span>
            </div>

            {!user.two_factor_enabled && !securitySetup && (
              <button onClick={startTwoFactor} disabled={saving} className="btn-primary mt-5">
                <ShieldCheck size={16} /> Activer la 2FA
              </button>
            )}

            {securitySetup && (
              <div className="mt-5 space-y-4">
                <p className="text-sm text-gray-600">
                  Ajoutez cette clé dans votre application Authenticator, puis saisissez le code généré.
                </p>
                <div className="flex items-center gap-2 rounded-xl bg-gray-50 p-3">
                  <code className="flex-1 break-all text-xs">{securitySetup.secret}</code>
                  <button onClick={() => navigator.clipboard.writeText(securitySetup.secret)}>
                    <Copy size={16} />
                  </button>
                </div>
                <a
                  href={securitySetup.provisioning_uri}
                  className="text-sm text-[#1A8A3C] font-semibold hover:underline"
                >
                  Ouvrir dans l application Authenticator
                </a>
                <input
                  className="input text-center tracking-[0.4em] font-mono"
                  inputMode="numeric"
                  value={securityCode}
                  onChange={(event) => setSecurityCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                />
                <button onClick={enableTwoFactor} disabled={saving} className="btn-primary">
                  Confirmer l activation
                </button>
              </div>
            )}

            {backupCodes.length > 0 && (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-800">Codes de secours à conserver maintenant</p>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {backupCodes.map((code) => <code key={code} className="bg-white rounded p-2 text-center text-xs">{code}</code>)}
                </div>
                <button
                  className="btn-outline mt-3"
                  onClick={() => navigator.clipboard.writeText(backupCodes.join('\n'))}
                >
                  <Copy size={15} /> Copier
                </button>
              </div>
            )}

            {user.two_factor_enabled && (
              <div className="mt-5 border-t border-gray-100 pt-5 grid sm:grid-cols-2 gap-3">
                <input
                  type="password"
                  className="input"
                  placeholder="Mot de passe"
                  value={disableForm.password}
                  onChange={(event) => setDisableForm((current) => ({ ...current, password: event.target.value }))}
                />
                <input
                  className="input"
                  placeholder="Code 2FA"
                  value={disableForm.code}
                  onChange={(event) => setDisableForm((current) => ({ ...current, code: event.target.value }))}
                />
                <button onClick={disableTwoFactor} disabled={saving} className="btn-outline text-red-600 border-red-200 sm:col-span-2 justify-center">
                  Désactiver la double authentification
                </button>
              </div>
            )}
          </section>

          <section className="card p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display font-bold">Sessions et appareils</h2>
                <p className="text-sm text-gray-400 mt-1">Révoquez immédiatement tout appareil inconnu.</p>
              </div>
              <button
                className="btn-outline"
                onClick={async () => {
                  await authApi.revokeOtherSessions()
                  await loadSessions()
                  toast.success('Autres sessions révoquées')
                }}
              >
                Tout révoquer sauf ici
              </button>
            </div>
            <div className="space-y-3 mt-5">
              {sessions.map((session) => (
                <div key={session.uuid} className={`rounded-xl border p-4 flex items-center gap-3 ${session.is_unusual ? 'border-red-200 bg-red-50' : 'border-gray-100'}`}>
                  <Smartphone size={20} className={session.is_unusual ? 'text-red-500' : 'text-[#1A8A3C]'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {session.device_name || session.platform}
                      {session.is_current && <span className="text-[#1A8A3C]"> · Session actuelle</span>}
                    </p>
                    <p className="text-xs text-gray-400">
                      Dernière activité : {new Date(session.last_seen_at).toLocaleString()}
                      {session.revoked_at ? ' · Révoquée' : ''}
                    </p>
                  </div>
                  {!session.revoked_at && (
                    <button onClick={() => revokeSession(session)} className="p-2 rounded-lg text-red-500 hover:bg-red-100">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
