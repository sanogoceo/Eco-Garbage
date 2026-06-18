@echo off
title Eco-Garbage - Démarrage

echo [1/3] Démarrage du service MongoDB...
net start MongoDB 2>nul
if %errorlevel% neq 0 (
  echo     MongoDB déjà actif ou nécessite des droits admin.
  echo     Si la connexion échoue, lancez ce fichier en tant qu'Administrateur.
)

echo [2/3] Démarrage du backend (port 5000)...
start "Eco-Garbage Backend" cmd /k "cd /d %~dp0backend && npm run dev"

echo [3/3] Démarrage du frontend (port 5173)...
start "Eco-Garbage Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ✓ Services lancés.
echo   Backend  : http://localhost:5000
echo   Frontend : http://localhost:5173
echo.
echo Fermez les fenêtres "Backend" et "Frontend" pour arrêter l'application.
pause
