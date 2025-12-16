This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Environment

Add the following variables to `.env.local` so the UCtel portal handshake works during local development and deployment:

```bash
PORTAL_SIGNING_SECRET=matching_secret_from_portal
NEXT_PUBLIC_PORTAL_URL=https://portal.yourdomain.co.uk
NEXT_PUBLIC_PORTAL_SESSION_COOKIE=uctel_portal_session # optional, defaults to the UCtel portal cookie name
PDF_STORAGE_BUCKET=proposal-uploads.appspot.com # optional, defaults to FIREBASE_STORAGE_BUCKET
```

`NEXT_PUBLIC_PORTAL_SESSION_COOKIE` only needs to be set if your portal uses a non-default cookie name. The proposal app checks this cookie (in addition to its own `uctel_proposal_session`) so that anyone already signed into the portal automatically bypasses the email gate without re-authenticating.

## Viewer activity counters

- The proposal admin table shows total **Opens** and **Downloads** per proposal based on the customer email gate and PDF export.
- Selecting a proposal reveals a **Viewer activity** card with a "Clear counts" button that resets both totals and purges the underlying activity log (`/api/proposals/[slug]/events`).
- Clearing counts requires an authenticated UCtel portal session and cannot be undone.

## Large PDF exports

When a proposal produces more than roughly 3.5&nbsp;MB of compressed HTML, the browser now uploads the payload to the configured Cloud Storage bucket (`PDF_STORAGE_BUCKET`) before triggering the `/api/proposals/[slug]/pdf` endpoint. This avoids Vercel's 4.5&nbsp;MB request limit and prevents 413 errors for very large proposals. Ensure the environment variable points at a writable bucket owned by the Firebase project serving the proposal data.

### Configure Cloud Storage CORS (one-time)

Uploads rely on signed URLs, so the target bucket must allow `PUT` requests from your browser origins. Follow these steps:

1. Install the [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) if you do not already have it, then run `gcloud init` to authenticate.
2. Review `docs/storage-cors.json`. Update the `origin` array if you host the proposal app on additional domains (for example `https://prop.uctel.co.uk`).
3. Apply or re-apply the policy with the helper script whenever you change that file (replace the bucket name if needed):

	```powershell
	cd C:\Users\roman\Documents\Projects\CM\prop
	./scripts/set-storage-cors.ps1 -BucketName proposal-5823c.firebasestorage.app
	```

	The script uses `gsutil cors set` under the hood and will report success once the policy is stored.
4. Retry a large PDF export (over ~4&nbsp;MB compressed). The upload should now complete, and the API will fetch the HTML from storage automatically.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3302](http://localhost:3302) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
