import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Phone, MapPin, CheckCircle, Navigation, Play, AlertCircle, Archive, Camera, KeyRound, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { requestApi } from '../../services/api'
import { StatusBadge, PageLoader, Modal } from '../../components/common'
import { format } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import LiveRouteMap from '../../components/common/LiveRouteMap'
import { watchPosition, getCurrentPosition, getGeolocationStatus } from '../../utils/geolocation'
import RequestChat from '../../components/common/RequestChat'
import { subscribeToRequest } from '../../services/realtime'
import {
  createOperationId,
  enqueueOfflineAction,
  isNetworkError,
} from '../../services/offlineQueue'
import { getServiceTypeLabel } from '../../utils/serviceTypes'

export default function TaskDetail() {
  const { t, i18n } = useTranslation()
  const dateLocale = i18n.language?.startsWith('en') ? enUS : fr
  const isEn = i18n.language?.startsWith('en')
  const { uuid } = useParams()
  const navigate = useNavigate()
  const [task, setTask] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [issueModal, setIssueModal] = useState(false)
  const [issueNote, setIssueNote] = useState('')
  const locationWatchIdRef = useRef(null)
  const latestPositionRef = useRef(null)
  const [locationError, setLocationError] = useState('')
  const [archiving, setArchiving] = useState(false)
  const [proofFile, setProofFile] = useState(null)
  const [proofUploading, setProofUploading] = useState(false)
  const [completionCode, setCompletionCode] = useState('')

  const STATUS_FLOW = {
    assigned:    { next: 'on_way',      label: isEn ? '🗺️ Start trip'        : '🗺️ Démarrer le trajet', icon: Navigation,   color: 'bg-blue-500' },
    on_way:      { next: 'in_progress', label: isEn ? '📍 Arrived on site'   : '📍 Arrivé sur place',  icon: MapPin,       color: 'bg-orange-500' },
    in_progress: { next: 'completed',   label: isEn ? '✅ Mark as completed' : '✅ Marquer comme complété', icon: CheckCircle, color: 'bg-[#1A8A3C]' },
  }

  const fetchTask = async () => {
    try {
      const { data } = await requestApi.get(uuid)
      setTask(data.data)
    } catch {
      toast.error(isEn ? 'Task not found' : 'Tâche introuvable')
      navigate('/collector/tasks')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { fetchTask() }, [uuid])

  useEffect(() => subscribeToRequest(uuid, {
    status_updated: () => fetchTask(),
    location_updated: (payload) => setTask((current) => current ? { ...current, ...payload } : current),
  }), [uuid])


  useEffect(() => {
    const geoStatus = getGeolocationStatus()
    if (!geoStatus.supported) {
      toast.error(geoStatus.reason)
    }
  }, [])


  useEffect(() => {
    if (task && ['assigned', 'on_way', 'in_progress'].includes(task.status)) {
      const interval = setInterval(fetchTask, 10000) // Update every 10 seconds
      return () => clearInterval(interval)
    }
  }, [task?.status])


  useEffect(() => {
    if (task && ['on_way', 'in_progress'].includes(task.status)) {
      startLocationTracking()
    } else {
      stopLocationTracking()
    }
    return () => stopLocationTracking()
  }, [task?.status])

  const handleRetryLocation = () => {
    setLocationError('')
    stopLocationTracking()
    startLocationTracking()
  }

  const handleStatusUpdate = async (newStatus) => {
    setUpdating(true)
    const payload = {
      status: newStatus,
      ...(newStatus === 'completed' ? { completion_code: completionCode } : {}),
      client_operation_id: createOperationId(),
    }
    try {
      await requestApi.updateStatus(uuid, payload)
      toast.success(`${isEn ? 'Status updated:' : 'Statut mis à jour :'} ${t(`status.${newStatus}`)}`)
      fetchTask()
    } catch (err) {
      if (isNetworkError(err)) {
        await enqueueOfflineAction('request.status', { uuid, ...payload })
        setTask((current) => current ? { ...current, status: newStatus } : current)
        toast.success(isEn
          ? 'Status saved offline and awaiting synchronization.'
          : 'Statut enregistré hors connexion, en attente de synchronisation.')
      } else {
        toast.error(err.response?.data?.message || t('common.serverError'))
      }
    } finally {
      setUpdating(false)
    }
  }

  const handleReportIssue = async () => {
    setUpdating(true)
    try {
      await requestApi.updateStatus(uuid, { status: 'failed', note: issueNote })
      toast.error(isEn ? 'Issue reported' : 'Problème signalé')
      setIssueModal(false)
      navigate('/collector/tasks')
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.serverError'))
    } finally {
      setUpdating(false)
    }
  }

  const startLocationTracking = () => {
    stopLocationTracking()
    const watchId = watchPosition(
      async (position) => {
        setLocationError('')
        latestPositionRef.current = {
          position,
          receivedAt: Date.now(),
        }
        try {
          await requestApi.updateLocation(uuid, {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy_meters: position.coords.accuracy || undefined,
          })
        } catch (err) {
          if (isNetworkError(err)) {
            await enqueueOfflineAction('request.location', {
              uuid,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              client_operation_id: createOperationId(),
            })
          } else {
            console.error('Failed to update location:', err)
          }
        }
      },
      (error) => {
        console.error('Geolocation error:', error)
        setLocationError(error.message)
        if (error.code !== 3) {
          toast.error(error.message)
        }
      }
    )
    locationWatchIdRef.current = watchId
  }

  const stopLocationTracking = () => {
    if (locationWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(locationWatchIdRef.current)
      locationWatchIdRef.current = null
    }
  }

  const handleArchive = async () => {
    setArchiving(true)
    try {
      await requestApi.archive(uuid)
      toast.success('Tâche archivée avec succès')
      navigate('/collector/archived')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'archivage')
    } finally {
      setArchiving(false)
    }
  }

  const handleProofUpload = async (type) => {
    if (!proofFile) return toast.error('Selectionnez une photo')
    setProofUploading(true)
    let offlinePayload = null
    try {
      const recentTrackedPosition = latestPositionRef.current
      let position = recentTrackedPosition
        && Date.now() - recentTrackedPosition.receivedAt <= 2 * 60 * 1000
        ? recentTrackedPosition.position
        : null

      if (
        !position
        && task.collector_location?.updated_at
        && Number.isFinite(Number(task.collector_location.latitude))
        && Number.isFinite(Number(task.collector_location.longitude))
      ) {
        const locationAge = Date.now() - new Date(task.collector_location.updated_at).getTime()
        if (locationAge <= 2 * 60 * 1000) {
          position = {
            coords: {
              latitude: task.collector_location.latitude,
              longitude: task.collector_location.longitude,
              accuracy: task.collector_location.accuracy_meters,
            },
          }
        }
      }

      if (!position) {
        try {
          position = await getCurrentPosition({
            enableHighAccuracy: false,
            timeout: 20000,
            maximumAge: 2 * 60 * 1000,
          })
        } catch (networkPositionError) {
          if (networkPositionError.code === 1) throw networkPositionError
          position = await getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 25000,
            maximumAge: 5 * 60 * 1000,
          }).catch(() => {
            throw networkPositionError
          })
        }
      }

      const operationId = createOperationId()
      offlinePayload = {
        uuid,
        photo: proofFile,
        file_name: proofFile.name,
        type,
        captured_at: new Date().toISOString(),
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy_meters: position.coords.accuracy || '',
        client_operation_id: operationId,
      }
      const formData = new FormData()
      formData.append('photo', proofFile)
      Object.entries(offlinePayload).forEach(([key, value]) => {
        if (!['uuid', 'photo', 'file_name'].includes(key)) formData.append(key, value)
      })
      await requestApi.uploadProof(uuid, formData)
      toast.success(type === 'before' ? 'Photo avant enregistree' : 'Photo apres enregistree')
      setProofFile(null)
      await fetchTask()
    } catch (error) {
      if (offlinePayload && isNetworkError(error)) {
        await enqueueOfflineAction('request.proof', offlinePayload)
        toast.success('Photo enregistrée hors connexion, en attente de synchronisation')
        setProofFile(null)
      } else {
        toast.error(error.response?.data?.message || error.message || 'Photo non envoyee')
      }
    } finally {
      setProofUploading(false)
    }
  }

  if (loading) return <PageLoader />
  if (!task) return null

  const nextAction = STATUS_FLOW[task.status]

  const details = [
    [isEn ? 'Waste type'      : 'Type de déchet',    task.category_name],
    [isEn ? 'Service type'    : 'Type de service',    getServiceTypeLabel(task.service_type, isEn)],
    [isEn ? 'Est. quantity'   : 'Quantité estimée',   task.quantity_estimate || '—'],
    [isEn ? 'Price'           : 'Prix',               task.estimated_price ? `${parseFloat(task.estimated_price).toLocaleString()} FCFA` : '—'],
    [isEn ? 'Created'         : 'Date de création',   format(new Date(task.created_at), 'dd MMM yyyy HH:mm', { locale: dateLocale })],
    [isEn ? 'Scheduled'       : 'Date planifiée',     task.scheduled_at ? format(new Date(task.scheduled_at), 'dd MMM yyyy HH:mm', { locale: dateLocale }) : '—'],
  ]

  return (
    <div className="fade-up max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
        <div>
          <h1 className="text-xl font-display font-bold">{isEn ? 'Task detail' : 'Détail de la tâche'}</h1>
          <p className="text-sm text-gray-400">#{task.uuid?.slice(0, 8).toUpperCase()}</p>
        </div>
        <div className="ml-auto"><StatusBadge status={task.status} /></div>
      </div>

      {task.collector_id && !['cancelled', 'failed'].includes(task.status) && (
        <RequestChat requestUuid={uuid} />
      )}

      <div className="card p-6 mb-5">
        <h3 className="font-display font-bold mb-4">{isEn ? 'Client information' : 'Informations client'}</h3>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 bg-[#E8F5EE] rounded-xl flex items-center justify-center text-[#1A8A3C] font-bold text-lg">
            {task.user_name?.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold">{task.user_name}</p>
            {task.user_phone && (
              <a href={`tel:${task.user_phone}`} className="flex items-center gap-1.5 text-sm text-[#1A8A3C] mt-0.5 hover:underline">
                <Phone size={13} />{task.user_phone}
              </a>
            )}
          </div>
        </div>

        <div className="bg-[#E8F5EE] rounded-xl p-3 flex items-start gap-2">
          <MapPin size={16} className="text-[#1A8A3C] mt-0.5 flex-shrink-0" />
          <p className="text-sm text-gray-700">{task.address}</p>
        </div>

        <a href={`https://maps.google.com/?q=${encodeURIComponent(task.address)}`} target="_blank" rel="noopener noreferrer"
          className="btn-outline w-full justify-center mt-3">
          <Navigation size={16} /> {isEn ? 'Open in Maps' : 'Ouvrir dans Maps'}
        </a>
      </div>


      <div className="card p-6 mb-5">
        <h3 className="font-display font-bold mb-4">{isEn ? 'Collection details' : 'Détails de la collecte'}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {details.map(([k, v]) => (
            <div key={k}>
              <p className="text-xs text-gray-400 mb-0.5">{k}</p>
              <p className="text-sm font-medium text-gray-800">{v}</p>
            </div>
          ))}
        </div>
        {task.notes && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400 mb-1">{isEn ? 'Client instructions' : 'Instructions du client'}</p>
            <p className="text-sm text-gray-600 bg-yellow-50 border border-yellow-200 rounded-xl p-3">{task.notes}</p>
          </div>
        )}
      </div>


      {['assigned', 'on_way', 'in_progress'].includes(task.status) && (
        <div className="card p-6 mb-5">
          <h3 className="font-display font-bold mb-5">Trajet en temps réel</h3>
          <LiveRouteMap
            userLocation={task.latitude && task.longitude ? { latitude: task.latitude, longitude: task.longitude } : null}
            collectorLocation={task.collector_location}
            userLabel="Adresse de collecte"
            collectorLabel="Ma position"
          />
          <p className="text-xs text-gray-500 mt-3">
            Votre position actuelle et l'adresse de collecte sont affichées. Partagez votre position pour guider le client.
          </p>
          {task.eta_minutes && (
            <div className="mt-3 rounded-xl bg-[#E8F5EE] p-3 text-sm text-[#1A8A3C] font-semibold">
              Arrivee estimee dans {task.eta_minutes} min · {task.remaining_distance_km} km restants
            </div>
          )}
          {locationError && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <p className="font-semibold">Erreur de partage de position :</p>
              <p>{locationError}</p>
              <button onClick={handleRetryLocation} className="mt-3 btn-outline">
                Réessayer la localisation
              </button>
            </div>
          )}
        </div>
      )}

      {['on_way', 'in_progress'].includes(task.status) && (
        <div className="card p-5 mb-5">
          <h3 className="font-display font-bold flex items-center gap-2 mb-2">
            <Camera size={18} className="text-[#1A8A3C]" />
            Preuve photo horodatee et geolocalisee
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            {task.status === 'on_way'
              ? 'Prenez une photo des dechets avant de commencer.'
              : 'Prenez une photo du lieu propre apres la collecte.'}
          </p>
          <input
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            className="input mb-3"
            onChange={(event) => setProofFile(event.target.files?.[0] || null)}
          />
          <button
            onClick={() => handleProofUpload(task.status === 'on_way' ? 'before' : 'after')}
            disabled={!proofFile || proofUploading}
            className="btn-primary w-full justify-center">
            {proofUploading ? <Loader2 size={17} className="spinner" /> : <Camera size={17} />}
            Envoyer la photo
          </button>
          <div className="flex gap-2 mt-3 text-xs">
            {task.proofs?.map((proof) => (
              <span key={proof._id} className="rounded-full bg-green-50 text-green-700 px-3 py-1">
                {proof.type === 'before' ? 'Avant validee' : 'Apres validee'}
              </span>
            ))}
          </div>
        </div>
      )}

      {task.status === 'in_progress' && (
        <div className="card p-5 mb-5 border-2 border-[#C8EDDA]">
          <label className="label flex items-center gap-2">
            <KeyRound size={16} /> Code OTP donne par le client
          </label>
          <input
            className="input text-center text-2xl tracking-[0.4em] font-bold"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={completionCode}
            onChange={(event) => setCompletionCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <p className="text-xs text-gray-400 mt-2">Le client communique ce code apres verification de la collecte.</p>
        </div>
      )}

      {nextAction && (
        <div className="flex flex-col gap-3 mb-4">
          <button
            onClick={() => handleStatusUpdate(nextAction.next)}
            disabled={updating || (nextAction.next === 'completed' && completionCode.length !== 6)}
            className={`w-full flex items-center justify-center gap-2 py-4 rounded-xl text-white font-bold text-base transition-all ${nextAction.color} hover:opacity-90 disabled:opacity-60`}>
            <nextAction.icon size={20} />
            {updating ? (isEn ? 'Updating...' : 'Mise à jour...') : nextAction.label}
          </button>
        </div>
      )}

      {['assigned', 'on_way', 'in_progress'].includes(task.status) && (
        <button onClick={() => setIssueModal(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-red-500 font-semibold text-sm border-2 border-red-200 hover:bg-red-50 transition-all">
          <AlertCircle size={16} /> {isEn ? 'Report an issue' : 'Signaler un problème'}
        </button>
      )}

      {task.status === 'completed' && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center mb-4">
          <p className="text-lg">🎉</p>
          <p className="font-semibold text-green-700 mt-1">{isEn ? 'Collection completed successfully!' : 'Collecte complétée avec succès !'}</p>
          {task.collected_at && (
            <p className="text-sm text-green-600 mt-0.5">{format(new Date(task.collected_at), 'dd MMM yyyy HH:mm', { locale: dateLocale })}</p>
          )}
        </div>
      )}


      {['completed', 'cancelled', 'failed'].includes(task.status) && (
        <button onClick={handleArchive} disabled={archiving} className="btn-primary w-full justify-center mb-4">
          <Archive size={16} />
          {archiving ? 'Archivage...' : 'Archiver cette tâche'}
        </button>
      )}

      <Modal isOpen={issueModal} onClose={() => setIssueModal(false)} title={isEn ? 'Report an issue' : 'Signaler un problème'} size="sm">
          <p className="text-sm text-gray-500">
            {isEn ? 'Describe the issue. The collection will be marked as failed.' : 'Décrivez le problème rencontré. La collecte sera marquée comme échouée.'}
          </p>
          <textarea className="input resize-none min-h-[100px]"
            placeholder={isEn ? 'Client absent, incorrect address, undeclared hazardous waste...' : 'Client absent, adresse incorrecte, déchets dangereux non déclarés...'}
            value={issueNote} onChange={e => setIssueNote(e.target.value)} />
          <div className="flex gap-3">
            <button onClick={() => setIssueModal(false)} className="btn-ghost flex-1 justify-center border border-gray-200">{t('common.cancel')}</button>
            <button onClick={handleReportIssue} disabled={updating}
              className="flex-1 justify-center inline-flex items-center gap-2 bg-red-500 text-white px-6 py-3 rounded-xl font-semibold text-sm hover:bg-red-600">
              {isEn ? 'Report' : 'Signaler'}
            </button>
          </div>
      </Modal>
    </div>
  )
}
