const { v4: uuidv4 } = require('uuid');
const RecurringSchedule = require('../models/RecurringSchedule');
const WasteCategory = require('../models/WasteCategory');
const { normalizeAddress, validateStructuredAddress } = require('../utils/address');

const FREQUENCIES = ['weekly', 'biweekly', 'monthly'];

const calculateNextRun = ({ frequency, first_run_at, day_of_week, day_of_month, preferred_time }) => {
  if (first_run_at) {
    const first = new Date(first_run_at);
    if (!Number.isNaN(first.getTime()) && first > new Date()) return first;
  }

  const [hours, minutes] = String(preferred_time || '08:00').split(':').map(Number);
  const next = new Date();
  next.setSeconds(0, 0);
  next.setHours(hours || 8, minutes || 0, 0, 0);

  if (frequency === 'monthly') {
    next.setDate(Math.min(28, Math.max(1, Number(day_of_month) || 1)));
    if (next <= new Date()) next.setMonth(next.getMonth() + 1);
  } else {
    const targetDay = Math.min(6, Math.max(0, Number(day_of_week) || 1));
    let delta = (targetDay - next.getDay() + 7) % 7;
    if (delta === 0 && next <= new Date()) delta = frequency === 'biweekly' ? 14 : 7;
    next.setDate(next.getDate() + delta);
  }
  return next;
};

const listSchedules = async (req, res) => {
  try {
    const rows = await RecurringSchedule.find({ user_id: req.user.id })
      .populate('category_id', 'name icon base_price')
      .sort({ created_at: -1 }).lean();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const createSchedule = async (req, res) => {
  try {
    const {
      category_id, frequency, day_of_week, day_of_month, preferred_time,
      first_run_at, address, latitude, longitude, quantity_estimate,
      quantity_number = 1, notes,
    } = req.body;
    const addressDetails = normalizeAddress(req.body);
    if (!FREQUENCIES.includes(frequency)
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(preferred_time || '')
      || validateStructuredAddress(addressDetails, {
        allowLegacy: !(req.body.city || req.body.district),
      })) {
      return res.status(400).json({ success: false, message: 'Frequence, heure et adresse requises' });
    }
    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))
      || Number(latitude) < -90 || Number(latitude) > 90
      || Number(longitude) < -180 || Number(longitude) > 180) {
      return res.status(400).json({ success: false, message: 'Position GPS requise' });
    }
    if (frequency === 'monthly' && (Number(day_of_month) < 1 || Number(day_of_month) > 28)) {
      return res.status(400).json({ success: false, message: 'Jour du mois invalide' });
    }
    if (frequency !== 'monthly' && (Number(day_of_week) < 0 || Number(day_of_week) > 6)) {
      return res.status(400).json({ success: false, message: 'Jour de la semaine invalide' });
    }
    if (!await WasteCategory.exists({ _id: category_id, is_active: true })) {
      return res.status(404).json({ success: false, message: 'Categorie introuvable' });
    }

    const schedule = await RecurringSchedule.create({
      uuid: uuidv4(),
      user_id: req.user.id,
      category_id,
      frequency,
      day_of_week,
      day_of_month,
      preferred_time,
      next_run_at: calculateNextRun({
        frequency, first_run_at, day_of_week, day_of_month, preferred_time,
      }),
      address: addressDetails.formatted,
      address_details: addressDetails,
      latitude: Number(latitude),
      longitude: Number(longitude),
      quantity_estimate: String(quantity_estimate || '').trim(),
      quantity_number: Math.min(20, Math.max(1, Number(quantity_number) || 1)),
      notes: String(notes || '').trim(),
    });
    res.status(201).json({ success: true, message: 'Collecte recurrente programmee', data: schedule });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const updateSchedule = async (req, res) => {
  try {
    const schedule = await RecurringSchedule.findOne({
      uuid: req.params.uuid,
      user_id: req.user.id,
    });
    if (!schedule) {
      return res.status(404).json({ success: false, message: 'Programme introuvable' });
    }
    if (typeof req.body.is_active === 'boolean') schedule.is_active = req.body.is_active;
    if (req.body.preferred_time) schedule.preferred_time = req.body.preferred_time;
    if (req.body.address || req.body.address_line) {
      const addressDetails = normalizeAddress(req.body);
      schedule.address = addressDetails.formatted;
      schedule.address_details = addressDetails;
    }
    await schedule.save();
    res.json({ success: true, message: 'Programme mis a jour', data: schedule });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

module.exports = { calculateNextRun, createSchedule, listSchedules, updateSchedule };
