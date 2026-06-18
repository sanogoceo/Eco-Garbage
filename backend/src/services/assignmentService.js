const mongoose = require('mongoose');
const User = require('../models/User');
const PickupRequest = require('../models/PickupRequest');
const { MAX_SEARCH_RADIUS_KM } = require('../utils/geo');
const { hasValidHazardousCertification } = require('../utils/collectorCertification');

const VEHICLE_CAPACITY = {
  foot: 2,
  motorcycle: 5,
  car: 8,
  tricycle: 12,
  van: 30,
};

const normalize = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const isVehicleCompatible = ({
  vehicleType,
  quantity = 1,
  serviceType = 'immediate',
  isHazardous = false,
  hazardousCertified = false,
}) => {
  const capacity = VEHICLE_CAPACITY[vehicleType] || 1;
  return capacity >= quantity
    && (!isHazardous || ['car', 'van'].includes(vehicleType))
    && (!isHazardous || hazardousCertified)
    && (serviceType !== 'bulk' || ['tricycle', 'van'].includes(vehicleType));
};

const findBestCollector = async ({
  latitude,
  longitude,
  address,
  quantity = 1,
  serviceType = 'immediate',
  isHazardous = false,
  excludedUserId = null,
}) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const candidates = await User.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        key: 'collector_profile.location',
        distanceField: 'distance_meters',
        maxDistance: MAX_SEARCH_RADIUS_KM * 1000,
        spherical: true,
        query: {
          role: 'collector',
          is_active: true,
          'collector_profile.is_available': true,
          'collector_profile.verification_status': 'verified',
          'collector_profile.location.coordinates': { $ne: [0, 0] },
          ...(excludedUserId && mongoose.isValidObjectId(excludedUserId)
            ? { _id: { $ne: new mongoose.Types.ObjectId(excludedUserId) } }
            : {}),
        },
      },
    },
    { $limit: 25 },
    {
      $project: {
        name: 1,
        avatar_url: 1,
        phone: 1,
        collector_profile: 1,
        distance_km: { $divide: ['$distance_meters', 1000] },
      },
    },
  ]);
  if (!candidates.length) return null;

  const activeCounts = await PickupRequest.aggregate([
    {
      $match: {
        collector_id: { $in: candidates.map((candidate) => candidate._id) },
        status: { $in: ['assigned', 'on_way', 'in_progress'] },
      },
    },
    { $group: { _id: '$collector_id', count: { $sum: 1 } } },
  ]);
  const countMap = new Map(activeCounts.map((row) => [row._id.toString(), row.count]));
  const normalizedAddress = normalize(address);

  const ranked = candidates
    .map((collector) => {
      const profile = collector.collector_profile || {};
      const vehicle = profile.vehicle_type || 'foot';
      const vehicleMatch = isVehicleCompatible({
        vehicleType: vehicle,
        quantity,
        serviceType,
        isHazardous,
        hazardousCertified: hasValidHazardousCertification(collector),
      });
      const areas = Array.isArray(profile.service_zones)
        ? profile.service_zones
        : [profile.service_area];
      const zoneMatch = areas.filter(Boolean).some((area) => {
        const normalizedArea = normalize(area);
        return normalizedArea && normalizedAddress.includes(normalizedArea);
      });
      const activeTasks = countMap.get(collector._id.toString()) || 0;
      const rating = Number(profile.rating_avg || 0);
      const score = (rating * 8)
        + (zoneMatch ? 18 : 0)
        + (vehicleMatch ? 15 : -100)
        - (collector.distance_km * 2)
        - (activeTasks * 8);
      return {
        collector,
        distance_km: Math.round(collector.distance_km * 100) / 100,
        metadata: {
          score: Math.round(score * 100) / 100,
          distance_km: Math.round(collector.distance_km * 100) / 100,
          zone_match: zoneMatch,
          vehicle_match: vehicleMatch,
          rating,
          active_tasks: activeTasks,
          assigned_at: new Date(),
        },
      };
    })
    .filter((candidate) => candidate.metadata.vehicle_match)
    .sort((left, right) => right.metadata.score - left.metadata.score);

  return ranked[0] || null;
};

module.exports = { findBestCollector, isVehicleCompatible, VEHICLE_CAPACITY };
