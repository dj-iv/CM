export const ALLOWED_EMAIL_DOMAINS = ["uctel.co.uk"] as const;

export const isEmailAllowed = (email: string | undefined | null): boolean => {
  if (!email) {
    return false;
  }
  const lower = email.toLowerCase();
  return ALLOWED_EMAIL_DOMAINS.some((domain) => lower.endsWith(`@${domain}`));
};
