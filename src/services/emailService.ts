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

export interface QuestSubmissionNotification {
  id: string;
  title: string;
  description: string;
  locationName: string;
  city: string;
  category: string;
  username?: string | null;
  userId?: string | null;
}

export async function sendQuestSubmissionNotification(
  submission: QuestSubmissionNotification
): Promise<{ sent: boolean }> {
  const notifyEmail = process.env.ADMIN_NOTIFY_EMAIL?.trim();
  if (!notifyEmail) {
    console.log('\n--- New quest idea (set ADMIN_NOTIFY_EMAIL to get emailed) ---');
    console.log(JSON.stringify(submission, null, 2));
    console.log('---------------------------------------------------------------\n');
    return { sent: false };
  }

  const submittedBy = submission.username
    ? `${submission.username}${submission.userId ? ` (${submission.userId})` : ''}`
    : 'Anonymous / guest';

  const subject = `New quest idea: ${submission.title}`;
  const html = `
    <h2>New quest idea submitted</h2>
    <p><strong>Title:</strong> ${escapeHtml(submission.title)}</p>
    <p><strong>Location:</strong> ${escapeHtml(submission.locationName)}</p>
    <p><strong>City:</strong> ${escapeHtml(submission.city)}</p>
    <p><strong>Category:</strong> ${escapeHtml(submission.category)}</p>
    <p><strong>Submitted by:</strong> ${escapeHtml(submittedBy)}</p>
    <p><strong>Description:</strong></p>
    <p>${escapeHtml(submission.description).replace(/\n/g, '<br>')}</p>
    <hr>
    <p style="color:#666;font-size:12px;">Submission ID: ${submission.id}</p>
    <p style="color:#666;font-size:12px;">Review pending submissions via your admin API or database.</p>
  `;

  if (!RESEND_API_KEY) {
    console.log('\n--- New quest idea email (dev — add RESEND_API_KEY to send) ---');
    console.log(`To: ${notifyEmail}`);
    console.log(`Subject: ${subject}`);
    console.log(JSON.stringify(submission, null, 2));
    console.log('----------------------------------------------------------------\n');
    return { sent: false };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [notifyEmail],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('Quest submission notification email failed:', body);
    return { sent: false };
  }

  return { sent: true };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
