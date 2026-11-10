const hasOperatorKey = (root) => {
  const pending = [root];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    for (const key of Object.keys(value)) {
      if (key.startsWith('$')) return true;
      pending.push(value[key]);
    }
  }
  return false;
};

const rejectMongoOperators = (req, res, next) => {
  if (hasOperatorKey(req.body) || hasOperatorKey(req.query)) {
    return res.status(400).json({ success: false, message: 'Requete invalide' });
  }
  next();
};

module.exports = { hasOperatorKey, rejectMongoOperators };
