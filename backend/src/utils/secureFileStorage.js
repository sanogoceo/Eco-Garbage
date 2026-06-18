const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const MAGIC = Buffer.from('ECOENC01', 'ascii');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ENCRYPTION_VERSION = 1;

const deriveKey = (secret, context) => crypto
  .createHash('sha256')
  .update(`${secret}:file:${context}`)
  .digest();

const getAad = (context) => Buffer.from(`EcoGarbage:${context}:v${ENCRYPTION_VERSION}`);

const getEncryptionSecret = () => (
  process.env.DATA_ENCRYPTION_KEY || process.env.JWT_SECRET
);

const getDecryptionSecrets = () => Array.from(new Set([
  process.env.DATA_ENCRYPTION_KEY,
  ...String(process.env.DATA_ENCRYPTION_KEY_PREVIOUS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  process.env.JWT_SECRET,
].filter(Boolean)));

const isEncryptedBuffer = (buffer) => (
  Buffer.isBuffer(buffer)
  && buffer.length >= MAGIC.length + IV_LENGTH + TAG_LENGTH
  && buffer.subarray(0, MAGIC.length).equals(MAGIC)
);

const encryptBuffer = (buffer, context) => {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('A Buffer is required');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    deriveKey(getEncryptionSecret(), context),
    iv
  );
  cipher.setAAD(getAad(context));
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, ciphertext]);
};

const decryptBuffer = (payload, context) => {
  if (!isEncryptedBuffer(payload)) return payload;
  const ivStart = MAGIC.length;
  const tagStart = ivStart + IV_LENGTH;
  const ciphertextStart = tagStart + TAG_LENGTH;
  let lastError;
  for (const secret of getDecryptionSecrets()) {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        deriveKey(secret, context),
        payload.subarray(ivStart, tagStart)
      );
      decipher.setAAD(getAad(context));
      decipher.setAuthTag(payload.subarray(tagStart, ciphertextStart));
      return Buffer.concat([
        decipher.update(payload.subarray(ciphertextStart)),
        decipher.final(),
      ]);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('No data encryption key configured');
};

const resolveStoredPath = (directory, storedName) => {
  const root = path.resolve(directory);
  const filePath = path.resolve(root, String(storedName || ''));
  if (!storedName || !filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid secure storage path');
  }
  return filePath;
};

const atomicWrite = async (filePath, buffer) => {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, buffer, { flag: 'wx', mode: 0o600 });
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
};

// ── Cloudinary backend (activated when CLOUDINARY_URL is set) ─────────────────

const isCloudinaryEnabled = () => Boolean(process.env.CLOUDINARY_URL);

const getCld = () => require('cloudinary').v2;

const cldFolder = (directory) => {
  const name = String(directory).replace(/\\/g, '/').split('/').filter(Boolean).pop();
  return `eco-garbage/${name}`;
};

const cldUpload = (buffer, publicId) => new Promise((resolve, reject) => {
  const stream = getCld().uploader.upload_stream(
    { public_id: publicId, resource_type: 'raw', overwrite: false },
    (err, result) => (err ? reject(err) : resolve(result.public_id))
  );
  stream.end(buffer);
});

const cldDownload = (publicId) => new Promise((resolve, reject) => {
  const url = getCld().url(publicId, { resource_type: 'raw' });
  const mod = url.startsWith('https') ? require('https') : require('http');
  mod.get(url, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      return reject(new Error(`Cloudinary download failed: HTTP ${res.statusCode}`));
    }
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  }).on('error', reject);
});

const cldDelete = (publicId) => getCld().uploader.destroy(publicId, { resource_type: 'raw' });

// ── Exported storage functions ────────────────────────────────────────────────

// Returns the effective stored_name to persist in the database:
//   - local disk  → the original storedName (e.g. "abc.enc")
//   - Cloudinary  → "cld:<public_id>"
const writeEncryptedFile = async ({
  directory,
  storedName,
  buffer,
  context,
}) => {
  const encrypted = encryptBuffer(buffer, context);
  if (isCloudinaryEnabled()) {
    const publicId = `${cldFolder(directory)}/${storedName.replace(/\.enc$/, '')}`;
    await cldUpload(encrypted, publicId);
    return `cld:${publicId}`;
  }
  await fs.mkdir(directory, { recursive: true });
  const filePath = resolveStoredPath(directory, storedName);
  await fs.writeFile(filePath, encrypted, { flag: 'wx', mode: 0o600 });
  return storedName;
};

const readEncryptedFile = async ({
  directory,
  storedName,
  context,
  migrateLegacy = true,
}) => {
  if (storedName?.startsWith('cld:')) {
    const payload = await cldDownload(storedName.slice(4));
    return { buffer: decryptBuffer(payload, context), migrated: false };
  }
  const filePath = resolveStoredPath(directory, storedName);
  const payload = await fs.readFile(filePath);
  if (isEncryptedBuffer(payload)) {
    return { buffer: decryptBuffer(payload, context), migrated: false };
  }
  if (migrateLegacy) {
    await atomicWrite(filePath, encryptBuffer(payload, context));
  }
  return { buffer: payload, migrated: migrateLegacy };
};

const encryptExistingFile = async ({
  directory,
  storedName,
  context,
}) => {
  const filePath = resolveStoredPath(directory, storedName);
  const payload = await fs.readFile(filePath);
  if (isEncryptedBuffer(payload)) return false;
  await atomicWrite(filePath, encryptBuffer(payload, context));
  return true;
};

const deleteStoredFile = async ({ directory, storedName }) => {
  if (storedName?.startsWith('cld:')) {
    await cldDelete(storedName.slice(4)).catch(() => {});
    return;
  }
  const filePath = resolveStoredPath(directory, String(storedName || ''));
  await fs.unlink(filePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
};

module.exports = {
  ENCRYPTION_VERSION,
  deleteStoredFile,
  decryptBuffer,
  encryptBuffer,
  encryptExistingFile,
  isEncryptedBuffer,
  readEncryptedFile,
  resolveStoredPath,
  writeEncryptedFile,
};
