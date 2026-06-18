import { CAMEROON_CITIES } from '../../utils/cameroonLocations'

export default function StructuredAddressFields({
  value,
  onChange,
  isEn = false,
  required = true,
}) {
  const set = (key, nextValue) => onChange({ ...value, [key]: nextValue })

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <div>
        <label className="label">
          {isEn ? 'City' : 'Ville'} {required && <span className="text-red-500">*</span>}
        </label>
        <input
          className="input"
          list="cameroon-cities"
          value={value.city || ''}
          onChange={event => set('city', event.target.value)}
          placeholder={isEn ? 'e.g. Douala' : 'Ex: Douala'}
          required={required}
        />
        <datalist id="cameroon-cities">
          {CAMEROON_CITIES.map(city => <option key={city} value={city} />)}
        </datalist>
      </div>
      <div>
        <label className="label">
          {isEn ? 'Neighborhood / district' : 'Quartier'} {required && <span className="text-red-500">*</span>}
        </label>
        <input
          className="input"
          value={value.district || ''}
          onChange={event => set('district', event.target.value)}
          placeholder={isEn ? 'e.g. Bonamoussadi' : 'Ex: Bonamoussadi'}
          required={required}
        />
      </div>
      <div className="sm:col-span-2">
        <label className="label">
          {isEn ? 'Street and address' : 'Voie et adresse'} {required && <span className="text-red-500">*</span>}
        </label>
        <input
          className="input"
          value={value.address_line || ''}
          onChange={event => set('address_line', event.target.value)}
          placeholder={isEn ? 'Street, building, door...' : 'Rue, immeuble, porte...'}
          required={required}
        />
      </div>
      <div className="sm:col-span-2">
        <label className="label">{isEn ? 'Nearby landmark' : 'Repère proche'}</label>
        <input
          className="input"
          value={value.landmark || ''}
          onChange={event => set('landmark', event.target.value)}
          placeholder={isEn ? 'School, junction, store...' : 'École, carrefour, boutique...'}
        />
      </div>
    </div>
  )
}
