import { useEffect, useState } from 'react'
import { Camera } from 'lucide-react'
import { requestApi } from '../../services/api'

export default function AuthenticatedProofImage({ requestUuid, proof, className = '' }) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    let objectUrl
    let active = true
    requestApi.proof(requestUuid, proof._id)
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
  }, [requestUuid, proof._id])

  if (!url) {
    return (
      <div className={`bg-gray-100 flex items-center justify-center ${className}`}>
        <Camera size={22} className="text-gray-300" />
      </div>
    )
  }
  return <img src={url} alt={proof.type === 'before' ? 'Avant collecte' : 'Apres collecte'} className={`object-cover ${className}`} />
}
