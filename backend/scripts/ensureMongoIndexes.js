require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');

const modelsDir = path.join(__dirname, '..', 'src', 'models');
fs.readdirSync(modelsDir)
  .filter((file) => file.endsWith('.js'))
  .forEach((file) => require(path.join(modelsDir, file)));

const checkOnly = process.argv.includes('--check');

const findDuplicates = (model, fields, options) => {
  const paths = Object.keys(fields);
  const key = Object.fromEntries(
    paths.map((field, index) => [`k${index}`, { $ifNull: [`$${field}`, null] }])
  );
  const filter = options.partialFilterExpression
    || (options.sparse ? { $or: paths.map((field) => ({ [field]: { $exists: true } })) } : {});
  return model.collection.aggregate([
    { $match: filter },
    { $group: { _id: key, count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 },
    { $project: { _id: 0, count: 1, ids: { $slice: ['$ids', 5] } } },
  ]).toArray();
};

const run = async () => {
  await connectDB();
  console.log(`Database: ${mongoose.connection.name} on ${mongoose.connection.host}`);

  const indexes = mongoose.modelNames().flatMap((name) => {
    const model = mongoose.model(name);
    return model.schema.indexes().map(([fields, options]) => ({ model, fields, options }));
  });

  let duplicateIndexes = 0;
  for (const { model, fields, options } of indexes) {
    if (!options.unique) continue;
    const groups = await findDuplicates(model, fields, options);
    if (!groups.length) continue;
    duplicateIndexes += 1;
    console.error(`DUPLICATES in ${model.modelName} on ${Object.keys(fields).join(', ')}:`);
    groups.forEach((group) => {
      console.error(`  ${group.count} documents, for example _id ${group.ids.join(', ')}`);
    });
  }
  if (duplicateIndexes) {
    console.error(`Stopped: ${duplicateIndexes} unique index(es) have duplicates. No index was built and nothing was deleted.`);
    process.exitCode = 1;
    return;
  }
  console.log(`No duplicates found across ${indexes.filter((item) => item.options.unique).length} unique indexes.`);
  if (checkOnly) return;

  let failures = 0;
  for (const { model, fields, options } of indexes) {
    try {
      await model.collection.createIndex(fields, options);
    } catch (error) {
      failures += 1;
      console.error(`FAILED ${model.modelName} ${JSON.stringify(fields)}: ${error.message}`);
    }
  }
  console.log(`Indexes in place: ${indexes.length - failures}/${indexes.length}.`);
  if (failures) process.exitCode = 1;
};

run()
  .catch((error) => {
    console.error(`Index maintenance failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
