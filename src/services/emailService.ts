const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'Side Quest <onboarding@resend.dev>';
const APP_DEEP_LINK_BASE = process.env.APP_VERIFY_URL ?? 'sidequest://verify';

export async function sendVerificationEmail(
  to: string,
  username: string,
  token: string
): Promise<{ sent: boolean; devLink?: string }> {
  const verifyUrl = `${APP_DEEP_LINK_BASE}?token=${token}`;
  const subject = 'Confirm your Side Quest email';
  const html = `
    <p>Hi ${username},</p>
    <p>Thanks for joining Side Quest. Confirm your email to secure your account:</p>
    <p><a href="${verifyUrl}">Verify my email</a></p>
    <p>Or paste this link: ${verifyUrl}</p>
    <p>This link expires in 24 hours.</p>
  `;

  if (RESEND_API_KEY) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('Resend email failed:', body);
      throw new Error('Failed to send verification email');
    }

    return { sent: true };
  }

  console.log('\n--- Side Quest verification email (dev) ---');
  console.log(`To: ${to}`);
  console.log(`Verify: ${verifyUrl}`);
  console.log('-------------------------------------------\n');

  return {
    sent: false,
    devLink: process.env.NODE_ENV !== 'production' ? verifyUrl : undefined,
  };
}
