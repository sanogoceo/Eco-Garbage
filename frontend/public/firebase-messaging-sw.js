const params = new URL(self.location.href).searchParams
const CACHE_NAME = 'eco-garbage-shell-v1'
const APP_SHELL = ['/', '/index.html']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith('eco-garbage-shell-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    ))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || request.url.includes('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy))
          return response
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  const url = new URL(request.url)
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => caches.match(request))
    )
  }
})

if (params.get('projectId') && params.get('messagingSenderId')) {
  importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js')
  importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js')

  firebase.initializeApp({
    apiKey: params.get('apiKey'),
    authDomain: params.get('authDomain'),
    projectId: params.get('projectId'),
    storageBucket: params.get('storageBucket'),
    messagingSenderId: params.get('messagingSenderId'),
    appId: params.get('appId'),
  })

  const messaging = firebase.messaging()
  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || 'EcoGarbage'
    self.registration.showNotification(title, {
      body: payload.notification?.body || '',
      icon: '/favicon.ico',
      data: payload.data,
    })
  })
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const requestUuid = event.notification.data?.request_uuid
  const target = event.notification.data?.target_path
    || (requestUuid ? `/dashboard/requests/${requestUuid}` : '/dashboard/notifications')
  event.waitUntil(clients.openWindow(target))
})
