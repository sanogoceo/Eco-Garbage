const { v4: uuidv4 } = require('uuid');
const PickupRequest = require('../models/PickupRequest');
const RecurringSchedule = require('../models/RecurringSchedule');
const WasteCategory = require('../models/WasteCategory');
const { notifyUser } = require('./notificationService');
const { findBestCollector } = require('./assignmentService');
const {
  calculateConfiguredPrice,
  findNextAvailableSlot,
  releaseServiceSlot,
  reserveServiceSlot,
} = require('./serviceConfigurationService');

const advanceSchedule = (schedule) => {
  const base = new Date(schedule.next_run_at);
  if (schedule.frequency === 'monthly') base.setMonth(base.getMonth() + 1);
  else base.setDate(base.getDate() + (schedule.frequency === 'biweekly' ? 14 : 7));
  return base;
};

const processRecurringSchedules = async () => {
  const due = await RecurringSchedule.find({
    is_active: true,
    next_run_at: { $lte: new Date() },
  }).limit(50);

  for (const schedule of due) {
    const claimed = await RecurringSchedule.findOneAndUpdate(
      { _id: schedule._id, next_run_at: schedule.next_run_at, is_active: true },
      {
        $set: {
          last_generated_at: new Date(),
          next_run_at: advanceSchedule(schedule),
        },
      },
      { new: true }
    );
    if (!claimed) continue;

    const category = await WasteCategory.findById(schedule.category_id).lean();
    if (!category) continue;
    const assignment = await findBestCollector({
      latitude: schedule.latitude,
      longitude: schedule.longitude,
      address: schedule.address,
      quantity: schedule.quantity_number,
      serviceType: 'recurring',
      isHazardous: Boolean(category.is_hazardous),
      excludedUserId: schedule.user_id,
    });
    const pricing = await calculateConfiguredPrice({
      basePrice: category.base_price,
      quantity: schedule.quantity_number,
      distanceKm: assignment?.distance_km || 0,
      serviceType: 'recurring',
      city: schedule.address_details?.city,
      district: schedule.address_details?.district,
    });
    if (pricing.message) continue;
    const availableSlot = await findNextAvailableSlot({
      serviceType: 'recurring',
      preferredAt: schedule.next_run_at,
    });
    if (!availableSlot) {
      await notifyUser({
        userId: schedule.user_id,
        title: 'Collecte recurrente a reprogrammer',
        message: 'Aucun creneau disponible dans les 14 prochains jours.',
        type: 'request',
        data: { target_path: '/dashboard/recurring' },
      });
      continue;
    }
    const reservedSlot = await reserveServiceSlot({
      serviceType: 'recurring',
      scheduledAt: availableSlot.start_at,
    });
    if (!reservedSlot) {
      await notifyUser({
        userId: schedule.user_id,
        title: 'Creneau recurrent complet',
        message: 'La prochaine occurrence n a pas pu etre creee faute de capacite.',
        type: 'request',
        data: { target_path: '/dashboard/recurring' },
      });
      continue;
    }
    let request;
    try {
      request = await PickupRequest.create({
      uuid: uuidv4(),
      user_id: schedule.user_id,
      collector_id: assignment?.collector?._id,
      category_id: schedule.category_id,
      status: assignment ? 'assigned' : 'pending',
      address: schedule.address,
      address_details: schedule.address_details,
      latitude: schedule.latitude,
      longitude: schedule.longitude,
      quantity_estimate: schedule.quantity_estimate,
      quantity_number: schedule.quantity_number,
      notes: schedule.notes,
      scheduled_at: reservedSlot.start_at,
      service_slot_id: reservedSlot._id,
      estimated_price: pricing.total,
      pricing: pricing.breakdown,
      distance_km: assignment?.distance_km,
      assignment_metadata: assignment?.metadata,
      service_type: 'recurring',
      recurrence_schedule_id: schedule._id,
      status_history: [{
        to: assignment ? 'assigned' : 'pending',
        changed_by: schedule.user_id,
        note: assignment
          ? 'Demande recurrente generee et attribuee automatiquement'
          : 'Demande recurrente generee automatiquement',
      }],
      });
    } catch (error) {
      await releaseServiceSlot(reservedSlot._id).catch(() => {});
      throw error;
    }
    await notifyUser({
      userId: schedule.user_id,
      title: 'Collecte recurrente creee',
      message: `Votre prochaine collecte a ${schedule.address} a ete creee automatiquement.`,
      type: 'request',
      data: { request_uuid: request.uuid, target_path: `/dashboard/requests/${request.uuid}` },
    });
    if (assignment?.collector?._id) {
      await notifyUser({
        userId: assignment.collector._id,
        title: 'Nouvelle mission recurrente',
        message: `Collecte programmee a ${schedule.address}.`,
        type: 'request',
        data: { request_uuid: request.uuid, target_path: `/collector/tasks/${request.uuid}` },
      });
    }
  }
};

const startRecurringScheduler = () => {
  if (process.env.NODE_ENV === 'test') return;
  const interval = setInterval(() => {
    processRecurringSchedules().catch((error) => {
      console.error('Recurring schedule processing error:', error);
    });
  }, 5 * 60 * 1000);
  interval.unref();
};

module.exports = { processRecurringSchedules, startRecurringScheduler };
