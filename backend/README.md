# Kavor-konto och företagslicenser

Den publika webbplatsen använder Supabase Auth och Postgres. Koder löses in på `https://kavor.se/activate.html`; appen läser därefter användarens aktiva behörighet efter inloggning.

## Installation

1. Skapa ett Supabase-projekt i en EU-region.
2. Kör `supabase/schema.sql` i projektets SQL Editor.
3. Lägg `Project URL` och projektets **publishable key** i webbplatsens `account-config.js` och appens `www/js/kavor-account-config.js`. Den nyckeln är avsedd för publika klienter; säkerheten upprätthålls av RLS.
4. Lägg till `https://kavor.se/activate.html` och `https://kavor.se/account.html` som tillåtna redirect-URL:er under Authentication > URL Configuration.
5. Aktivera e-postbekräftelse och konfigurera egen SMTP innan skarp lansering.
6. Publicera inte sidorna och skicka inte en appuppdatering förrän registrering, återställning, kodinlösen och appinloggning har testats.

## Skapa en kodbatch

Administrationsnyckeln får aldrig sparas i Git, webbplatsen eller appen.

```sh
cd backend
npm install
SUPABASE_URL="https://PROJECT.supabase.co" \
SUPABASE_SECRET_KEY="sb_secret_..." \
npm run generate-codes -- \
  --company "Exempel Husbilar AB" \
  --quantity 100 \
  --days 365 \
  --activate-by 2027-12-31
```

CSV-filen i `backend/generated/` är den enda klartextkopian av koderna. Databasen lagrar endast SHA-256-hashar och de fyra sista tecknen för supportidentifiering.

## Säkerhetsmodell

- Endast inloggade användare kan lösa in en kod.
- En kod kan bara användas en gång.
- Högst tio misslyckade försök tillåts per konto under 15 minuter.
- Användaren kan endast läsa sin egen profil och sin egen behörighet.
- Batchar och kodhashar är inte läsbara med den publika nyckeln.
- Supabase secret key används endast lokalt av administrationsskriptet.
