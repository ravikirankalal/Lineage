# Firebase setup (sign-in, sync and sharing)

Lineage works fully offline without any of this. Do these steps once to turn on Google sign-in,
sync across devices and family sharing. Everything here fits the free **Spark** plan.

What is secret and what is not:
- The **web config** (apiKey, authDomain, projectId, appId…) is public by design. It ships inside
  the web page. It goes into GitHub **variables**, not secrets.
- The **service-account JSON key** is a real secret. It goes only into the GitHub **secret**
  `FIREBASE_SERVICE_ACCOUNT`. Never commit it, email it or paste it anywhere else.
- Who can read what is decided by `firestore.rules` on Google's servers, not by the app.

---

## 1. Create the Firebase project
1. Open <https://console.firebase.google.com> and sign in with your Google account.
2. Click **Create a project** (or **Add project**).
3. Name it, e.g. `lineage-family`. Note the **project ID** shown under the name (e.g.
   `lineage-family-1a2b3`); you need it later.
4. Google Analytics: switch it **off** (Lineage doesn't use it). Click **Create project**, then **Continue**.

## 2. Turn on Google sign-in
1. Left menu: **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Google** → switch **Enable** on.
3. Pick a **Project support email** (your email) → **Save**.

## 3. Create the Firestore database
1. Left menu: **Build → Firestore Database → Create database**.
2. Edition/ID: keep the defaults (Standard edition, database ID `(default)`).
3. **Location**: choose **asia-south1 (Mumbai)** (or `asia-south2`, Delhi). This can't be changed later.
4. Choose **Start in production mode** → **Create**. (Production mode denies everything until
   our rules are deployed in step 8. That's what we want.)

## 4. Register the web app and copy its config
1. Click the gear icon next to **Project Overview** → **Project settings**.
2. Under **Your apps**, click the **Web** icon (`</>`).
3. App nickname: `Lineage web`. Tick **Also set up Firebase Hosting** if offered (harmless), then
   **Register app**.
4. You'll see a `firebaseConfig = { ... }` block. Keep this tab open. You need these values:

   | firebaseConfig field | Variable name |
   | --- | --- |
   | `apiKey` | `VITE_FIREBASE_API_KEY` |
   | `authDomain` | `VITE_FIREBASE_AUTH_DOMAIN` |
   | `projectId` | `VITE_FIREBASE_PROJECT_ID` |
   | `appId` | `VITE_FIREBASE_APP_ID` |
   | `storageBucket` (optional) | `VITE_FIREBASE_STORAGE_BUCKET` |
   | `messagingSenderId` (optional) | `VITE_FIREBASE_MESSAGING_SENDER_ID` |

5. Skip the "Add SDK" and "Install CLI" steps (already done in this repo) → **Continue to console**.

## 5. Authorize the domains the app runs on
1. **Authentication → Settings** tab → **Authorized domains** → **Add domain**.
2. Add `ravikirankalal.github.io` (the GitHub Pages site).
3. Check that `<project-id>.web.app` and `<project-id>.firebaseapp.com` (Firebase Hosting) and
   `localhost` are already listed. Add any that are missing.

> Phones: Google sign-in uses a popup. On the Firebase Hosting address
> (`https://<project-id>.web.app`) phones and tablets use a full-page redirect instead, which is
> more reliable. On GitHub Pages they keep the popup, because browsers block the redirect flow
> across domains. **Recommend the `.web.app` address to relatives on phones.**

## 6. Put the web config into GitHub (repository variables)
1. Open <https://github.com/ravikirankalal/Lineage> → **Settings → Secrets and variables → Actions**.
2. Choose the **Variables** tab (not Secrets) → **New repository variable**.
3. Add one variable for each row of the table in step 4, e.g. name `VITE_FIREBASE_API_KEY`, value
   the `apiKey` text without quotes. Add at least the first four (API key, auth domain, project ID, app ID).

## 7. Create the deploy key (service account) → GitHub secret
1. Open <https://console.cloud.google.com/iam-admin/serviceaccounts> and choose your Firebase
   project in the project picker at the top.
2. **+ Create service account**. Name: `github-deploy` → **Create and continue**.
3. **Grant this service account access**: add these roles (use **+ Add another role** for each):
   - **Firebase Hosting Admin**
   - **Firebase Rules Admin**
   - **Cloud Datastore Index Admin**
   - **API Keys Viewer**
   - **Service Usage Consumer**

   → **Continue** → **Done**.
4. Click the new `github-deploy@…` account → **Keys** tab → **Add key → Create new key → JSON →
   Create**. A `.json` file downloads.
5. Open the file in a text editor and copy **all** of it.
6. GitHub → **Settings → Secrets and variables → Actions → Secrets** tab → **New repository
   secret**. Name: `FIREBASE_SERVICE_ACCOUNT`. Value: paste the whole JSON → **Add secret**.
7. Delete the downloaded `.json` file from your computer (and empty the trash).

## 8. First deploy
1. GitHub → **Actions** tab → **Deploy to Firebase** (left list) → **Run workflow** → branch
   `master` → **Run workflow**. (It also runs on every push to `master`.)
2. Wait for the green tick. It runs the tests, builds the app with your config, deploys the
   Firestore rules and indexes, then deploys the site.
3. Open `https://<project-id>.web.app` and click **Sign in with Google**.
4. Firestore indexes take a few minutes to build after the first deploy. If sharing shows an
   "index" error right after deploying, wait 5 minutes and retry.

The GitHub Pages site (`https://ravikirankalal.github.io/Lineage/`) gets the same config only if
its workflow (`deploy.yml`) builds with the same `VITE_FIREBASE_*` variables. Until then it stays
local-only, which is fine.

Until the `FIREBASE_SERVICE_ACCOUNT` secret exists, the Firebase workflow skips itself with a notice.

## 9. Sharing with relatives
1. Sign in, open **Sharing**, enter a relative's Google email and pick **Editor** (can add/edit
   family) or **Viewer** (read only).
2. Send them the site link. When they sign in with **that** Google account, they see the invite
   and can accept it.
3. They only ever receive the family part of your tree. Friends, colleagues and notes about
   non-family people stay in your account; the server refuses to send them.

---

## Local development

### Against the emulators (no real project needed)
Needs Java 11+ (`java -version`).

```bash
# terminal 1: local Auth + Firestore, project "demo-lineage", with this repo's rules
npx firebase emulators:start --only auth,firestore --project demo-lineage

# terminal 2
VITE_FIREBASE_EMULATORS=1 npm run dev
```

Sign-in then shows the emulator's fake Google account picker. Add a test account with an
`@example.com` email. Nothing leaves your machine, and the data is wiped when the emulators stop.

### Security-rules tests
```bash
npm run test:rules     # starts the Firestore emulator, runs tests/rules, stops it
```

### Against your real project
Copy `.env.example` to `.env.local` and fill in the values from step 4. `.env.local` is
gitignored. To use the Firebase CLI by hand, copy `.firebaserc.example` to `.firebaserc`, put
your project ID in it, then run `npx firebase login`.
