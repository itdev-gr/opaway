# Scripts

## migrate-user-type

Adds the `type` field to existing user documents in Firestore (default `"user"`).

**When to run:** Once, to backfill existing users who don’t have `type` yet. New users and users who log in again get `type: 'user'` via the app.

**Steps:**

1. Install dev deps: `npm install`
2. In Firebase Console: Project settings → Service accounts → Generate new private key. Save the JSON (e.g. `serviceAccountKey.json`). **Do not commit this file.**
3. Run:
   ```bash
   npm run migrate:user-type -- path/to/serviceAccountKey.json
   ```
   Or set `GOOGLE_APPLICATION_CREDENTIALS` and run:
   ```bash
   npm run migrate:user-type
   ```

The script updates only documents that don’t already have a `type` field.
