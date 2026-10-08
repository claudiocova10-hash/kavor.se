# Kavora – engångsinstallation

Kavora finns på `https://kavor.se/admin.html` när den nya webbversionen har publicerats. Hon återanvänder Kavors befintliga Supabase-inloggning och sparar aldrig Fortnox-hemligheter i webbläsaren.

## 1. Installera databasen

1. Öppna Supabase-projektet för Kavor.
2. Öppna **SQL Editor** och skapa en ny fråga.
3. Kopiera hela innehållet i `supabase/kavor-admin-schema.sql`.
4. Kör frågan.

Det skapar privata tabeller för företag, beställningar, uppgifter, dokument och licensleveranser. Det skapar också den privata dokumentbehållaren `kavor-business-documents`.

Kör därefter `supabase/kavora-customer-service.sql`. Den kompletterar Kavora med kundärenden, kostnader, ekonomiöversikt och integrationsstatus. Kundärenden rensas senast efter 12 månader via funktionen `cleanup_expired_support_data` när den schemalagts.

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

## Kundhjälp

Edge-funktionen finns i `supabase/functions/kavora-chat/index.ts` och publiceras som `kavora-chat` utan JWT-krav eftersom besökaren inte behöver konto. Funktionen har eget ursprungsskydd, validering och hastighetsbegränsning.

- Vanlig chatt lagras inte i Kavors databas.
- Ett kundärende skapas endast när besökaren fyller i namn/e-post och samtycker.
- Utan `OPENAI_API_KEY` svarar Kavora med en begränsad, säker FAQ.
- Med `OPENAI_API_KEY` använder funktionen OpenAI Responses API med `store: false`.
- API-nyckeln ska ligga i Supabase Edge Function Secrets, aldrig i webbplatsens filer.

## Kavora på mobilen

Öppna `https://kavor.se/admin.html` i Safari på iPhone, tryck **Dela** och välj **Lägg till på hemskärmen**. På Android visas knappen **Installera på mobilen** när webbläsaren stöder installation. Kavora behåller samma säkra Supabase-inloggning.

## Butiker och annonser

Integrationsvyn är förberedd för läsbehörighet:

- **App Store Connect:** API Key ID, Issuer ID och Apples privata `.p8`-nyckel lagras som serverhemligheter. Skapa en separat nyckel med minsta nödvändiga roll.
- **Google Play Console:** ett separat servicekonto med endast nödvändiga läsrättigheter. JSON-nyckeln lagras som serverhemlighet.
- **Meta Ads Manager:** separat åtkomst för statistik/insikter. Börja med läsrättighet.

Publicering, prisändring, kampanjändring eller budgetändring ska alltid kräva Claudios uttryckliga godkännande.

### App Store Connect

Kavora använder Edge-funktionen `kavora-apple` med rollen **Sales and Reports**. Funktionen verifierar att den inloggade användaren finns i `kavor_admins`, skapar ett kortlivat Apple-JWT på servern och gör endast läsande API-anrop. Apple-nyckeln ligger i Supabase Edge Function Secrets och får aldrig flyttas till `admin.js`, appen eller andra klientfiler.

## Säkerhet

- Alla affärstabeller har Row Level Security och är bara tillgängliga för UUID:n i `kavor_admins`.
- Dokumentbehållaren är privat. Öppningslänkar löper ut efter två minuter.
- Supabase `service_role` och framtida Fortnox-hemligheter får aldrig läggas i `www/`.
- Apple-, Google-, Meta- och OpenAI-nycklar får aldrig läggas i Git eller klientkod.
- En kommande Fortnox-koppling ska ligga i en Supabase Edge Function eller annan servermiljö.
