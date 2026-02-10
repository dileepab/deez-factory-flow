# Firebase Multi-Environment Setup Guide

## Quick Start

### 1. Create Development Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project"
3. Name: `deez-factory-dev` (or your preferred name)
4. Follow the wizard to create the project

### 2. Enable Required Services

In your new development project:

**Authentication:**
- Go to Authentication → Sign-in method
- Enable "Email/Password"

**Firestore:**
- Go to Firestore Database → Create database
- Start in **test mode** (we'll deploy rules later)
- Choose your region (same as production for consistency)

**App Hosting:**
- Go to App Hosting
- Click "Get started"
- Connect your GitHub repository

### 3. Get Development Configuration

**Web App Config:**
1. Go to Project Settings (gear icon) → General
2. Scroll to "Your apps" section
3. Click "Add app" → Web app (</> icon)
4. Register app with nickname: "deez-factory-dev-web"
5. Copy the `firebaseConfig` object

**Service Account:**
1. Go to Project Settings → Service Accounts
2. Click "Generate new private key"
3. Save the JSON file
4. Base64 encode it:
   ```bash
   base64 -i serviceAccountKey.json | tr -d '\n'
   ```
5. Copy the output

### 4. Update `.env.development`

Replace the placeholder values in `.env.development` with your actual development config:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=<from firebaseConfig>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<from firebaseConfig>
NEXT_PUBLIC_FIREBASE_PROJECT_ID=<from firebaseConfig>
NEXT_PUBLIC_FIREBASE_APP_ID=<from firebaseConfig>
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=<from firebaseConfig>
FIREBASE_CREDENTIALS_BASE64=<base64 encoded service account>
```

### 5. Update `.firebaserc`

Replace `YOUR_DEV_PROJECT_ID` with your actual development project ID:

```json
{
  "projects": {
    "development": "your-actual-dev-project-id",
    "production": "studio-4207278931-f63d2"
  }
}
```

### 6. Install Firebase CLI (if not already installed)

```bash
npm install -g firebase-tools
firebase login
```

### 7. Test Locally

```bash
# This will use .env.development
npm run dev
```

Visit http://localhost:9002 and verify it connects to your development Firebase project.

### 8. Deploy to Development

```bash
# Build for development
npm run build:dev

# Deploy to development Firebase
npm run deploy:dev
```

### 9. Deploy Firestore Rules

```bash
# Deploy to development
npm run firestore:deploy:dev

# Deploy to production (when ready)
npm run firestore:deploy:prod
```

## Daily Workflow

### Development
```bash
# Local development (uses .env.development)
npm run dev

# Deploy to dev environment for testing
npm run build:dev
npm run deploy:dev
```

### Production Release
```bash
# Only after testing in dev!
npm run build:prod
npm run deploy:prod
```

## Switching Between Environments

```bash
# Switch to development
firebase use development

# Switch to production
firebase use production

# Check current project
firebase use
```

## Environment Variables Reference

| Variable | Development | Production |
|----------|-------------|------------|
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `your-dev-project` | `studio-4207278931-f63d2` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Dev API key | Prod API key |
| `FIREBASE_CREDENTIALS_BASE64` | Dev service account | Prod service account |

## Troubleshooting

### "Missing environment variables" error
- Make sure `.env.development` or `.env.production` exists
- Check that all variables are set (no placeholders)
- Restart your dev server after changing env files

### "Permission denied" on deploy
- Run `firebase login` to authenticate
- Make sure you have owner/editor role on both projects

### Wrong Firebase project in local dev
- Check which `.env.*` file Next.js is using
- By default, `npm run dev` uses `.env.development`
- Set `NODE_ENV=production npm run dev` to use production (not recommended)

### Firestore rules deployment fails
- Make sure you're using the correct project: `firebase use development`
- Check that `firestore.rules` syntax is valid
- Verify you have Firestore enabled in the Firebase project

## Security Checklist

- [x] `.env.development` added to `.gitignore`
- [x] `.env.production` added to `.gitignore`
- [ ] Production credentials stored in secure vault
- [ ] Team members have access to both Firebase projects
- [ ] Firestore rules are strict in production
- [ ] Service account permissions follow least privilege

## Files Created

- `.env.development` - Development environment variables
- `.env.production` - Production environment variables
- `.firebaserc` - Firebase CLI project aliases
- `apphosting.dev.yaml` - Development App Hosting config
- `apphosting.prod.yaml` - Production App Hosting config
- `FIREBASE_SETUP.md` - This guide

## Next Steps

1. Complete steps 1-5 above to set up your development project
2. Test locally with `npm run dev`
3. Deploy to development with `npm run deploy:dev`
4. Verify everything works in development
5. Document any team-specific setup steps
