const CAMEROON_CITIES = [
  'Bafoussam',
  'Bamenda',
  'Bertoua',
  'Buea',
  'Douala',
  'Ebolowa',
  'Garoua',
  'Kribi',
  'Limbe',
  'Maroua',
  'Ngaoundere',
  'Yaounde',
];

const clean = (value, maxLength) => String(value || '').trim().slice(0, maxLength);

const normalizeAddress = (body = {}) => {
  const city = clean(body.city || body.address_details?.city, 100);
  const district = clean(body.district || body.address_details?.district, 120);
  const addressLine = clean(
    body.address_line || body.address_details?.address_line || body.address,
    300
  );
  const landmark = clean(body.landmark || body.address_details?.landmark, 160);
  const postalCode = clean(body.postal_code || body.address_details?.postal_code, 20);
  const formatted = [
    addressLine,
    district,
    city,
    landmark ? `Repere: ${landmark}` : '',
  ].filter(Boolean).join(', ');

  return {
    city,
    district,
    address_line: addressLine,
    landmark,
    postal_code: postalCode,
    formatted,
  };
};

const validateStructuredAddress = (address, { allowLegacy = true } = {}) => {
  if (!address.address_line) return 'Adresse de collecte requise';
  if (!allowLegacy && (!address.city || !address.district)) {
    return 'Ville et quartier requis';
  }
  return null;
};

module.exports = {
  CAMEROON_CITIES,
  normalizeAddress,
  validateStructuredAddress,
};
