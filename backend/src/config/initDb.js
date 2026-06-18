const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('../models/User');
const WasteCategory = require('../models/WasteCategory');

async function initDatabase() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/eco_garbage_db');
  console.log('Connexion MongoDB etablie...');

  const categories = [
    { name: 'Dechets menagers', description: 'Ordures menageres classiques', icon: 'trash', base_price: 500, is_hazardous: false, is_recyclable: false },
    { name: 'Dechets organiques', description: 'Restes alimentaires, dechets de jardin', icon: 'leaf', base_price: 600, is_hazardous: false, is_recyclable: true },
    { name: 'Plastiques', description: 'Bouteilles, emballages plastiques', icon: 'bottle', base_price: 750, is_hazardous: false, is_recyclable: true },
    { name: 'Papier & Carton', description: 'Journaux, cartons, papiers', icon: 'newspaper', base_price: 500, is_hazardous: false, is_recyclable: true },
    { name: 'Verre', description: 'Bouteilles et objets en verre', icon: 'glass', base_price: 800, is_hazardous: false, is_recyclable: true },
    { name: 'Metaux', description: 'Ferraille, canettes, aluminium', icon: 'wrench', base_price: 1000, is_hazardous: false, is_recyclable: true },
    { name: 'Dechets electroniques', description: 'Telephones, PC, electromenager', icon: 'laptop', base_price: 2000, is_hazardous: false, is_recyclable: false },
    { name: 'Dechets dangereux', description: 'Piles, produits chimiques, medicaments', icon: 'warning', base_price: 3000, is_hazardous: true, is_recyclable: false },
    { name: 'Encombrants', description: 'Meubles, gros appareils', icon: 'couch', base_price: 3500, is_hazardous: false, is_recyclable: false },
  ];

  for (const cat of categories) {
    await WasteCategory.findOneAndUpdate({ name: cat.name }, cat, { upsert: true, new: true });
  }
  console.log('Categories initialisees (' + categories.length + ')');

  const defaultHash = await bcrypt.hash('Admin1234!', 10);
  await User.findOneAndUpdate(
    { email: 'admin@eco-garbage.com' },
    {
      uuid: '00000000-0000-0000-0000-000000000001',
      name: 'Administrateur',
      email: 'admin@eco-garbage.com',
      phone: '+237600000000',
      password_hash: defaultHash,
      role: 'admin',
      is_verified: true,
      is_active: true,
    },
    { upsert: true, new: true }
  );

  await User.findOneAndUpdate(
    { email: 'user@eco-garbage.com' },
    {
      uuid: '00000000-0000-0000-0000-000000000002',
      name: 'Jean Kamga',
      email: 'user@eco-garbage.com',
      phone: '+237691234567',
      password_hash: defaultHash,
      role: 'user',
      is_verified: true,
      is_active: true,
    },
    { upsert: true, new: true }
  );

  const collectorUser = await User.findOneAndUpdate(
    { email: 'collector@eco-garbage.com' },
    {
      uuid: '00000000-0000-0000-0000-000000000003',
      name: 'Paul Mbarga',
      email: 'collector@eco-garbage.com',
      phone: '+237670987654',
      password_hash: defaultHash,
      role: 'collector',
      is_verified: true,
      is_active: true,
      avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Paul-Mbarga-Collector',
      collector_profile: {
        is_available: true,
        rating_avg: 4.5,
        total_collections: 0,
        national_id_number: 'DEMO12345678',
        verification_status: 'verified',
        vehicle_type: 'motorcycle',
        service_area: 'Douala',
        service_zones: ['Douala'],
        location: { type: 'Point', coordinates: [9.7679, 4.0511] },
        last_location_update: new Date(),
      },
    },
    { upsert: true, new: true }
  );
  console.log('Collector avatar_url saved:', collectorUser.avatar_url);

  console.log('Base de donnees MongoDB initialisee avec succes !');
  console.log('Admin     : admin@eco-garbage.com / Admin1234!');
  console.log('User      : user@eco-garbage.com / Admin1234!');
  console.log('Collector : collector@eco-garbage.com / Admin1234!');
  await mongoose.connection.close();
}

initDatabase().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
