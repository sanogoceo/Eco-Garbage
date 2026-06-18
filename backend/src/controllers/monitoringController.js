const mongoose = require('mongoose');
const ApiMetric = require('../models/ApiMetric');
const MonitoringIncident = require('../models/MonitoringIncident');
const AuditLog = require('../models/AuditLog');
const {
  getRuntimeHealth,
  recordIncident,
} = require('../services/monitoringService');

const clampHours = (value) => Math.min(
  168,
  Math.max(1, Number.parseInt(value, 10) || 24)
);

const getMonitoringDashboard = async (req, res) => {
  try {
    const hours = clampHours(req.query.hours);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const incidentFilter = {};
    if (req.query.source) {
      const source = String(req.query.source);
      if (!['backend', 'frontend', 'database', 'system'].includes(source)) {
        return res.status(400).json({ success: false, message: 'Source invalide' });
      }
      incidentFilter.source = source;
    }
    if (req.query.resolved === 'true') incidentFilter.resolved = true;
    else if (req.query.resolved !== 'all') incidentFilter.resolved = false;

    const [
      health,
      aggregateRows,
      endpointRows,
      timelineRows,
      incidents,
      incidentTotal,
      durations,
    ] = await Promise.all([
      getRuntimeHealth(),
      ApiMetric.aggregate([
        { $match: { recorded_at: { $gte: since } } },
        {
          $group: {
            _id: null,
            requests: { $sum: 1 },
            errors: { $sum: { $cond: ['$is_error', 1, 0] } },
            average_ms: { $avg: '$duration_ms' },
            maximum_ms: { $max: '$duration_ms' },
            slow_requests: {
              $sum: { $cond: [{ $gte: ['$duration_ms', 1500] }, 1, 0] },
            },
          },
        },
      ]),
      ApiMetric.aggregate([
        { $match: { recorded_at: { $gte: since } } },
        {
          $group: {
            _id: { route: '$route', method: '$method' },
            requests: { $sum: 1 },
            errors: { $sum: { $cond: ['$is_error', 1, 0] } },
            average_ms: { $avg: '$duration_ms' },
            maximum_ms: { $max: '$duration_ms' },
          },
        },
        { $sort: { average_ms: -1 } },
        { $limit: 12 },
      ]),
      ApiMetric.aggregate([
        { $match: { recorded_at: { $gte: since } } },
        {
          $group: {
            _id: {
              $dateToString: {
                date: '$recorded_at',
                format: hours <= 24 ? '%Y-%m-%dT%H:00:00Z' : '%Y-%m-%d',
                timezone: 'UTC',
              },
            },
            requests: { $sum: 1 },
            errors: { $sum: { $cond: ['$is_error', 1, 0] } },
            average_ms: { $avg: '$duration_ms' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      MonitoringIncident.find(incidentFilter)
        .populate('user_id', 'name email role')
        .populate('resolved_by', 'name email')
        .sort({ resolved: 1, severity: 1, last_seen_at: -1 })
        .limit(50)
        .lean(),
      MonitoringIncident.countDocuments(incidentFilter),
      ApiMetric.find({ recorded_at: { $gte: since } })
        .select('duration_ms -_id')
        .sort({ duration_ms: 1 })
        .limit(10000)
        .lean(),
    ]);

    const aggregate = aggregateRows[0] || {
      requests: 0,
      errors: 0,
      average_ms: 0,
      maximum_ms: 0,
      slow_requests: 0,
    };
    const p95Index = durations.length
      ? Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)
      : 0;
    const p95 = durations[p95Index]?.duration_ms || 0;
    res.json({
      success: true,
      data: {
        health,
        period_hours: hours,
        metrics: {
          requests: aggregate.requests,
          errors: aggregate.errors,
          error_rate: aggregate.requests
            ? Math.round((aggregate.errors / aggregate.requests) * 10000) / 100
            : 0,
          average_ms: Math.round((aggregate.average_ms || 0) * 100) / 100,
          p95_ms: Math.round(p95 * 100) / 100,
          maximum_ms: Math.round((aggregate.maximum_ms || 0) * 100) / 100,
          slow_requests: aggregate.slow_requests,
        },
        endpoints: endpointRows.map((row) => ({
          route: row._id.route,
          method: row._id.method,
          requests: row.requests,
          errors: row.errors,
          average_ms: Math.round(row.average_ms * 100) / 100,
          maximum_ms: Math.round(row.maximum_ms * 100) / 100,
        })),
        timeline: timelineRows.map((row) => ({
          timestamp: row._id,
          requests: row.requests,
          errors: row.errors,
          average_ms: Math.round(row.average_ms * 100) / 100,
        })),
        incidents: incidents.map((incident) => ({
          id: incident._id.toString(),
          source: incident.source,
          severity: incident.severity,
          kind: incident.kind,
          message: incident.message,
          stack: incident.stack,
          route: incident.route,
          method: incident.method,
          status_code: incident.status_code,
          occurrences: incident.occurrences,
          first_seen_at: incident.first_seen_at,
          last_seen_at: incident.last_seen_at,
          last_alerted_at: incident.last_alerted_at,
          resolved: incident.resolved,
          metadata: incident.metadata,
          user: incident.user_id
            ? {
                id: incident.user_id._id.toString(),
                name: incident.user_id.name,
                email: incident.user_id.email,
                role: incident.user_id.role,
              }
            : null,
          resolved_by: incident.resolved_by?.name,
          resolved_at: incident.resolved_at,
        })),
        incident_total: incidentTotal,
      },
    });
  } catch (error) {
    console.error('getMonitoringDashboard error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const reportFrontendError = async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    const kind = String(req.body.kind || 'frontend_error').trim();
    if (!message || message.length > 1000) {
      return res.status(400).json({ success: false, message: 'Erreur frontend invalide' });
    }
    const incident = await recordIncident({
      source: 'frontend',
      severity: req.body.severity === 'warning' ? 'warning' : 'error',
      kind: kind.slice(0, 120),
      message,
      stack: req.body.stack,
      route: req.body.route,
      method: 'CLIENT',
      userId: req.user?.id,
      metadata: {
        browser: String(req.body.browser || req.get('user-agent') || '').slice(0, 300),
        release: String(req.body.release || '').slice(0, 100),
      },
    });
    return res.status(202).json({
      success: true,
      data: { incident_id: incident?._id?.toString() },
    });
  } catch (error) {
    console.error('reportFrontendError error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const resolveIncident = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Incident invalide' });
    }
    const incident = await MonitoringIncident.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          resolved: true,
          resolved_at: new Date(),
          resolved_by: req.user.id,
        },
      },
      { new: true }
    );
    if (!incident) {
      return res.status(404).json({ success: false, message: 'Incident introuvable' });
    }
    await AuditLog.create({
      actor_id: req.user.id,
      action: 'monitoring.incident_resolved',
      target_type: 'MonitoringIncident',
      target_id: incident._id,
      metadata: {
        source: incident.source,
        severity: incident.severity,
        kind: incident.kind,
      },
      ip: req.ip,
      user_agent: req.get('user-agent'),
    });
    res.json({ success: true, message: 'Incident marque comme resolu' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

module.exports = {
  getMonitoringDashboard,
  reportFrontendError,
  resolveIncident,
};
