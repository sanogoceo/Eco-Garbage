import toast from 'react-hot-toast'
import { deviceApi } from './api'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const safeLocalStorageSet = (key, value) => {
  try {
    localStorage.setItem(key, value)
  } catch (error) {
    console.warn('Failed to save push token to localStorage', error)
  }
}

const isConfigured = () => Boolean(
  firebaseConfig.apiKey
  && firebaseConfig.projectId
  && firebaseConfig.messagingSenderId
  && import.meta.env.VITE_FIREBASE_VAPID_KEY
)

export const initializePushNotifications = async ({ requestPermission = false } = {}) => {
  if (!isConfigured() || !('Notification' in window)) return null
  const [{ getApp, getApps, initializeApp }, messagingModule] = await Promise.all([
    import('firebase/app'),
    import('firebase/messaging'),
  ])
  const { getMessaging, getToken, isSupported, onMessage } = messagingModule
  if (!await isSupported()) return null
  if (Notification.permission === 'denied') return null
  if (Notification.permission === 'default' && !requestPermission) return null

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission()
  if (permission !== 'granted') return null

  const workerParams = new URLSearchParams({
    apiKey: firebaseConfig.apiKey,
    authDomain: firebaseConfig.authDomain || '',
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket || '',
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId,
  })
  const registration = await navigator.serviceWorker.register(
    `/firebase-messaging-sw.js?${workerParams}`
  )
  await navigator.serviceWorker.ready

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
  const messaging = getMessaging(app)
  const token = await getToken(messaging, {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  })
  if (!token) return null

  await deviceApi.register({
    token,
    platform: /Android/i.test(navigator.userAgent) ? 'android' : 'web',
    device_name: navigator.userAgent.slice(0, 100),
  })
  safeLocalStorageSet('eco_push_token', token)
  onMessage(messaging, (payload) => {
    toast(payload.notification?.body || payload.notification?.title || 'Nouvelle notification')
  })
  return token
}
