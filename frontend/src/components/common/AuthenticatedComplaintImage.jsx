import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { complaintApi } from '../../services/api'

export default function AuthenticatedComplaintImage({
  complaintUuid,
  evidence,
  className = '',
}) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    let objectUrl
    let active = true
    complaintApi.evidence(complaintUuid, evidence.id)
      .then((response) => {
        if (!active) return
        objectUrl = URL.createObjectURL(response.data)
        setUrl(objectUrl)
      })
      .catch(() => {})
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [complaintUuid, evidence.id])

  if (!url) {
    return (
      <div className={`bg-gray-100 flex items-center justify-center ${className}`}>
        <ImageOff size={22} className="text-gray-300" />
      </div>
    )
  }

  return (
    <a href={url} target="_blank" rel="noreferrer" title={evidence.original_name}>
      <img
        src={url}
        alt={evidence.original_name || 'Preuve du litige'}
        className={`object-cover ${className}`}
      />
    </a>
  )
}
