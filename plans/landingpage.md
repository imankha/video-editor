# Landing Page Plan

## Current State
Simple "Coming Soon" page with feature highlights. No backend dependencies.

**Location**: `src/landing/`

## Phase 1: Deploy Static Page (Now)

```bash
cd src/landing
npm install
npm run build
wrangler pages deploy dist
```

## Phase 2: Add Signup Form

When ready to collect signups:

1. **Create D1 Database**
   ```bash
   cd src/landing
   wrangler d1 create reelballers-signups
   ```

2. **Update wrangler.toml** with the database_id from step 1

3. **Initialize Schema**
   ```bash
   wrangler d1 execute reelballers-signups --file=./schema.sql
   ```

4. **Restore Signup Form** in `src/App.tsx`:
   - The signup form code is preserved in git history
   - API handler already exists at `functions/api/signup.ts`

5. **Deploy**
   ```bash
   npm run build
   wrangler pages deploy dist
   ```

## Phase 3: Link to Main App

When main app is live on `app.reelballers.com`:

Update the "Coming Soon" section to a CTA button:

```tsx
<a
  href="https://app.reelballers.com"
  className="inline-block py-3 px-8 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold"
>
  Launch App
</a>
```

## Future Enhancements

- Add demo video/GIF showing the app in action
- Testimonials section
- Pricing tiers (if applicable)
- Blog/updates section
