const crypto = require('crypto');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const BACKUP_FORMAT_VERSION = 1;
const ARCHIVE_SUFFIX = '.archive.enc';
const MANIFEST_SUFFIX = '.manifest.json';

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const resolveBackupDirectory = () => path.resolve(
  process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups')
);

const getEncryptionKey = () => {
  const secret = process.env.BACKUP_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error('BACKUP_ENCRYPTION_KEY doit contenir au moins 32 caracteres');
  }
  return crypto
    .createHash('sha256')
    .update(`EcoGarbage:mongodb-backup:${secret}`)
    .digest();
};

const getDatabaseName = (uri, override) => {
  if (override) return String(override).trim();
  const parsed = new URL(uri);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!databaseName) {
    throw new Error('La base MongoDB doit etre indiquee dans MONGO_URI ou MONGO_DATABASE');
  }
  return databaseName;
};

const commandPath = (name) => {
  const explicit = process.env[`${name.toUpperCase()}_PATH`];
  return explicit || name;
};

const runCommand = (command, args, { timeoutMs = 30 * 60_000 } = {}) => new Promise(
  (resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} a depasse le delai autorise`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        reject(new Error(
          `${command} est introuvable. Installez MongoDB Database Tools ou configurez ${name.toUpperCase()}_PATH.`
        ));
      } else {
        reject(error);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} a echoue (${code}): ${stderr.slice(-1500)}`));
      }
    });
  }
);

const collectCollectionCounts = async (uri, databaseName) => {
  const connection = await mongoose.createConnection(uri, {
    dbName: databaseName,
    serverSelectionTimeoutMS: 10_000,
  }).asPromise();
  try {
    const collections = await connection.db.listCollections(
      {},
      { nameOnly: true }
    ).toArray();
    const counts = {};
    for (const collection of collections) {
      if (collection.name.startsWith('system.')) continue;
      counts[collection.name] = await connection.db
        .collection(collection.name)
        .countDocuments({});
    }
    return counts;
  } finally {
    await connection.close();
  }
};

const encryptArchive = async (sourcePath, destinationPath) => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`EcoGarbage:mongodb-backup:v${BACKUP_FORMAT_VERSION}`));
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });

  await new Promise((resolve, reject) => {
    const input = fsSync.createReadStream(sourcePath);
    const output = fsSync.createWriteStream(destinationPath, {
      flags: 'wx',
      mode: 0o600,
    });
    const fail = (error) => {
      input.destroy();
      output.destroy();
      reject(error);
    };
    input.on('error', fail);
    cipher.on('error', fail);
    output.on('error', fail);
    output.on('finish', resolve);
    input.pipe(cipher).pipe(output);
  });
  return {
    iv: iv.toString('base64'),
    auth_tag: cipher.getAuthTag().toString('base64'),
  };
};

const decryptArchive = async (sourcePath, destinationPath, encryption) => {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(encryption.iv, 'base64')
  );
  decipher.setAAD(Buffer.from(`EcoGarbage:mongodb-backup:v${BACKUP_FORMAT_VERSION}`));
  decipher.setAuthTag(Buffer.from(encryption.auth_tag, 'base64'));
  await new Promise((resolve, reject) => {
    const input = fsSync.createReadStream(sourcePath);
    const output = fsSync.createWriteStream(destinationPath, {
      flags: 'wx',
      mode: 0o600,
    });
    const fail = (error) => {
      input.destroy();
      output.destroy();
      reject(error);
    };
    input.on('error', fail);
    decipher.on('error', fail);
    output.on('error', fail);
    output.on('finish', resolve);
    input.pipe(decipher).pipe(output);
  });
};

const hashFile = (filePath) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  const input = fsSync.createReadStream(filePath);
  input.on('error', reject);
  input.on('data', (chunk) => hash.update(chunk));
  input.on('end', () => resolve(hash.digest('hex')));
});

const canonicalManifest = (manifest) => JSON.stringify({
  format_version: manifest.format_version,
  backup_id: manifest.backup_id,
  created_at: manifest.created_at,
  source_database: manifest.source_database,
  archive_file: manifest.archive_file,
  archive_size: manifest.archive_size,
  archive_sha256: manifest.archive_sha256,
  encryption: manifest.encryption,
  collections: manifest.collections,
});

const signManifest = (manifest) => crypto
  .createHmac('sha256', getEncryptionKey())
  .update(canonicalManifest(manifest))
  .digest('hex');

const verifyManifest = (manifest) => {
  if (manifest.format_version !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Format de sauvegarde non supporte: ${manifest.format_version}`);
  }
  const expected = Buffer.from(signManifest(manifest), 'hex');
  const actual = Buffer.from(String(manifest.signature || ''), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('Signature du manifeste invalide');
  }
};

const writeJsonAtomic = async (filePath, value) => {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  await fs.rename(temporaryPath, filePath);
};

const listBackupManifests = async (backupDirectory = resolveBackupDirectory()) => {
  await fs.mkdir(backupDirectory, { recursive: true });
  const names = await fs.readdir(backupDirectory);
  const manifests = [];
  for (const name of names.filter((item) => item.endsWith(MANIFEST_SUFFIX))) {
    try {
      const manifestPath = path.join(backupDirectory, name);
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      manifests.push({ manifest, manifestPath });
    } catch {
      // Invalid manifests are preserved for manual inspection.
    }
  }
  return manifests.sort(
    (left, right) => new Date(right.manifest.created_at) - new Date(left.manifest.created_at)
  );
};

const applyRetention = async (backupDirectory = resolveBackupDirectory()) => {
  const retentionDays = positiveInteger(process.env.BACKUP_RETENTION_DAYS, 30);
  const retentionCount = positiveInteger(process.env.BACKUP_RETENTION_COUNT, 14);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const manifests = await listBackupManifests(backupDirectory);
  const deleted = [];
  for (const [index, item] of manifests.entries()) {
    const expiredByAge = new Date(item.manifest.created_at).getTime() < cutoff;
    const expiredByCount = index >= retentionCount;
    if (!expiredByAge && !expiredByCount) continue;
    const archivePath = path.join(
      backupDirectory,
      path.basename(item.manifest.archive_file)
    );
    await Promise.all([
      fs.unlink(archivePath).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      }),
      fs.unlink(item.manifestPath),
    ]);
    deleted.push(item.manifest.backup_id);
  }
  return deleted;
};

const acquireLock = async (backupDirectory) => {
  const lockPath = path.join(backupDirectory, '.backup.lock');
  try {
    const handle = await fs.open(lockPath, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({
      pid: process.pid,
      created_at: new Date().toISOString(),
    }));
    return async () => {
      await handle.close().catch(() => {});
      await fs.unlink(lockPath).catch(() => {});
    };
  } catch (error) {
    if (error.code === 'EEXIST') {
      const stat = await fs.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 6 * 60 * 60 * 1000) {
        await fs.unlink(lockPath);
        return acquireLock(backupDirectory);
      }
      throw new Error('Une sauvegarde MongoDB est deja en cours');
    }
    throw error;
  }
};

const createBackup = async ({
  uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/eco_garbage_db',
  databaseName = process.env.MONGO_DATABASE,
  backupDirectory = resolveBackupDirectory(),
} = {}) => {
  await fs.mkdir(backupDirectory, { recursive: true });
  const releaseLock = await acquireLock(backupDirectory);
  const sourceDatabase = getDatabaseName(uri, databaseName);
  const backupId = `eco-${sourceDatabase}-${new Date().toISOString()
    .replace(/[:.]/g, '-')}`;
  const temporaryArchive = path.join(backupDirectory, `${backupId}.archive.tmp`);
  const archiveFile = `${backupId}${ARCHIVE_SUFFIX}`;
  const archivePath = path.join(backupDirectory, archiveFile);
  const manifestPath = path.join(
    backupDirectory,
    `${backupId}${MANIFEST_SUFFIX}`
  );

  try {
    const collections = await collectCollectionCounts(uri, sourceDatabase);
    await runCommand(commandPath('mongodump'), [
      `--uri=${uri}`,
      `--db=${sourceDatabase}`,
      `--archive=${temporaryArchive}`,
      '--gzip',
    ]);
    const encryption = await encryptArchive(temporaryArchive, archivePath);
    const [archiveSha256, archiveStat] = await Promise.all([
      hashFile(archivePath),
      fs.stat(archivePath),
    ]);
    const manifest = {
      format_version: BACKUP_FORMAT_VERSION,
      backup_id: backupId,
      created_at: new Date().toISOString(),
      source_database: sourceDatabase,
      archive_file: archiveFile,
      archive_size: archiveStat.size,
      archive_sha256: archiveSha256,
      encryption: {
        algorithm: 'aes-256-gcm',
        ...encryption,
      },
      collections,
    };
    manifest.signature = signManifest(manifest);
    await writeJsonAtomic(manifestPath, manifest);
    const deleted = await applyRetention(backupDirectory);
    return {
      manifest,
      manifestPath,
      archivePath,
      retention_deleted: deleted,
    };
  } catch (error) {
    await Promise.all([
      fs.unlink(archivePath).catch(() => {}),
      fs.unlink(manifestPath).catch(() => {}),
    ]);
    throw error;
  } finally {
    await fs.unlink(temporaryArchive).catch(() => {});
    await releaseLock();
  }
};

const loadBackup = async (manifestPath) => {
  const resolvedManifestPath = path.resolve(manifestPath);
  const manifest = JSON.parse(await fs.readFile(resolvedManifestPath, 'utf8'));
  verifyManifest(manifest);
  const archivePath = path.resolve(
    path.dirname(resolvedManifestPath),
    path.basename(manifest.archive_file)
  );
  const [actualHash, archiveStat] = await Promise.all([
    hashFile(archivePath),
    fs.stat(archivePath),
  ]);
  if (actualHash !== manifest.archive_sha256) {
    throw new Error('Le hash SHA-256 de l archive ne correspond pas au manifeste');
  }
  if (archiveStat.size !== manifest.archive_size) {
    throw new Error('La taille de l archive ne correspond pas au manifeste');
  }
  return { archivePath, manifest, manifestPath: resolvedManifestPath };
};

const verifyRestoredCounts = async (uri, databaseName, expectedCounts) => {
  const actualCounts = await collectCollectionCounts(uri, databaseName);
  const mismatches = [];
  for (const [collection, expected] of Object.entries(expectedCounts || {})) {
    const actual = actualCounts[collection] || 0;
    if (actual !== expected) {
      mismatches.push({ collection, expected, actual });
    }
  }
  if (mismatches.length) {
    throw new Error(`Verification de restauration echouee: ${JSON.stringify(mismatches)}`);
  }
  return actualCounts;
};

const restoreBackup = async ({
  manifestPath,
  uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/eco_garbage_db',
  targetDatabase,
  allowProductionRestore = false,
} = {}) => {
  if (!manifestPath) throw new Error('Le chemin du manifeste est obligatoire');
  const loaded = await loadBackup(manifestPath);
  const target = String(
    targetDatabase || `${loaded.manifest.source_database}_restore_test`
  ).trim();
  if (!target) throw new Error('La base de restauration est obligatoire');
  const overwritesSource = target === loaded.manifest.source_database;
  if (
    overwritesSource
    && !allowProductionRestore
    && process.env.ALLOW_PRODUCTION_RESTORE !== 'true'
  ) {
    throw new Error(
      'Restauration refusee sur la base source. Utilisez une base *_restore_test.'
    );
  }
  if (!overwritesSource && !/_restore_test$/i.test(target)) {
    throw new Error(
      'Par securite, la base cible doit se terminer par _restore_test.'
    );
  }

  const temporaryArchive = path.join(
    path.dirname(loaded.manifestPath),
    `${loaded.manifest.backup_id}.${crypto.randomUUID()}.restore.tmp`
  );
  try {
    await decryptArchive(
      loaded.archivePath,
      temporaryArchive,
      loaded.manifest.encryption
    );
    await runCommand(commandPath('mongorestore'), [
      `--uri=${uri}`,
      `--archive=${temporaryArchive}`,
      '--gzip',
      '--drop',
      `--nsFrom=${loaded.manifest.source_database}.*`,
      `--nsTo=${target}.*`,
    ]);
    const collections = await verifyRestoredCounts(
      uri,
      target,
      loaded.manifest.collections
    );
    return {
      source_database: loaded.manifest.source_database,
      target_database: target,
      collections,
      verified: true,
    };
  } finally {
    await fs.unlink(temporaryArchive).catch(() => {});
  }
};

let schedulerTimer;

const startBackupScheduler = () => {
  if (
    process.env.NODE_ENV === 'test'
    || process.env.BACKUP_ENABLED !== 'true'
    || schedulerTimer
  ) return;
  const hourUtc = Math.min(
    23,
    Math.max(0, Number.parseInt(process.env.BACKUP_DAILY_HOUR_UTC, 10) || 2)
  );
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(hourUtc, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    schedulerTimer = setTimeout(async () => {
      try {
        const result = await createBackup();
        console.log(`Sauvegarde MongoDB creee: ${result.manifest.backup_id}`);
      } catch (error) {
        console.error('Sauvegarde MongoDB echouee:', error.message);
      } finally {
        schedulerTimer = null;
        scheduleNext();
      }
    }, next.getTime() - now.getTime());
    schedulerTimer.unref();
  };
  scheduleNext();
};

module.exports = {
  applyRetention,
  createBackup,
  getDatabaseName,
  listBackupManifests,
  loadBackup,
  restoreBackup,
  startBackupScheduler,
  verifyManifest,
  _internals: {
    canonicalManifest,
    decryptArchive,
    encryptArchive,
    hashFile,
    signManifest,
  },
};
