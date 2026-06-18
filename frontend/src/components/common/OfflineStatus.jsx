import { useEffect, useState } from 'react'
import { CloudOff, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { subscribeOfflineQueue, syncOfflineActions } from '../../services/offlineQueue'

export default function OfflineStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const synchronize = async ({ notify = false } = {}) => {
    if (!navigator.onLine) return
    setSyncing(true)
    try {
      const result = await syncOfflineActions()
      setPending(result.remaining)
      if (notify && result.synced > 0) {
        toast.success(`${result.synced} action(s) synchronisée(s)`)
      }
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => subscribeOfflineQueue(setPending), [])

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true)
      synchronize({ notify: true })
    }
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    synchronize()
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (online && pending === 0) return null

  return (
    <button
      type="button"
      onClick={() => synchronize({ notify: true })}
      disabled={!online || syncing}
      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${
        online ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
      }`}
      title={online ? 'Synchroniser maintenant' : 'Envoi automatique au retour du réseau'}
    >
      {online
        ? <RefreshCw size={15} className={syncing ? 'spinner' : ''} />
        : <CloudOff size={15} />}
      <span className="hidden sm:inline">
        {online ? `${pending} en attente` : `Hors connexion${pending ? ` · ${pending} en attente` : ''}`}
      </span>
    </button>
  )
}
