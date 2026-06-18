const QUALITY_RULES = {
  profile_photo: { minWidth: 600, minHeight: 600, minBytes: 25 * 1024 },
  id_front: { minWidth: 900, minHeight: 550, minBytes: 35 * 1024 },
  id_back: { minWidth: 900, minHeight: 550, minBytes: 35 * 1024 },
  selfie_with_id: { minWidth: 720, minHeight: 720, minBytes: 35 * 1024 },
  vehicle_photo: { minWidth: 640, minHeight: 480, minBytes: 25 * 1024 },
}

const loadImage = file => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.onload = () => {
    URL.revokeObjectURL(url)
    resolve(image)
  }
  image.onerror = () => {
    URL.revokeObjectURL(url)
    reject(new Error('IMAGE_DECODE_FAILED'))
  }
  image.src = url
})

const calculateMetrics = (image) => {
  const maxSide = 240
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(8, Math.round(image.naturalWidth * scale))
  const height = Math.max(8, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(image, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height).data
  const gray = new Float32Array(width * height)
  let luminanceTotal = 0

  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
    const luminance = (
      0.2126 * pixels[index]
      + 0.7152 * pixels[index + 1]
      + 0.0722 * pixels[index + 2]
    )
    gray[pixel] = luminance
    luminanceTotal += luminance
  }

  let laplacianTotal = 0
  let laplacianSquaredTotal = 0
  let samples = 0
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = gray[y * width + x]
      const value = (
        4 * center
        - gray[y * width + x - 1]
        - gray[y * width + x + 1]
        - gray[(y - 1) * width + x]
        - gray[(y + 1) * width + x]
      )
      laplacianTotal += value
      laplacianSquaredTotal += value * value
      samples += 1
    }
  }

  const mean = samples ? laplacianTotal / samples : 0
  return {
    brightness: Math.round(luminanceTotal / (width * height)),
    sharpness: Math.round(
      samples ? laplacianSquaredTotal / samples - mean * mean : 0
    ),
  }
}

export const analyzeImageQuality = async (file, type) => {
  const rules = QUALITY_RULES[type] || QUALITY_RULES.vehicle_photo
  const image = await loadImage(file)
  const metrics = calculateMetrics(image)
  const errors = []
  const warnings = []

  if (file.size < rules.minBytes) errors.push('file_too_small')
  if (
    image.naturalWidth < rules.minWidth
    || image.naturalHeight < rules.minHeight
  ) {
    errors.push('dimensions_too_small')
  }
  if (metrics.brightness < 45) {
    errors.push('too_dark')
  } else if (metrics.brightness < 70) {
    warnings.push('low_light')
  }
  if (metrics.sharpness < 35) {
    errors.push('too_blurry')
  } else if (metrics.sharpness < 80) {
    warnings.push('slightly_blurry')
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      ...metrics,
      width: image.naturalWidth,
      height: image.naturalHeight,
      bytes: file.size,
    },
  }
}

export const qualityMessage = (code, isEn = false) => ({
  file_too_small: isEn
    ? 'The file is too small. Use the original camera photo.'
    : 'Le fichier est trop petit. Utilisez la photo originale de la camera.',
  dimensions_too_small: isEn
    ? 'The image resolution is too low.'
    : 'La resolution de l image est insuffisante.',
  too_dark: isEn
    ? 'The image is too dark. Add more light.'
    : 'La photo est trop sombre. Ajoutez davantage de lumiere.',
  low_light: isEn
    ? 'Lighting is a little low.'
    : 'La luminosite est un peu faible.',
  too_blurry: isEn
    ? 'The image is too blurry. Hold the phone steady and retry.'
    : 'La photo est trop floue. Stabilisez le telephone et recommencez.',
  slightly_blurry: isEn
    ? 'The image may be slightly blurry.'
    : 'La photo semble legerement floue.',
}[code] || code)

