# WhatsApp Integration Setup (Twilio Sandbox)

## 1. Create Twilio Account
- Go to https://www.twilio.com and sign up
- Verify your phone number

## 2. Enable WhatsApp Sandbox
- In Console → Messaging → Try it Out → Send a WhatsApp message
- Follow the instructions to connect your WhatsApp to the sandbox

## 3. Get your credentials
- Account SID: found on the Console home page
- Auth Token: found on the Console home page (click to reveal)
- Sandbox number: `+14155238886` (or your dedicated number if you have one)

## 4. Set Vercel env vars
```
TWILIO_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_TOKEN=your_auth_token
TWILIO_FROM=whatsapp:+14155238886
```

## 5. Usage in the app
In any contact card, click "Send WhatsApp". The number should be in international format, e.g. `+972501234567`.

## Notes
- Sandbox has a 24-hour session window — users must send you a message first to open the window
- For production, apply for a dedicated WhatsApp Business number through Twilio
