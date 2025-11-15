This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Environment

Add the following variables to `.env.local` so the UCtel portal handshake works during local development and deployment:

```bash
PORTAL_SIGNING_SECRET=matching_secret_from_portal
NEXT_PUBLIC_PORTAL_URL=https://portal.yourdomain.co.uk
NEXT_PUBLIC_PORTAL_SESSION_COOKIE=uctel_portal_session # optional, defaults to the UCtel portal cookie name
```

`NEXT_PUBLIC_PORTAL_SESSION_COOKIE` only needs to be set if your portal uses a non-default cookie name. The proposal app checks this cookie (in addition to its own `uctel_proposal_session`) so that anyone already signed into the portal automatically bypasses the email gate without re-authenticating.

## Viewer activity counters

- The proposal admin table shows total **Opens** and **Downloads** per proposal based on the customer email gate and PDF export.
- Selecting a proposal reveals a **Viewer activity** card with a "Clear counts" button that resets both totals and purges the underlying activity log (`/api/proposals/[slug]/events`).
- Clearing counts requires an authenticated UCtel portal session and cannot be undone.

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
