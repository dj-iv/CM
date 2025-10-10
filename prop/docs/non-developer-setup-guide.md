# UCtel Proposal Workspace: Non-Developer Setup Guide

This checklist helps a non-technical teammate prepare the proposal tools on a Windows laptop. Follow the steps in order; each one builds on the previous. No coding knowledge is required.

> ℹ️ If an engineer already set up Node.js or the repository on your machine, you can skip the matching sections below. Use the checkmarks in each heading as a reminder of what’s already done.

---

## 1. Collect the required accounts and files

1. **Windows login:** You just need a standard user account with permission to install software.
2. **Google (UCtel) account:** Must end with `@uctel.co.uk`. You will use this to sign in to the Cost Model.
3. **Firebase project access:** Ask an engineer or admin for:
   - Project ID (example: `cost-model-8c2fc`).
   - Web App configuration (API key, auth domain, etc.).
   - Service account JSON file (used by the Next.js app).
4. **pdfShift API key:** Generate a fresh key inside the shared pdfShift account (do not reuse keys from other projects). Keep it confidential.
5. **Repository copy:** Download the `CM` project folder or clone it with Git. Place it somewhere easy to find, for example `C:\Users\roman\Documents\Projects\CM`. If the folder already exists, just confirm it opens in File Explorer and continue.

> ✅ Make sure you can open the service account JSON file and copy values when asked later.

---

## 2. Install the tools (one-time)

### 2.1 Install Node.js *(skip if already installed)*
1. Visit [https://nodejs.org/en/download/prebuilt-installer](https://nodejs.org/en/download/prebuilt-installer).
2. Download the **LTS (Long-Term Support)** installer for Windows (64-bit).
3. Run the installer and accept all default options.
4. When it finishes, restart PowerShell and type:
   ```powershell
   node -v
   ```
   You should see a version number (for example `v20.11.1`).

### 2.2 Install Git (optional but recommended)
If you do not already have the `CM` folder, install Git:
1. Download from [https://git-scm.com/download/win](https://git-scm.com/download/win).
2. Run the installer (defaults are fine).
3. Clone the project:
   ```powershell
   git clone https://github.com/dj-iv/CM.git "C:\Users\roman\Documents\Projects\CM"
   ```
   *Alternatively, you can receive a zipped folder from engineering and unzip it to the same location.*

---

## 3. Install project dependencies

You need to install packages in **two** folders.

1. Open **PowerShell**.
2. Run the commands exactly as written (each block is a separate command):
   ```powershell
   cd "C:\Users\roman\Documents\Projects\CM"
   npm install

   cd "C:\Users\roman\Documents\Projects\CM\prop"
   npm install
   ```
3. Wait for each command to finish before running the next. A successful run ends with `added XX packages` and no red error text.

> ℹ️ You only need to repeat this step when the development team updates dependencies.

---

## 4. Configure secrets and environment files

### 4.1 Root server (`CM/.env`)
1. Open Notepad.
2. Paste the template below and fill in the pdfShift key (use the dedicated key created for the proposal portal):
   ```ini
   PORT=8080
   PDFSHIFT_API_KEY=YOUR_PDFSHIFT_KEY_HERE
   ```
3. Save the file as `C:\Users\roman\Documents\Projects\CM\.env` (note the dot at the beginning of the filename).

### 4.2 Next.js app (`CM/prop/.env.local`)
1. Create a new file named `.env.local` inside `CM/prop/`.
2. Copy the template and replace the values with the service account details.
   ```ini
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_CLIENT_EMAIL=service-account@your-project-id.iam.gserviceaccount.com
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMUL
   TI-LINE-KEY\n-----END PRIVATE KEY-----\n"
   PDFSHIFT_API_KEY=your-pdfshift-key
   ```
   - Keep the quotes (`"`) around the private key.
   - Replace `MUL
   TI-LINE-KEY` with the real key contents; every newline must be written as `\n`.

### 4.3 Calculator Firebase config
1. Open `C:\Users\roman\Documents\Projects\CM\public\index.html` in a text editor.
2. Search for `firebaseConfig` (around the end of the file).
3. Replace the existing block with the Web App config provided by engineering. It should look like:
   ```javascript
   const firebaseConfig = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
4. Save the file.

### 4.4 Link calculator to the local proposal app
For local testing, set the proposal URL to `http://localhost:3000` so the calculator talks to your local Next.js server.
1. Open `public\calculator.js`.
2. At the top, change:
   ```javascript
   const PROPOSAL_APP_BASE_URL = 'https://prop.uctel.co.uk';
   ```
   to
   ```javascript
   const PROPOSAL_APP_BASE_URL = 'http://localhost:3000';
   ```
3. Save the file.

> 📌 Before deploying to production, switch this value back to the live domain.

---

## 5. Start the applications

You will run two commands, each in its own PowerShell window or tab.

### 5.1 Start the Next.js proposal app
```powershell
cd "C:\Users\roman\Documents\Projects\CM\prop"
npm run dev
```
- Leave this window open. The app runs at `http://localhost:3000`.

### 5.2 Start the calculator/Express server
```powershell
cd "C:\Users\roman\Documents\Projects\CM"
npm run dev
```
- Leave this running as well. The calculator is served at `http://localhost:8080`.

---

## 6. Verify everything works

Follow this quick checklist after the servers start:

1. **Sign in to the calculator**
   - Visit `http://localhost:8080`.
   - Click “Sign in with Google”.
   - Confirm the login succeeds and you can see the calculator interface.

2. **Save a proposal to the portal**
   - Fill in the basic customer details (customer name, survey price, etc.).
   - Click the “Save Proposal 💾” button.
   - Confirm the temporary banner reads “Saved to Proposal Management Portal”.

3. **Review the proposal in the portal**
   - Open `http://localhost:3000/<slug>` in a new tab, replacing `<slug>` with the last saved slug (see browser DevTools → Application → Local Storage → `calculator-last-proposal-slug`) or use the portal UI if available.
   - Verify the interactive proposal renders correctly.

4. **Download a PDF**
   - In the proposal tab, press “Download as PDF”.
   - Confirm the browser shows the print dialog or downloads a PDF.

5. **Final power check**
   - Stop both PowerShell windows (press `Ctrl + C`).
   - Restart them with the same commands to ensure the process is repeatable.

If any step fails:
- Re-check the environment files for typos (quotes and `\n` characters matter).
- Ensure the pdfShift key and Firebase credentials are correct.
- Ask the engineering team for help with error messages you cannot resolve.

---

## 7. Maintenance tips for non-developers

- **Updating from Git:** When engineers share updates, open the root folder in PowerShell and run `git pull` followed by the two `npm install` commands.
- **Security:** Never email the service account JSON or pdfShift key. Use a secure file share instead.
- **Shutting down:** Always close the PowerShell windows to stop the local servers when you finish.
- **Support:** Screenshot errors and send them to the engineering team if something unexpected happens.

You’re ready to generate and review proposals locally without writing a line of code. ✔️
