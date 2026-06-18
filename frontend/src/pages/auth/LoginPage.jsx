import { useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { Copy, Eye, EyeOff, Leaf, LogIn, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { authApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { Spinner } from '../../components/common'

export default function LoginPage() {
  const { t } = useTranslation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [unverified, setUnverified] = useState(false)
  const [resending, setResending] = useState(false)
  const [security, setSecurity] = useState(null)
  const [securityCode, setSecurityCode] = useState('')
  const [backupCodes, setBackupCodes] = useState([])
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.email || !form.password) return toast.error(t('auth.login.fillFields'))
    setUnverified(false)
    setLoading(true)
    try {
      const { data } = await authApi.login(form)
      if (data.code === 'ADMIN_2FA_REQUIRED') {
        setSecurity({
          mode: 'verify',
          challengeToken: data.data.challenge_token,
        })
        return
      }
      if (data.code === 'ADMIN_2FA_SETUP_REQUIRED') {
        const setup = await authApi.startAdminTwoFactorSetup(data.data.challenge_token)
        setSecurity({
          mode: 'setup',
          challengeToken: data.data.challenge_token,
          secret: setup.data.data.secret,
          provisioningUri: setup.data.data.provisioning_uri,
        })
        return
      }
      completeLogin(data.data)
    } catch (err) {
      if (err.response?.data?.code === 'EMAIL_NOT_VERIFIED') {
        setUnverified(true)
      } else if (!err.response) {
        toast.error('Serveur inaccessible. Vérifiez votre connexion puis réessayez.')
      } else {
        toast.error(err.response?.data?.message || t('common.serverError'))
      }
    } finally {
      setLoading(false)
    }
  }

  const completeLogin = (sessionData) => {
    flushSync(() => { login(sessionData.token, sessionData.user) })
    toast.success(t('auth.login.success'))
    const role = sessionData.user.role
    navigate(role === 'admin' ? '/admin' : role === 'collector' ? '/collector' : '/dashboard', { replace: true })
  }

  const submitSecurityCode = async (event) => {
    event.preventDefault()
    const validCode = security?.mode === 'verify'
      ? (/^\d{6}$/.test(securityCode) || /^[A-F0-9]{10}$/i.test(securityCode))
      : /^\d{6}$/.test(securityCode)
    if (!validCode) {
      return toast.error('Entrez un code d authentification valide')
    }
    setLoading(true)
    try {
      const response = security.mode === 'setup'
        ? await authApi.confirmAdminTwoFactorSetup({
            challenge_token: security.challengeToken,
            code: securityCode,
          })
        : await authApi.verifyAdminTwoFactor({
            challenge_token: security.challengeToken,
            code: securityCode,
          })
      if (response.data.data.backup_codes?.length) {
        setBackupCodes(response.data.data.backup_codes)
        setSecurity({ mode: 'backup', sessionData: response.data.data })
      } else {
        completeLogin(response.data.data)
      }
    } catch (error) {
      toast.error(error.response?.data?.message || t('common.serverError'))
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResending(true)
    try {
      await authApi.resendVerification(form.email)
      toast.success(t('auth.login.resendSuccess'))
      setUnverified(false)
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.serverError'))
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="min-h-screen grid md:grid-cols-2">

      <div className="hidden md:flex flex-col items-center justify-center bg-[#1A8A3C] relative overflow-hidden p-12">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.3) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <div className="relative z-10 text-center max-w-sm">
          <div className="text-7xl mb-8">♻️</div>
          <Link to="/" className="flex items-center justify-center gap-2.5 font-display font-bold text-2xl text-white mb-6">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Leaf size={20} className="text-white" />
            </div>
            EcoGarbage
          </Link>
          <h2 className="text-3xl font-display font-bold text-white mb-4">{t('auth.login.welcomeBack')}</h2>
          <p className="text-white/70 leading-relaxed">{t('auth.login.welcomeDesc')}</p>
          <div className="mt-8 flex flex-col gap-3">
            {t('auth.login.features', { returnObjects: true }).map(f => (
              <div key={f} className="flex items-center gap-3 bg-white/10 px-4 py-3 rounded-xl text-sm text-white">
                <span className="text-green-300">✓</span>{f}
              </div>
            ))}
          </div>
        </div>
      </div>


      <div className="flex items-center justify-center p-6 bg-[#f7faf8] min-h-screen">
        <div className="w-full max-w-[420px]">

          <Link to="/" className="flex md:hidden items-center gap-2 font-display font-bold text-xl mb-8">
            <div className="w-9 h-9 bg-[#1A8A3C] rounded-xl flex items-center justify-center">
              <Leaf size={18} className="text-white" />
            </div>
            Eco<span className="text-[#1A8A3C]">Garbage</span>
          </Link>

          <div className="bg-white rounded-3xl shadow-green-lg p-8">
            <h1 className="text-2xl font-display font-bold mb-1">
              {security ? 'Sécurité administrateur' : t('auth.login.title')}
            </h1>
            <p className="text-sm text-gray-400 mb-8">
              {security
                ? 'La double authentification protège les opérations sensibles.'
                : (
                  <>
                    {t('auth.login.noAccount')}{' '}
                    <Link to="/register" className="text-[#1A8A3C] font-semibold hover:underline">{t('auth.login.register')}</Link>
                  </>
                )}
            </p>


            {unverified && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm">
                <p className="font-semibold text-amber-800 mb-1">{t('auth.login.unverifiedTitle')}</p>
                <p className="text-amber-700 mb-3">{t('auth.login.unverifiedDesc')}</p>
                <button type="button" onClick={handleResend} disabled={resending}
                  className="text-[#1A8A3C] font-semibold text-xs hover:underline disabled:opacity-50">
                  {resending ? t('auth.login.resending') : t('auth.login.resend')}
                </button>
              </div>
            )}

            {!security && <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="label">{t('auth.login.email')}</label>
                <input type="email" className="input" placeholder={t('auth.login.emailPlaceholder')}
                  value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div>
                <label className="label flex justify-between">
                  {t('auth.login.password')}
                  <Link to="/forgot-password" className="text-[#1A8A3C] cursor-pointer text-xs font-normal hover:underline">
                    {t('auth.login.forgotPassword')}
                  </Link>
                </label>
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} className="input pr-10" placeholder="••••••••"
                    value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                    onClick={() => setShowPw(!showPw)}>
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3.5">
                {loading ? <Spinner size="sm" /> : <LogIn size={16} />}
                {loading ? t('auth.login.submitting') : t('auth.login.submit')}
              </button>
            </form>}

            {security?.mode === 'setup' && (
              <form onSubmit={submitSecurityCode} className="space-y-5">
                <div className="rounded-xl border border-[#b9e4c8] bg-[#E8F5EE] p-4 text-sm">
                  <p className="font-semibold text-[#146c31] flex items-center gap-2">
                    <ShieldCheck size={18} /> Activez votre application Authenticator
                  </p>
                  <p className="text-gray-600 mt-2">
                    Ajoutez manuellement cette clé dans Google Authenticator ou Microsoft Authenticator.
                  </p>
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-white p-3 font-mono text-xs break-all">
                    <span className="flex-1">{security.secret}</span>
                    <button type="button" onClick={() => navigator.clipboard.writeText(security.secret)}>
                      <Copy size={15} />
                    </button>
                  </div>
                  <a
                    href={security.provisioningUri}
                    className="inline-flex mt-3 text-[#1A8A3C] font-semibold hover:underline"
                  >
                    Ouvrir dans l application Authenticator
                  </a>
                </div>
                <div>
                  <label className="label">Code à 6 chiffres</label>
                  <input
                    inputMode="numeric"
                    className="input text-center tracking-[0.4em] font-mono"
                    value={securityCode}
                    onChange={(event) => setSecurityCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    autoFocus
                  />
                </div>
                <button disabled={loading} className="btn-primary w-full justify-center">
                  {loading ? <Spinner size="sm" /> : <ShieldCheck size={16} />}
                  Activer et continuer
                </button>
              </form>
            )}

            {security?.mode === 'verify' && (
              <form onSubmit={submitSecurityCode} className="space-y-5">
                <div>
                  <label className="label">Code Authenticator ou code de secours</label>
                  <input
                    className="input text-center tracking-[0.35em] font-mono"
                    value={securityCode}
                    onChange={(event) => setSecurityCode(event.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10))}
                    placeholder="000000"
                    autoFocus
                  />
                </div>
                <button disabled={loading} className="btn-primary w-full justify-center">
                  {loading ? <Spinner size="sm" /> : <ShieldCheck size={16} />}
                  Vérifier
                </button>
              </form>
            )}

            {security?.mode === 'backup' && (
              <div className="space-y-5">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  Enregistrez ces codes de secours dans un endroit sûr. Chacun ne peut être utilisé qu’une fois.
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {backupCodes.map((code) => (
                    <code key={code} className="rounded-lg bg-gray-100 p-2 text-center text-xs">{code}</code>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn-outline w-full justify-center"
                  onClick={() => navigator.clipboard.writeText(backupCodes.join('\n'))}
                >
                  <Copy size={16} /> Copier les codes
                </button>
                <button
                  type="button"
                  className="btn-primary w-full justify-center"
                  onClick={() => completeLogin(security.sessionData)}
                >
                  Continuer vers l administration
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
