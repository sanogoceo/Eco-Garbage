const ServiceConfiguration = require('../models/ServiceConfiguration');
const ServiceSlot = require('../models/ServiceSlot');
const {
  MIN_PRICE,
  PRICE_PER_KM,
} = require('../utils/geo');
const {
  SERVICE_TYPES,
  SCHEDULED_SERVICE_TYPES,
} = require('../utils/serviceTypes');

const DEFAULT_CONFIGURATIONS = {
  immediate: {
    price_multiplier: 1,
    fixed_fee: 0,
    slot_duration_minutes: 60,
    max_requests_per_slot: 25,
  },
  scheduled: {
    price_multiplier: 1,
    fixed_fee: 0,
    slot_duration_minutes: 60,
    max_requests_per_slot: 12,
  },
  recurring: {
    price_multiplier: 0.95,
    fixed_fee: 0,
    slot_duration_minutes: 60,
    max_requests_per_slot: 15,
  },
  business: {
    price_multiplier: 1.1,
    fixed_fee: 500,
    slot_duration_minutes: 60,
    max_requests_per_slot: 10,
  },
  bulk: {
    price_multiplier: 1.25,
    fixed_fee: 1000,
    slot_duration_minutes: 120,
    max_requests_per_slot: 6,
  },
  recyclable: {
    price_multiplier: 0.9,
    fixed_fee: 0,
    slot_duration_minutes: 60,
    max_requests_per_slot: 15,
  },
};

const DEFAULT_WEEKLY_SCHEDULE = Array.from({ length: 7 }, (_, day) => ({
  day_of_week: day,
  is_open: true,
  opening_time: '07:00',
  closing_time: '19:00',
}));

const defaultConfiguration = (serviceType) => ({
  service_type: serviceType,
  ...DEFAULT_CONFIGURATIONS[serviceType],
  zone_pricing: [],
  weekly_schedule: DEFAULT_WEEKLY_SCHEDULE,
  blackout_dates: [],
  is_active: true,
});

const getServiceConfiguration = async (serviceType) => {
  const existing = await ServiceConfiguration.findOne({ service_type: serviceType }).lean();
  return existing || defaultConfiguration(serviceType);
};

const listServiceConfigurations = async () => {
  const rows = await ServiceConfiguration.find({
    service_type: { $in: SERVICE_TYPES },
  }).lean();
  const byType = new Map(rows.map((row) => [row.service_type, row]));
  return SERVICE_TYPES.map((serviceType) => (
    byType.get(serviceType) || defaultConfiguration(serviceType)
  ));
};

const calculateConfiguredPrice = async ({
  basePrice,
  quantity,
  distanceKm,
  serviceType,
  city,
  district,
}) => {
  const configuration = await getServiceConfiguration(serviceType);
  if (!configuration.is_active) {
    return { message: 'Ce type de service est temporairement indisponible' };
  }
  const normalizedQuantity = Math.max(1, Number(quantity) || 1);
  const normalizedDistance = Math.max(0, Number(distanceKm) || 0);
  const baseSubtotal = Number(basePrice) * normalizedQuantity;
  const distanceFee = normalizedDistance * PRICE_PER_KM;
  const subtotal = baseSubtotal + distanceFee;
  const normalizedCity = String(city || '').trim().toLowerCase();
  const normalizedDistrict = String(district || '').trim().toLowerCase();
  const matchingZones = (configuration.zone_pricing || []).filter((item) => (
    String(item.city || '').trim().toLowerCase() === normalizedCity
  ));
  const zone = matchingZones.find((item) => (
    String(item.district || '').trim().toLowerCase() === normalizedDistrict
    && normalizedDistrict
  )) || matchingZones.find((item) => !String(item.district || '').trim());
  const zoneMultiplier = Number(zone?.price_multiplier || 1);
  const zoneFee = Number(zone?.fixed_fee || 0);
  const total = Math.max(
    MIN_PRICE,
    Math.round(
      subtotal * Number(configuration.price_multiplier) * zoneMultiplier
      + Number(configuration.fixed_fee)
      + zoneFee
    )
  );
  return {
    total,
    configuration,
    breakdown: {
      base_subtotal: Math.round(baseSubtotal),
      distance_fee: Math.round(distanceFee),
      service_multiplier: Number(configuration.price_multiplier),
      service_fee: Number(configuration.fixed_fee),
      zone_multiplier: zoneMultiplier,
      zone_fee: zoneFee,
      zone_label: zone
        ? [zone.city, zone.district].filter(Boolean).join(' / ')
        : undefined,
      total,
    },
  };
};

const normalizeSlotStart = (value, durationMinutes) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const durationMs = durationMinutes * 60 * 1000;
  return new Date(Math.floor(date.getTime() / durationMs) * durationMs);
};

const reserveServiceSlot = async ({ serviceType, scheduledAt }) => {
  if (!SCHEDULED_SERVICE_TYPES.includes(serviceType) && serviceType !== 'recurring') {
    return null;
  }
  const configuration = await getServiceConfiguration(serviceType);
  const requestedAt = new Date(scheduledAt);
  if (Number.isNaN(requestedAt.getTime())) return null;
  const cameroonDate = new Date(requestedAt.getTime() + 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const slots = await listAvailableSlots({ serviceType, date: cameroonDate });
  const selected = slots.find((slot) => (
    slot.available && slot.start_at.getTime() === requestedAt.getTime()
  ));
  if (!selected) return null;
  const startAt = selected.start_at;
  if (!startAt) return null;
  const endAt = selected.end_at;
  const key = { service_type: serviceType, start_at: startAt };
  try {
    await ServiceSlot.findOneAndUpdate(
      key,
      {
        $set: {
          end_at: endAt,
          capacity: selected.capacity,
        },
        $setOnInsert: { reserved_count: 0 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  return ServiceSlot.findOneAndUpdate(
    {
      ...key,
      $expr: { $lt: ['$reserved_count', '$capacity'] },
    },
    { $inc: { reserved_count: 1 } },
    { new: true }
  );
};

const releaseServiceSlot = async (slotId) => {
  if (!slotId) return;
  await ServiceSlot.updateOne(
    { _id: slotId, reserved_count: { $gt: 0 } },
    { $inc: { reserved_count: -1 } }
  );
};

const parseTime = (value, fallback) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  return hours * 60 + minutes;
};

const getDaySchedule = (configuration, startOfDay) => {
  const localDay = new Date(startOfDay.getTime() + 60 * 60 * 1000).getUTCDay();
  const configured = (configuration.weekly_schedule || []).find(
    (item) => Number(item.day_of_week) === localDay
  );
  return configured || DEFAULT_WEEKLY_SCHEDULE[localDay];
};

const listAvailableSlots = async ({ serviceType, date }) => {
  const configuration = await getServiceConfiguration(serviceType);
  if (!configuration.is_active) return [];
  if ((configuration.blackout_dates || []).includes(date)) return [];
  const startOfDay = new Date(`${date}T00:00:00+01:00`);
  if (Number.isNaN(startOfDay.getTime())) return [];
  const daySchedule = getDaySchedule(configuration, startOfDay);
  if (daySchedule.is_open === false) return [];
  const openingMinutes = parseTime(daySchedule.opening_time, 7 * 60);
  const closingMinutes = parseTime(daySchedule.closing_time, 19 * 60);
  if (closingMinutes <= openingMinutes) return [];
  const opening = new Date(startOfDay.getTime() + openingMinutes * 60 * 1000);
  const closing = new Date(startOfDay.getTime() + closingMinutes * 60 * 1000);
  const existing = await ServiceSlot.find({
    service_type: serviceType,
    start_at: { $gte: opening, $lt: closing },
  }).lean();
  const byStart = new Map(existing.map((slot) => [slot.start_at.getTime(), slot]));
  const slots = [];
  const durationMs = configuration.slot_duration_minutes * 60 * 1000;
  for (let time = opening.getTime(); time < closing.getTime(); time += durationMs) {
    const stored = byStart.get(time);
    const reserved = stored?.reserved_count || 0;
    const capacity = Number(
      daySchedule.capacity_override || configuration.max_requests_per_slot
    );
    slots.push({
      start_at: new Date(time),
      end_at: new Date(time + durationMs),
      capacity,
      reserved,
      remaining: Math.max(0, capacity - reserved),
      available: time >= Date.now() + 15 * 60 * 1000 && reserved < capacity,
    });
  }
  return slots;
};

const findNextAvailableSlot = async ({
  serviceType,
  preferredAt,
  maxDays = 14,
}) => {
  const preferred = new Date(preferredAt);
  if (Number.isNaN(preferred.getTime())) return null;
  const preferredMinutes = (
    new Date(preferred.getTime() + 60 * 60 * 1000).getUTCHours() * 60
    + new Date(preferred.getTime() + 60 * 60 * 1000).getUTCMinutes()
  );
  for (let offset = 0; offset <= maxDays; offset += 1) {
    const candidate = new Date(preferred.getTime() + offset * 24 * 60 * 60 * 1000);
    const local = new Date(candidate.getTime() + 60 * 60 * 1000);
    const date = local.toISOString().slice(0, 10);
    const slots = await listAvailableSlots({ serviceType, date });
    const selected = slots.find((slot) => {
      if (!slot.available) return false;
      if (offset > 0) return true;
      const slotLocal = new Date(slot.start_at.getTime() + 60 * 60 * 1000);
      return slotLocal.getUTCHours() * 60 + slotLocal.getUTCMinutes()
        >= preferredMinutes;
    });
    if (selected) return selected;
  }
  return null;
};

module.exports = {
  DEFAULT_CONFIGURATIONS,
  DEFAULT_WEEKLY_SCHEDULE,
  calculateConfiguredPrice,
  findNextAvailableSlot,
  getServiceConfiguration,
  listAvailableSlots,
  listServiceConfigurations,
  normalizeSlotStart,
  releaseServiceSlot,
  reserveServiceSlot,
};
