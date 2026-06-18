import { useState } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { authApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { Modal, Spinner } from './index'

export default function AdminStepUpModal({
  isOpen,
  onClose,
  scope,
  title,
  description,
  onVerified,
}) {
  const { i18n } = useTranslation()
  const { user } = useAuth()
  const isEn = i18n.language?.startsWith('en')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)

  const close = () => {
    setPassword('')
    setCode('')
    onClose()
  }

  const confirm = async () => {
    if (!password || (user?.two_factor_enabled && !code)) {
      return toast.error(isEn
        ? 'Password and authentication code are required'
        : 'Le mot de passe et le code d authentification sont requis')
    }
    setLoading(true)
    try {
      const response = await authApi.adminStepUp({ scope, password, code })
      await onVerified(response.data.data.token)
      close()
    } catch (error) {
      toast.error(error.response?.data?.message || (isEn
        ? 'Security confirmation failed'
        : 'La confirmation de sécurité a échoué'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={title || (isEn ? 'Security confirmation' : 'Confirmation de sécurité')}
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 flex gap-3">
          <ShieldCheck size={20} className="flex-shrink-0" />
          <p>{description || (isEn
            ? 'Confirm your identity before this sensitive administrator action.'
            : 'Confirmez votre identité avant cette action administrateur sensible.')}</p>
        </div>
        <div>
          <label className="label">{isEn ? 'Administrator password' : 'Mot de passe administrateur'}</label>
          <input
            type="password"
            className="input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </div>
        {user?.two_factor_enabled && (
          <div>
            <label className="label">{isEn ? 'Authenticator code' : 'Code de l application Authenticator'}</label>
            <input
              inputMode="numeric"
              className="input tracking-[0.35em] text-center font-mono"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
            />
          </div>
        )}
        <button onClick={confirm} disabled={loading} className="btn-primary w-full justify-center">
          {loading ? <Spinner size="sm" /> : <KeyRound size={16} />}
          {isEn ? 'Confirm action' : 'Confirmer l action'}
        </button>
      </div>
    </Modal>
  )
}
