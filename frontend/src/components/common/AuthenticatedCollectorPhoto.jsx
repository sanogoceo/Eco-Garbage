import { useEffect, useState } from 'react'
import { User } from 'lucide-react'
import { requestApi } from '../../services/api'

export default function AuthenticatedCollectorPhoto({
  requestUuid,
  collectorName,
  className = '',
}) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    let objectUrl
    let active = true
    requestApi.collectorPhoto(requestUuid)
      .then((response) => {
        if (!active) return
        objectUrl = URL.createObjectURL(response.data)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (active) setUrl('')
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [requestUuid])

  if (!url) {
    return (
      <div className={`flex items-center justify-center bg-[#E8F5EE] ${className}`}>
        <User size={32} className="text-[#1A8A3C]" />
      </div>
    )
  }

  return (
    <img
      src={url}
      alt={`Photo de ${collectorName}`}
      className={`object-cover ${className}`}
    />
  )
}
