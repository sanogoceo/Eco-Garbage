const DeviceToken = require('../models/DeviceToken');

const registerDevice = async (req, res) => {
  try {
    const { token, platform = 'android', device_name } = req.body;
    if (!token || token.length < 20) {
      return res.status(400).json({ success: false, message: 'Jeton appareil invalide' });
    }
    if (!['android', 'web', 'ios'].includes(platform)) {
      return res.status(400).json({ success: false, message: 'Plateforme invalide' });
    }

    await DeviceToken.findOneAndUpdate(
      { token },
      {
        $set: {
          user_id: req.user.id,
          platform,
          device_name: String(device_name || '').slice(0, 100),
          is_active: true,
          last_seen_at: new Date(),
        },
      },
      { upsert: true, new: true }
    );
    res.json({ success: true, message: 'Appareil enregistre pour les notifications' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const unregisterDevice = async (req, res) => {
  try {
    const { token } = req.body;
    await DeviceToken.updateOne(
      { token, user_id: req.user.id },
      { $set: { is_active: false } }
    );
    res.json({ success: true, message: 'Notifications desactivees sur cet appareil' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

module.exports = { registerDevice, unregisterDevice };
