import { useEffect, useRef, useState } from 'react'
import { Loader2, MessageCircle, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../context/AuthContext'
import { chatApi } from '../../services/api'
import { subscribeToRequest } from '../../services/realtime'

export default function RequestChat({ requestUuid }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState([])
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  const load = async () => {
    try {
      const response = await chatApi.list(requestUuid)
      setMessages(response.data.data || [])
    } catch {
      // The conversation can be unavailable before assignment.
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 5000)
    const unsubscribe = subscribeToRequest(requestUuid, { message_created: load })
    return () => {
      clearInterval(timer)
      unsubscribe()
    }
  }, [requestUuid])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const send = async (event) => {
    event.preventDefault()
    const text = body.trim()
    if (!text) return
    setSending(true)
    try {
      await chatApi.send(requestUuid, text)
      setBody('')
      await load()
    } catch (error) {
      toast.error(error.response?.data?.message || 'Message non envoye')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="card p-5 mb-5">
      <h3 className="font-display font-bold mb-1 flex items-center gap-2">
        <MessageCircle size={18} className="text-[#1A8A3C]" />
        Chat securise
      </h3>
      <p className="text-xs text-gray-400 mb-4">Echangez sans afficher vos numeros personnels.</p>
      <div className="h-64 overflow-y-auto rounded-2xl bg-gray-50 p-3 flex flex-col gap-2">
        {messages.length === 0 && (
          <p className="text-sm text-gray-400 text-center my-auto">Aucun message pour le moment.</p>
        )}
        {messages.map((message) => {
          const mine = message.sender_id === user?.id || message.sender_id === user?._id
          return (
            <div key={message.uuid} className={`max-w-[85%] ${mine ? 'self-end' : 'self-start'}`}>
              <div className={`rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-[#1A8A3C] text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>
                {message.body}
              </div>
              <p className={`text-[10px] text-gray-400 mt-1 ${mine ? 'text-right' : ''}`}>
                {mine ? 'Vous' : message.sender_name}
              </p>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="flex gap-2 mt-3">
        <input
          className="input flex-1"
          maxLength={1000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Votre message..."
        />
        <button className="btn-primary px-4" disabled={sending || !body.trim()}>
          {sending ? <Loader2 size={17} className="spinner" /> : <Send size={17} />}
        </button>
      </form>
    </section>
  )
}
