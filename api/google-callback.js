// api/google-callback.js — Google OAuth 2.0 callback handler
// IMPORTANT: In Google Cloud Console, add this exact URI to authorized redirect URIs:
//   https://personal-os-coral-tau.vercel.app/api/google-callback

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { code, error, state } = req.query;

  if (error) {
    return res.redirect(`/?auth_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'https://personal-os-coral-tau.vercel.app/api/google-callback';

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel env vars.' });
  }

  try {
    // Exchange code for tokens
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      console.error('Token exchange failed:', err);
      return res.redirect('/?auth_error=token_exchange_failed');
    }

    const tokens = await tokenResp.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;

    // Redirect back to app with token in fragment (stays client-side only)
    const redirectTo = `/?cal_token=${encodeURIComponent(accessToken)}${refreshToken ? '&cal_refresh=' + encodeURIComponent(refreshToken) : ''}`;
    return res.redirect(redirectTo);
  } catch (e) {
    console.error('google-callback error:', e);
    return res.redirect('/?auth_error=' + encodeURIComponent(e.message));
  }
}
