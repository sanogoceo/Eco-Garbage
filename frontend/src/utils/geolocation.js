
export const isGeolocationSupported = () => {
  return 'geolocation' in navigator
}

export const isSecureContext = () => {
  return window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
}

export const getGeolocationStatus = () => {
  if (!isGeolocationSupported()) {
    return { supported: false, reason: 'Géolocalisation non supportée par ce navigateur.' }
  }

  if (!isSecureContext()) {
    return { supported: false, reason: 'La géolocalisation nécessite une connexion sécurisée (HTTPS).' }
  }

  return { supported: true }
}
export const getCurrentPosition = (options = {}) => {
  return new Promise((resolve, reject) => {
    const status = getGeolocationStatus()
    if (!status.supported) {
      reject(new Error(status.reason))
      return
    }

    const defaultOptions = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      (error) => {
        let errorMessage = 'Erreur de géolocalisation: '

        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage += 'Permission refusée. Autorisez l\'accès à la localisation dans les paramètres de votre navigateur ou cliquez sur l\'icône de cadenas dans la barre d\'adresse.'
            break
          case error.POSITION_UNAVAILABLE:
            errorMessage += 'Position indisponible. Activez votre GPS et vérifiez votre connexion réseau.'
            break
          case error.TIMEOUT:
            errorMessage += 'Délai d\'attente dépassé. Réessayez dans quelques instants.'
            break
          default:
            errorMessage += 'Erreur inconnue. Vérifiez vos paramètres de localisation.'
            break
        }

        const geolocationError = new Error(errorMessage)
        geolocationError.code = error.code
        reject(geolocationError)
      },
      { ...defaultOptions, ...options }
    )
  })
}

export const watchPosition = (callback, errorCallback, options = {}) => {
  const status = getGeolocationStatus()
  if (!status.supported) {
    errorCallback(new Error(status.reason))
    return null
  }

  const defaultOptions = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 30000
  }

  return navigator.geolocation.watchPosition(
    callback,
    (error) => {
      let errorMessage = 'Erreur de géolocalisation: '

      switch (error.code) {
        case error.PERMISSION_DENIED:
          errorMessage += 'Permission refusée. Autorisez l\'accès à la localisation dans les paramètres de votre navigateur.'
          break
        case error.POSITION_UNAVAILABLE:
          errorMessage += 'Position indisponible. Vérifiez votre connexion GPS.'
          break
        case error.TIMEOUT:
          errorMessage += 'Délai d\'attente dépassé. Réessayez.'
          break
        default:
          errorMessage += 'Erreur inconnue.'
          break
      }

      const geolocationError = new Error(errorMessage)
      geolocationError.code = error.code
      errorCallback(geolocationError)
    },
    { ...defaultOptions, ...options }
  )
}

export const getGeolocationHelp = () => {
  const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor)
  const isFirefox = /Firefox/.test(navigator.userAgent)
  const isSafari = /Safari/.test(navigator.userAgent) && /Apple Computer/.test(navigator.vendor)

  let instructions = 'Pour autoriser la géolocalisation :\n\n'

  if (isChrome) {
    instructions += '1. Cliquez sur l\'icône de cadenas 🔒 dans la barre d\'adresse\n'
    instructions += '2. Sélectionnez "Site settings"\n'
    instructions += '3. Changez "Location" à "Allow"\n'
    instructions += '4. Actualisez la page'
  } else if (isFirefox) {
    instructions += '1. Cliquez sur l\'icône de bouclier 🛡️ à gauche de l\'URL\n'
    instructions += '2. Sélectionnez "Permissions"\n'
    instructions += '3. Activez "Access your location"\n'
    instructions += '4. Actualisez la page'
  } else if (isSafari) {
    instructions += '1. Allez dans Safari > Préférences > Sites web\n'
    instructions += '2. Sélectionnez "Localisation"\n'
    instructions += '3. Trouvez ce site et sélectionnez "Autoriser"\n'
    instructions += '4. Actualisez la page'
  } else {
    instructions += '1. Cliquez sur l\'icône de localisation dans la barre d\'adresse\n'
    instructions += '2. Autorisez l\'accès à la localisation\n'
    instructions += '3. Actualisez la page'
  }

  return instructions
}
