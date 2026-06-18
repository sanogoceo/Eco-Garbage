import { useEffect, useRef, useState } from 'react'
import { Crop, X } from 'lucide-react'

const CARD_RATIO = 1.586

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

const sourceRectangle = (image, zoom, horizontal, vertical) => {
  const imageRatio = image.naturalWidth / image.naturalHeight
  let baseWidth
  let baseHeight
  if (imageRatio > CARD_RATIO) {
    baseHeight = image.naturalHeight
    baseWidth = baseHeight * CARD_RATIO
  } else {
    baseWidth = image.naturalWidth
    baseHeight = baseWidth / CARD_RATIO
  }

  const width = baseWidth / zoom
  const height = baseHeight / zoom
  const maxX = image.naturalWidth - width
  const maxY = image.naturalHeight - height
  return {
    x: maxX * ((horizontal + 100) / 200),
    y: maxY * ((vertical + 100) / 200),
    width,
    height,
  }
}

export default function GuidedImageCrop({
  file,
  isEn,
  onCancel,
  onConfirm,
}) {
  const canvasRef = useRef(null)
  const [image, setImage] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [horizontal, setHorizontal] = useState(0)
  const [vertical, setVertical] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    loadImage(file).then(loaded => {
      if (active) setImage(loaded)
    })
    return () => { active = false }
  }, [file])

  useEffect(() => {
    if (!image || !canvasRef.current) return
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    const source = sourceRectangle(image, zoom, horizontal, vertical)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(
      image,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      canvas.width,
      canvas.height
    )
  }, [horizontal, image, vertical, zoom])

  const confirm = async () => {
    if (!canvasRef.current) return
    setSaving(true)
    canvasRef.current.toBlob((blob) => {
      if (!blob) {
        setSaving(false)
        return
      }
      const name = file.name.replace(/\.[^.]+$/, '') + '-cadree.jpg'
      onConfirm(new File([blob], name, { type: 'image/jpeg' }))
      setSaving(false)
    }, 'image/jpeg', 0.92)
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 p-4 flex items-center justify-center">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[95vh] overflow-y-auto">
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h3 className="font-display font-bold flex items-center gap-2">
              <Crop size={18} className="text-[#1A8A3C]" />
              {isEn ? 'Frame the ID card' : 'Cadrez la CNI'}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              {isEn
                ? 'Keep all four corners and all text inside the frame.'
                : 'Gardez les quatre coins et tout le texte dans le cadre.'}
            </p>
          </div>
          <button type="button" onClick={onCancel} className="btn-ghost p-2">
            <X size={19} />
          </button>
        </div>

        <div className="p-5">
          <div className="relative rounded-xl overflow-hidden bg-gray-900 border-4 border-[#1A8A3C] shadow-inner">
            <canvas
              ref={canvasRef}
              width="1200"
              height="757"
              className="block w-full aspect-[1.586/1] object-contain"
            />
            <div className="pointer-events-none absolute inset-3 border-2 border-dashed border-white/90 rounded-lg" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/10" />
          </div>

          <div className="grid sm:grid-cols-3 gap-4 mt-5">
            <label className="text-xs font-semibold text-gray-600">
              {isEn ? 'Zoom' : 'Zoom'}
              <input
                type="range"
                min="1"
                max="2.5"
                step="0.05"
                value={zoom}
                onChange={event => setZoom(Number(event.target.value))}
                className="w-full accent-[#1A8A3C] mt-2"
              />
            </label>
            <label className="text-xs font-semibold text-gray-600">
              {isEn ? 'Horizontal position' : 'Position horizontale'}
              <input
                type="range"
                min="-100"
                max="100"
                value={horizontal}
                onChange={event => setHorizontal(Number(event.target.value))}
                className="w-full accent-[#1A8A3C] mt-2"
              />
            </label>
            <label className="text-xs font-semibold text-gray-600">
              {isEn ? 'Vertical position' : 'Position verticale'}
              <input
                type="range"
                min="-100"
                max="100"
                value={vertical}
                onChange={event => setVertical(Number(event.target.value))}
                className="w-full accent-[#1A8A3C] mt-2"
              />
            </label>
          </div>

          <div className="flex gap-3 mt-6">
            <button type="button" onClick={onCancel} className="btn-outline flex-1 justify-center">
              {isEn ? 'Cancel' : 'Annuler'}
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!image || saving}
              className="btn-primary flex-1 justify-center"
            >
              {saving
                ? (isEn ? 'Preparing...' : 'Preparation...')
                : (isEn ? 'Use this crop' : 'Utiliser ce cadrage')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
