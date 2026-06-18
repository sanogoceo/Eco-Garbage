import api from './api'

const DB_NAME = 'eco-garbage-offline'
const STORE_NAME = 'actions'
const DB_VERSION = 1
const CHANGE_EVENT = 'eco:offline-queue-change'

const openDatabase = () => new Promise((resolve, reject) => {
  if (!('indexedDB' in window)) {
    reject(new Error('IndexedDB indisponible'))
    return
  }
  const request = indexedDB.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      store.createIndex('created_at', 'created_at')
    }
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

const withStore = async (mode, callback) => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)
    const request = callback(store)
    transaction.oncomplete = () => {
      db.close()
      resolve(request?.result)
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
  })
}

const notifyChange = () => window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
const safeLocalStorageGet = (key, fallback = null) => {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch (error) {
    console.warn('Failed to read from localStorage', key, error)
    return fallback
  }
}

const getCurrentUserId = () => {
  try {
    const user = JSON.parse(safeLocalStorageGet('eco_user', '{}'))
    return user?.uuid || user?.id || null
  } catch (error) {
    console.warn('Failed to parse current user from localStorage', error)
    return null
  }
}

export const createOperationId = () => (
  globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(16).slice(2)}`
)

export const isNetworkError = (error) => (
  !navigator.onLine
  || error?.code === 'ERR_NETWORK'
  || (!error?.response && Boolean(error?.request))
)

export const enqueueOfflineAction = async (type, payload) => {
  const id = payload.client_operation_id || createOperationId()
  if (type === 'request.location') {
    const existing = await getOfflineActions()
    const obsolete = existing.filter((action) => (
      action.type === type && action.payload.uuid === payload.uuid
    ))
    await Promise.all(obsolete.map((action) => removeAction(action.id)))
  }
  const action = {
    id,
    user_id: getCurrentUserId(),
    type,
    payload: { ...payload, client_operation_id: id },
    created_at: new Date().toISOString(),
    attempts: 0,
  }
  await withStore('readwrite', (store) => store.put(action))
  notifyChange()
  return action
}

export const getOfflineActions = async () => {
  const rows = await withStore('readonly', (store) => store.getAll())
  const currentUserId = getCurrentUserId()
  return (rows || [])
    .filter((action) => action.user_id && action.user_id === currentUserId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export const getOfflineActionCount = async () => (await getOfflineActions()).length

const removeAction = async (id) => {
  await withStore('readwrite', (store) => store.delete(id))
  notifyChange()
}

const updateAttempt = async (action, error) => {
  await withStore('readwrite', (store) => store.put({
    ...action,
    attempts: action.attempts + 1,
    last_error: error?.response?.data?.message || error?.message || 'Erreur de synchronisation',
  }))
  notifyChange()
}

const sendAction = (action) => {
  switch (action.type) {
    case 'request.create':
      return api.post('/requests', action.payload)
    case 'request.status': {
      const { uuid, ...body } = action.payload
      return api.put(`/requests/${uuid}/status`, body)
    }
    case 'request.location': {
      const { uuid, ...body } = action.payload
      return api.put(`/requests/${uuid}/location`, body)
    }
    case 'request.proof': {
      const { uuid, photo, ...fields } = action.payload
      const formData = new FormData()
      formData.append('photo', photo, fields.file_name || 'preuve.jpg')
      Object.entries(fields).forEach(([key, value]) => {
        if (key !== 'file_name' && value !== undefined && value !== null) {
          formData.append(key, value)
        }
      })
      return api.post(`/requests/${uuid}/proofs`, formData, { timeout: 60000 })
    }
    default:
      throw new Error(`Action hors connexion inconnue: ${action.type}`)
  }
}

let syncing = false

export const syncOfflineActions = async () => {
  if (syncing || !navigator.onLine) {
    return { synced: 0, remaining: await getOfflineActionCount() }
  }
  syncing = true
  let synced = 0
  try {
    const actions = await getOfflineActions()
    for (const action of actions) {
      try {
        await sendAction(action)
        await removeAction(action.id)
        synced += 1
      } catch (error) {
        if (isNetworkError(error)) break
        await updateAttempt(action, error)
        break
      }
    }
    return { synced, remaining: await getOfflineActionCount() }
  } finally {
    syncing = false
  }
}

export const subscribeOfflineQueue = (callback) => {
  const refresh = () => getOfflineActionCount().then(callback).catch(() => callback(0))
  window.addEventListener(CHANGE_EVENT, refresh)
  window.addEventListener('online', refresh)
  window.addEventListener('offline', refresh)
  refresh()
  return () => {
    window.removeEventListener(CHANGE_EVENT, refresh)
    window.removeEventListener('online', refresh)
    window.removeEventListener('offline', refresh)
  }
}
