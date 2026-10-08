# Kavora – engångsinstallation

Kavora finns på `https://kavor.se/admin.html` när den nya webbversionen har publicerats. Hon återanvänder Kavors befintliga Supabase-inloggning och sparar aldrig Fortnox-hemligheter i webbläsaren.

## 1. Installera databasen

1. Öppna Supabase-projektet för Kavor.
2. Öppna **SQL Editor** och skapa en ny fråga.
3. Kopiera hela innehållet i `supabase/kavor-admin-schema.sql`.
4. Kör frågan.

Det skapar privata tabeller för företag, beställningar, uppgifter, dokument och licensleveranser. Det skapar också den privata dokumentbehållaren `kavor-business-documents`.

## 2. Lägg till ditt konto som administratör

1. Öppna `admin.html` och logga in med ditt vanliga Kavor-konto.
2. Kopiera det användar-id som visas.
3. Kör följande i Supabase SQL Editor, med rätt id:

```sql
insert into public.kavor_admins(user_id,display_name)
values ('DITT-ANVANDAR-ID','Claudio')
on conflict (user_id) do update set display_name=excluded.display_name;
```

4. Klicka **Kontrollera igen** på adminsidan.

## 3. Arbetssätt

1. Lägg in företaget.
2. Skapa beställningen med antal, 6 eller 12 månader och avtalat pris.
3. Öppna **Underlag**, kontrollera uppgifterna och skapa fakturan i Fortnox.
4. Skriv in Fortnox fakturanummer och ändra status till **Faktura skickad**.
5. När Fortnox visar betalningen, ändra status till **Betald**.
6. Skapa och leverera licenserna. Ändra sedan status till **Licenser levererade**.
7. Ladda upp avtal, fakturakopia och licenslista under rätt företag och kategori.

Fortnox är fortsatt den juridiska källan för fakturor och bokföring. Kavora är arbetsytan som håller ihop order, uppföljning, licenser och dokument.

## Säkerhet

- Alla affärstabeller har Row Level Security och är bara tillgängliga för UUID:n i `kavor_admins`.
- Dokumentbehållaren är privat. Öppningslänkar löper ut efter två minuter.
- Supabase `service_role` och framtida Fortnox-hemligheter får aldrig läggas i `www/`.
- En kommande Fortnox-koppling ska ligga i en Supabase Edge Function eller annan servermiljö.
