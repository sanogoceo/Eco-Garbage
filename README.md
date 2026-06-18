# EcoGarbage

On-demand waste collection platform adapted for Cameroon.

Main features:

* user, collector, and administration accounts;
* collector application and verification;
* smart assignment of collection missions;
* real-time GPS tracking and ETA;
* collection confirmation by OTP and photo evidence;
* internal notifications and Firebase Cloud Messaging;
* secure chat for each collection;
* recurring collections;
* collector wallet, commissions, and withdrawals;
* payments, ratings, and complaints.

Documentation:

* [Collector Application Architecture](docs/architecture-candidature-collecteur.md)
* [Advanced Collection Features](docs/fonctionnalites-collecte-avancees.md)
* [Sensitive Document Security](docs/securite-documents-sensibles.md)
* [MongoDB Backup and Restoration](docs/sauvegarde-restauration.md)
* [Fraud Detection](docs/detection-fraude.md)
* [Administrator Account Security](docs/securite-comptes-administrateurs.md)
* [Load and Performance Testing](docs/tests-charge-performance.md)

## Automated Tests

MongoDB must be running. The integration tests use and delete only the isolated database named `eco_garbage_e2e_test`.

```powershell
cd backend
npm test
```

To run only the complete workflow:

```powershell
npm run test:workflow
```

Another MongoDB instance can be specified with `MONGO_TEST_URI`, but its URI must target a database named `eco_garbage_e2e_test`.
