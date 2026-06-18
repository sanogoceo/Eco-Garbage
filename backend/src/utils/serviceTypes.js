const SERVICE_TYPES = [
  'immediate',
  'scheduled',
  'recurring',
  'business',
  'bulk',
  'recyclable',
];

const DIRECT_SERVICE_TYPES = SERVICE_TYPES.filter((type) => type !== 'recurring');
const SCHEDULED_SERVICE_TYPES = ['scheduled', 'business', 'bulk', 'recyclable'];
const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;
const MIN_SCHEDULE_LEAD_MS = 15 * 60 * 1000;
const COLLECTION_START_LEAD_MS = 60 * 60 * 1000;

const validateServiceRequest = ({
  serviceType,
  scheduledAt,
  category,
  requireSchedule = true,
  now = new Date(),
}) => {
  if (!SERVICE_TYPES.includes(serviceType)) {
    return { message: 'Type de service invalide' };
  }
  if (serviceType === 'recurring') {
    return {
      message: 'Utilisez le module Collectes recurrentes pour programmer ce service',
    };
  }
  if (serviceType === 'recyclable' && !category?.is_recyclable) {
    return {
      message: 'Le service Recyclables exige une categorie recyclable',
    };
  }
  if (!requireSchedule || !SCHEDULED_SERVICE_TYPES.includes(serviceType)) {
    return { scheduledDate: undefined };
  }

  const scheduledDate = new Date(scheduledAt);
  if (Number.isNaN(scheduledDate.getTime())) {
    return { message: 'Date et heure de collecte valides requises' };
  }
  if (scheduledDate.getTime() < now.getTime() + MIN_SCHEDULE_LEAD_MS) {
    return {
      message: 'La collecte doit etre programmee au moins 15 minutes a l avance',
    };
  }
  if (scheduledDate.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_MS) {
    return {
      message: 'La collecte ne peut pas etre programmee plus d un an a l avance',
    };
  }
  return { scheduledDate };
};

module.exports = {
  COLLECTION_START_LEAD_MS,
  DIRECT_SERVICE_TYPES,
  SCHEDULED_SERVICE_TYPES,
  SERVICE_TYPES,
  validateServiceRequest,
};
