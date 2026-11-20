# Security Specification — Fahem Blan (فاهم بلان)

## 1. Data Invariants
1. **Strict Ownership**: Every document in `/users/{userId}`, `/plans/{planId}`, and `/voiceNotes/{noteId}` belongs strictly to the authenticated, email-verified user whose `request.auth.uid` equals `userId` or `resource.data.ownerId`.
2. **Identity Integrity**: On creation, `uid` / `ownerId` must equal `request.auth.uid`. On update, `ownerId` / `uid` and `createdAt` are immutable.
3. **Temporal Integrity**: `createdAt` and `updatedAt` must equal `request.time` (server timestamp).
4. **Volumetric Bounds**: All strings and arrays enforce explicit `.size()` upper bounds (e.g. `title <= 120`, `darijaSummary <= 5000`, `thumbnailDataUrl <= 250000`, `rooms.size() <= 40`, `materials.size() <= 40`, `workPhases.size() <= 20`).
5. **No Shadow Fields**: `keys().hasAll(...) && keys().hasOnly(...)` on create, and `diff().affectedKeys().hasOnly(...)` on update.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Plan Create**: `auth: null` writing to `/plans/plan_1`.
2. **Unverified Email Write**: `auth: { uid: "u1", token: { email_verified: false } }` creating `/plans/plan_1`.
3. **Owner Spoofing on Create**: `auth: u1` creating `/plans/plan_1` with `ownerId: "u2"`.
4. **Shadow Field Injection**: `auth: u1` creating `/plans/plan_1` with extra field `isAdmin: true`.
5. **ID Poisoning**: `auth: u1` creating `/plans/invalid$id*with!chars` or 200-char ID.
6. **Client Timestamp Forgery**: `auth: u1` creating `/plans/plan_1` with a hardcoded past `createdAt`.
7. **Cross-User Read**: `auth: u2` reading `/plans/plan_owned_by_u1`.
8. **Blanket List Scraping**: `auth: u2` listing `/plans` without `where("ownerId", "==", "u2")`.
9. **Owner Hijack on Update**: `auth: u1` updating `/plans/plan_1` trying to change `ownerId` to `"u2"`.
10. **Immutable `createdAt` Mutation**: `auth: u1` updating `/plans/plan_1` with a modified `createdAt`.
11. **Denial-of-Wallet Oversized Payload**: `auth: u1` creating `/plans/plan_1` with a 400KB `thumbnailDataUrl` (> 250KB cap) or 50 rooms.
12. **Cross-User UserProfile Access**: `auth: u2` reading or writing `/users/u1`.
