# EcoGarbage

Plateforme de collecte de dechets a la demande adaptee au Cameroun.

Fonctionnalites principales :

- comptes utilisateur, collecteur et administration ;
- candidature et verification des collecteurs ;
- attribution intelligente des missions ;
- suivi GPS et ETA en temps reel ;
- confirmation de collecte par OTP et preuves photo ;
- notifications internes et Firebase Cloud Messaging ;
- chat securise par collecte ;
- collectes recurrentes ;
- portefeuille, commissions et retraits collecteur ;
- paiements, evaluations et reclamations.

Documentation :

- [Architecture des candidatures collecteur](docs/architecture-candidature-collecteur.md)
- [Fonctionnalites avancees de collecte](docs/fonctionnalites-collecte-avancees.md)
- [Securite des documents sensibles](docs/securite-documents-sensibles.md)
- [Sauvegarde et restauration MongoDB](docs/sauvegarde-restauration.md)
- [Detection de fraude](docs/detection-fraude.md)
- [Securite des comptes administrateurs](docs/securite-comptes-administrateurs.md)
- [Tests de charge et performance](docs/tests-charge-performance.md)

## Tests automatiques

MongoDB doit etre demarre. Les tests d'integration utilisent et suppriment uniquement
la base isolee `eco_garbage_e2e_test`.

```powershell
cd backend
npm test
```

Pour executer uniquement le parcours complet :

```powershell
npm run test:workflow
```

Une autre instance MongoDB peut etre indiquee avec `MONGO_TEST_URI`, mais son URI
doit cibler une base nommee `eco_garbage_e2e_test`.
