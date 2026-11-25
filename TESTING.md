# Testing checklist

Run `npm run check` to syntax-check every JS file. Then go through these workflows against a real Atlas database. Use two browsers (or a normal and a private window) so you can be a host and a volunteer at the same time.

## Setup
- [ ] `npm install`, fill `.env`, `npm run dev`. The console shows "Connected to MongoDB".
- [ ] `npm run create-admin -- --email admin@test.ph --name Admin`
- [ ] `GET /api/health` returns `database: connected`.

## Volunteer workflow
1. [ ] Register → validation errors show for a bad email, a short password, and mismatched passwords. A duplicate email gives a clear error.
2. [ ] Log in → lands on the dashboard. A wrong password says "Incorrect email or password".
3. [ ] Profile → add phone, skills, and a photo, then save. Refresh: the data persists.
4. [ ] Explore → search, category, location, free/paid, open-only, dates, list ↔ map, Near me.
5. [ ] Open an initiative → details, map, slots, and the payment card (if paid) are shown.
6. [ ] Register → success toast. The status is Pending or Approved depending on the host setting.
7. [ ] Notifications bell shows the registration notification.
8. [ ] History → Upcoming shows the registration.
9. [ ] Paid initiative → submit receipt + reference. Status becomes "Payment under review".
10. [ ] Cancel the registration → the slot is released and the record stays in History → All. Register again → a **new** record is created.

## Host workflow
1. [ ] Same regular account → Host → Create initiative.
2. [ ] Save draft with only a title → succeeds. Publish with missing fields → specific errors.
3. [ ] End before start → error. Latitude 200 → error. Capacity 0 → error.
4. [ ] Category "Medical Mission" with an unverified account → publish is blocked with a verification message.
5. [ ] Map: click to drop a pin, drag it, type coordinates manually.
6. [ ] AI assistant (with key) → suggestions appear. "Use this" fills the fields, and nothing is published automatically.
7. [ ] Publish → appears on Explore.
8. [ ] Manage → approve one applicant and decline another (with a reason). The volunteers get notifications.
9. [ ] Payments tab → view receipt, confirm one, reject one (a reason is required). The rejected volunteer can resubmit.
10. [ ] Edit the start time of a published initiative → registered volunteers get an "Important update" notification.
11. [ ] After the start time: Attendance tab → mark Attended/Absent, then correct one (asks for confirmation and records who and when).
12. [ ] Announcements → send. Volunteers see it on the initiative page and in notifications.
13. [ ] Cancel an initiative → volunteers are notified. Registrations show "cancelled" in history, and payments are unchanged.

## Administrator workflow
1. [ ] Log in as admin → redirected to `/admin.html`. A regular user opening `/admin.html` is redirected, and `/api/admin/stats` returns 403.
2. [ ] Volunteer submits verification (PRC number + photo) → it appears under Verifications.
3. [ ] Admin opens it, views the document, and approves → the user's badge appears on their profile and on initiatives they host. They can now publish a Medical Mission.
4. [ ] Reject another request with a reason → the user sees the reason and can resubmit.
5. [ ] Users → search, suspend with a reason. The suspended user is logged out and cannot log in. Reactivate.
6. [ ] Initiatives → moderation cancel. The host and volunteers are notified.
7. [ ] Organizations → verify and deactivate. Activity log shows the actions.

## Security and integrity checks
- [ ] Register twice quickly for the same initiative (double-click, or two tabs) → only one active registration.
- [ ] Fill the last slot from two accounts at once → one succeeds and one gets "now full".
- [ ] Reuse a payment reference number from another submission → 409 "already been submitted".
- [ ] As user B, call `PATCH /api/initiatives/<A's id>` → 403.
- [ ] As user B, open `/api/payments/<A's payment>/receipt` → 403.
- [ ] Upload a `.txt` renamed to `.png` → rejected ("content does not match").
- [ ] Send `{"email": {"$gt": ""}}` to login → 400 (operator stripped / validation).
- [ ] Wait for the JWT to expire (set `JWT_EXPIRES_IN=1m`) → the next action redirects to login with "session expired".

## Resilience
- [ ] **Gemini:** set an invalid `GEMINI_API_KEY` → the AI modal shows a friendly error and the form data is intact.
- [ ] **Email:** set an invalid `GMAIL_REFRESH_TOKEN` → registrations still succeed, in-app notifications appear, and the server logs "Gmail delivery failed" without the address.
- [ ] **Map tiles:** block `tile.openstreetmap.org` in DevTools → a notice appears and you can still create an initiative with a typed address.
- [ ] **Network:** DevTools → Offline while filling the create form → offline banner appears. Reload → the draft is restored. Submit after reconnecting → exactly one initiative is created.
- [ ] **Database:** stop network access to Atlas → API returns 503 "not saved", pages still load, and the server reconnects automatically.
