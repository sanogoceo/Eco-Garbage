const crypto = require('crypto');

const getKey = () => crypto
  .createHash('sha256')
  .update(process.env.DATA_ENCRYPTION_KEY || process.env.JWT_SECRET)
  .digest();

const encrypt = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
};

const decrypt = (value) => {
  if (!value?.startsWith('v1:')) return value;
  const [, ivValue, tagValue, encryptedValue] = value.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(ivValue, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};

const fingerprint = (value) => crypto
  .createHmac('sha256', getKey())
  .update(value)
  .digest('hex');

module.exports = { encrypt, decrypt, fingerprint };
