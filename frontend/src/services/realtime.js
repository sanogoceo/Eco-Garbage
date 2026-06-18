import { io } from 'socket.io-client'

const apiUrl = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '')
const socketUrl = apiUrl.startsWith('http') ? apiUrl.replace(/\/api$/, '') : window.location.origin

const safeLocalStorageGet = (key, fallback = null) => {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch (error) {
    console.warn('Failed to read from localStorage', key, error)
    return fallback
  }
}

export const subscribeToRequest = (requestUuid, handlers = {}) => {
  const token = safeLocalStorageGet('eco_token')
  if (!token) return () => {}

  const socket = io(socketUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
  })
  socket.on('connect', () => socket.emit('join_request', requestUuid))
  Object.entries(handlers).forEach(([event, handler]) => socket.on(event, handler))

  return () => socket.disconnect()
}
