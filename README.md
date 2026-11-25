# GoodNeighbor Health

**Team Nexus4 · Healthcare · InnovateHack+ 2.0**
*Break the timeline. Build for the future.*

GoodNeighbor Health is a healthcare volunteer coordination platform for Northern Mindanao. Hosts publish medical missions, blood drives, health campaigns, and seminars. Volunteers discover them, register, pay (if needed), and build a participation history.

> GoodNeighbor Health is **not** a medical advice or diagnosis app. It coordinates volunteers.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, vanilla JavaScript (ES modules), no framework |
| Maps | Leaflet.js 1.9.4 (library) + OpenStreetMap (tiles) |
| Backend | Node.js 18.17+, Express 4, REST |
| Database | MongoDB Atlas + Mongoose 8 (files stored in GridFS) |
| Auth | JWT + bcryptjs, role- and ownership-based authorization |
| AI | Gemini Flash via REST (planning assistant + optional receipt pre-check) |
| Email | Gmail API via OAuth2 refresh token (REST, no SDK) |

Gemini and Gmail are called with Node's built-in `fetch`, so there are no Google SDK dependencies.

---

## Quick start

```bash
npm install
cp .env.example .env        # then fill in MONGODB_URI and JWT_SECRET (required)
npm run create-admin -- --email admin@example.com --name "Platform Admin"
npm run dev                 # or: npm start
```

Open http://localhost:3000.

**Required:** `MONGODB_URI` and `JWT_SECRET`.
**Optional:** Gemini and Gmail. Without them the app still works fully: the AI button explains it is unavailable, and notifications stay in-app.

### MongoDB Atlas
1. Create a free cluster, a database user, and allow your IP (or `0.0.0.0/0` for hosted deploys).
2. Copy the connection string into `MONGODB_URI` and put the database name before the `?`, e.g. `/goodneighbor?`.
3. Indexes (including the partial unique indexes that block duplicate registrations and duplicate payment references) are created automatically on startup.

### Gemini (optional)
1. Get a key at https://aistudio.google.com/apikey and set `GEMINI_API_KEY`.
2. `GEMINI_MODEL` defaults to `gemini-2.5-flash`. Change it to whichever Flash model is current in your account.
3. Set `GEMINI_RECEIPT_ANALYSIS=true` to let Gemini pre-read payment receipts. Its output is **advisory flags only**. Hosts always confirm payments manually.

### Gmail API (optional)
1. In Google Cloud Console: enable the **Gmail API**, configure the OAuth consent screen (add the sending Gmail as a test user), and create an **OAuth client ID** (Desktop app, or Web app with redirect URI `http://localhost:5577/oauth2callback`).
2. Put `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_SENDER` in `.env`.
3. Run `npm run gmail-auth`, open the printed URL, approve, and paste the printed `GMAIL_REFRESH_TOKEN` into `.env`.

> If the consent screen stays in "Testing" mode, Google expires refresh tokens after 7 days. Publish the app (scope `gmail.send`) for long-lived tokens.

---

## Project structure

```
server/
  server.js            entry: starts HTTP, connects DB with retry
  app.js               Express app, security headers, CSP, routes, static files
  config/              env, db, constants (categories, hosting rules, statuses)
  middleware/          auth (JWT, admin), common (rate limits, sanitizing, errors), upload (multer + magic-byte checks)
  models/              User, Initiative, Registration, Payment, MedicalVerification, Notification, Organization, ActivityLog
  routes/              auth, users, initiatives, registrations, payments, verifications, notifications, organizations, admin, ai, files, meta
  services/            gemini, gmail, notify, activity, access, initiativeRules, registrationFlow
  utils/               http helpers, validation, GridFS, serializers
  scripts/             create-admin, gmail-auth, check-syntax
public/
  *.html               one page per screen
  css/styles.css       the single design system
  js/api.js            fetch client, session, file helpers
  js/ui.js             icons, formatting, toasts, modals, forms, cards
  js/layout.js         header/footer, auth guards, offline banner, notification badge
  js/map.js            Leaflet helpers with tile-failure handling
  js/pages/*.js        page logic
```

### Pages

| Page | Purpose |
|---|---|
| `/` | Landing page |
| `/register.html`, `/login.html` | Auth |
| `/dashboard.html` | Volunteer overview |
| `/explore.html` | Search, filters, list/map, "Near me" |
| `/initiative.html?id=` | Details, register, payment submission |
| `/initiative-form.html[?id=]` | Create/edit with map picker and AI assistant |
| `/host.html` | Host dashboard |
| `/manage.html?id=` | Participants, payments, attendance roster, announcements |
| `/profile.html` | Profile, professional verification, password |
| `/user.html?id=` | Public profile |
| `/history.html` | Participation history |
| `/notifications.html` | In-app notifications |
| `/organizations.html`, `/organization.html?id=` | Optional organizations |
| `/admin.html` | Admin dashboard (admins only) |

---

## Key business rules and where they live

| Rule | Implementation |
|---|---|
| One account volunteers **and** hosts; no host sign-up | `User.role` is `user` or `admin` only. Hosting is ownership of an `Initiative`. |
| Admins are separate | Created only through `npm run create-admin`. Every `/api/admin/*` route checks the role read from the DB. |
| Hosts manage only their own initiatives | `services/access.js → loadManageableInitiative` |
| Medical missions need a verified licensed professional; seminars need a verified professional or student | `config/constants.js → HOSTING_RULES`, enforced on publish and edit |
| No over-capacity registrations | Atomic `findOneAndUpdate` with `$expr: slotsTaken < capacity` (`registrationFlow.reserveSlot`) |
| No duplicate active registration; re-registering creates a new record | Partial unique index `{user, initiative}` where `isActive: true` |
| Valid status transitions only | `REGISTRATION_TRANSITIONS` + compare-and-set update in `registrationFlow.transition` |
| No duplicate payment references | Normalised `referenceKey` + partial unique index `{provider, referenceKey}` while pending/confirmed |
| Payments are confirmed by hosts only | AI never changes payment status; `POST /api/payments/:id/confirm` is host/admin only |
| Receipts and PRC documents are private | GridFS `privateFiles` bucket, streamed only through authorized routes. PRC numbers use `select: false`. |
| Soft deletion and history | Drafts are soft-deleted. Cancelling an initiative marks registrations cancelled (with history) and leaves payments untouched. |
| Attendance after start only, with corrections | `POST /api/registrations/:id/attendance` records `markedBy`/`markedAt` and history |
| Important edits notify participants | Schedule/location changes on published initiatives trigger notifications |

## Resilience

- **DB down:** the server still starts and serves pages. API calls return 503 with "your request was not saved", and the server keeps retrying the connection.
- **Gemini down:** returns 503 with a friendly message. The form stays filled (and is also saved in localStorage).
- **Gmail down:** the in-app notification is always created first. Email is sent in the background and failures are logged without content.
- **Map tiles down / Leaflet blocked:** a notice appears on the map. Address fields and manual lat/lng entry keep working.
- **Unstable internet:** offline banner, form drafts kept in localStorage, initiative creation uses an `Idempotency-Key` so retries don't create duplicates, and buttons disable while a request is in flight.

## Security notes

Helmet with CSP, CORS allow-list, rate limits (auth, writes, uploads, AI), `$`/`.` key stripping, file type checks by magic bytes, 5–8 MB upload limits, no request-body logging, and the same error message for wrong email and wrong password. Changing your password or being suspended invalidates existing JWTs (`tokenVersion`).

The JWT is stored in `localStorage` for simplicity. For production, consider httpOnly cookies + CSRF protection.

See **TESTING.md** for the end-to-end test checklist.
