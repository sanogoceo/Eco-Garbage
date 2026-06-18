export const SERVICE_TYPES = [
  {
    value: 'immediate',
    fr: 'Immediate',
    en: 'Immediate',
    descriptionFr: 'Dans les plus brefs delais',
    descriptionEn: 'As soon as possible',
  },
  {
    value: 'scheduled',
    fr: 'Planifiee',
    en: 'Scheduled',
    descriptionFr: 'A la date choisie',
    descriptionEn: 'On a chosen date',
  },
  {
    value: 'recurring',
    fr: 'Recurrente',
    en: 'Recurring',
    descriptionFr: 'Passages reguliers',
    descriptionEn: 'Regular pickups',
  },
  {
    value: 'business',
    fr: 'Entreprise',
    en: 'Business',
    descriptionFr: 'Pour les professionnels',
    descriptionEn: 'For professionals',
  },
  {
    value: 'bulk',
    fr: 'Gros volume',
    en: 'Bulk',
    descriptionFr: 'Encombrants et chantier',
    descriptionEn: 'Bulky and construction waste',
  },
  {
    value: 'recyclable',
    fr: 'Recyclables',
    en: 'Recyclables',
    descriptionFr: 'Matieres recyclables uniquement',
    descriptionEn: 'Recyclable materials only',
  },
]

export const SCHEDULED_SERVICE_TYPES = ['scheduled', 'business', 'bulk', 'recyclable']

export const getServiceTypeLabel = (value, isEn = false) => {
  const service = SERVICE_TYPES.find((item) => item.value === value)
  return service ? service[isEn ? 'en' : 'fr'] : value || '-'
}
