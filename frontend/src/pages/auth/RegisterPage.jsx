import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle, Eye, EyeOff, Leaf, MailCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { authApi } from '../../services/api'
import { Spinner } from '../../components/common'
import { formatCmPhone, isValidCmPhone, normalizeCmPhone } from '../../utils/phone'

export default function RegisterPage() {
  const { t, i18n } = useTranslation()
  const isEn = i18n.language?.startsWith('en')
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
  })
  const [phoneError, setPhoneError] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [autoVerified, setAutoVerified] = useState(false)

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!form.name || !form.email || !form.password) {
      return toast.error(isEn ? 'Required fields missing' : 'Champs obligatoires manquants')
    }
    if (form.phone && !isValidCmPhone(form.phone)) {
      return toast.error(isEn ? 'Invalid Cameroonian phone number' : 'Numero de telephone camerounais invalide')
    }
    if (form.password.length < 8) {
      return toast.error(isEn ? 'Password too short (min. 8 characters)' : 'Mot de passe trop court (8 caracteres minimum)')
    }
    if (form.password !== form.confirm) {
      return toast.error(isEn ? "Passwords don't match" : 'Les mots de passe ne correspondent pas')
    }

    setLoading(true)
    try {
      const response = await authApi.register({
        name: form.name,
        email: form.email,
        phone: normalizeCmPhone(form.phone),
        password: form.password,
      })
      if (response.data?.autoVerified) {
        setAutoVerified(true)
        toast.success(t('auth.register.success'))
        setTimeout(() => navigate('/login'), 2000)
      }
      setRegistered(true)
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.serverError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="hidden md:flex flex-col items-center justify-center bg-[#1A8A3C] relative overflow-hidden p-12">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.3) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="relative z-10 text-center max-w-sm">
          <Leaf size={72} className="text-white mx-auto mb-8" />
          <h2 className="text-3xl font-display font-bold text-white mb-4">
            {isEn ? 'One account, every EcoGarbage service' : 'Un compte pour tous les services EcoGarbage'}
          </h2>
          <p className="text-white/70 leading-relaxed">
            {isEn
              ? 'Create your account now. You can apply to become a collector from your dashboard later.'
              : 'Creez votre compte maintenant. Vous pourrez ensuite demander a devenir collecteur depuis votre espace.'}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 bg-[#f7faf8] overflow-y-auto">
        <div className="w-full max-w-[440px] py-8">
          <Link to="/" className="flex md:hidden items-center gap-2 font-display font-bold text-xl mb-8">
            <div className="w-9 h-9 bg-[#1A8A3C] rounded-xl flex items-center justify-center">
              <Leaf size={18} className="text-white" />
            </div>
            Eco<span className="text-[#1A8A3C]">Garbage</span>
          </Link>

          {registered ? (
            <div className="bg-white rounded-3xl shadow-green-lg p-8 text-center">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 bg-[#E8F5EE] rounded-full flex items-center justify-center">
                  {autoVerified
                    ? <CheckCircle size={32} className="text-[#1A8A3C]" />
                    : <MailCheck size={32} className="text-[#1A8A3C]" />}
                </div>
              </div>
              <h2 className="text-2xl font-display font-bold mb-2">
                {autoVerified
                  ? (isEn ? 'Account created!' : 'Compte cree avec succes !')
                  : (isEn ? 'Check your email' : 'Verifiez votre email')}
              </h2>
              <p className="text-gray-500 text-sm leading-relaxed mb-6">
                {autoVerified
                  ? (isEn ? 'Your account is active. Redirecting to sign in.' : 'Votre compte est actif. Redirection vers la connexion.')
                  : (isEn ? `A verification link was sent to ${form.email}.` : `Un lien de verification a ete envoye a ${form.email}.`)}
              </p>
              <Link to="/login" className="btn-primary w-full justify-center py-3">
                {t('auth.login.submit')}
              </Link>
            </div>
          ) : (
            <div className="bg-white rounded-3xl shadow-green-lg p-8">
              <h1 className="text-2xl font-display font-bold mb-1">{t('auth.register.title')}</h1>
              <p className="text-sm text-gray-400 mb-6">
                {t('auth.register.hasAccount')}{' '}
                <Link to="/login" className="text-[#1A8A3C] font-semibold hover:underline">
                  {t('auth.register.login')}
                </Link>
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">{t('user.profile.name')} *</label>
                  <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
                </div>
                <div>
                  <label className="label">{t('auth.login.email')} *</label>
                  <input type="email" className="input" value={form.email} onChange={(e) => set('email', e.target.value)} />
                </div>
                <div>
                  <label className="label">{t('user.profile.phone')}</label>
                  <input
                    type="tel"
                    className={`input ${phoneError ? 'border-red-400' : ''}`}
                    placeholder="+237 6 XX XX XX XX"
                    value={form.phone}
                    onChange={(e) => {
                      const value = formatCmPhone(e.target.value)
                      set('phone', value)
                      setPhoneError(value.replace(/\s/g, '').length > 4 && !isValidCmPhone(value)
                        ? (isEn ? 'Invalid phone number' : 'Numero invalide')
                        : '')
                    }}
                  />
                  {phoneError && <p className="text-xs text-red-500 mt-1">{phoneError}</p>}
                </div>
                <div>
                  <label className="label">{t('auth.login.password')} *</label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      className="input pr-10"
                      placeholder={isEn ? '8+ characters, uppercase and number' : '8+ caracteres, majuscule et chiffre'}
                      value={form.password}
                      onChange={(e) => set('password', e.target.value)}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                      onClick={() => setShowPw((value) => !value)}
                    >
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label">{t('user.profile.confirmPassword')} *</label>
                  <input
                    type="password"
                    className="input"
                    value={form.confirm}
                    onChange={(e) => set('confirm', e.target.value)}
                  />
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3.5">
                  {loading && <Spinner size="sm" />}
                  {loading ? t('auth.register.submitting') : t('auth.register.submit')}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
