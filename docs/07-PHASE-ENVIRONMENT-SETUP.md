# Phase 7: Environment Setup

**Core Concept**: Multiple deployment environments  
**Audience**: Infrastructure setup  
**Dependencies**: Phase 6 (Build Pipeline)

---

## Objective

Create separate environments for development, staging, and production with appropriate configurations for each.

---

## Environments

### Local Development
- Run on localhost
- Hot reload enabled
- Mock services for testing
- Debug tools available
- Local file system access

### Staging
- Production-like environment
- Testing ground for releases
- Same build as production
- May have debug features enabled
- Isolated from production data

### Production
- Live user environment
- Optimized build
- Monitoring enabled
- Error tracking
- No debug features

---

## Environment Configuration

### Environment Variables
```bash
# .env.development
VITE_APP_ENV=development
VITE_API_URL=http://localhost:3000
VITE_ENABLE_DEBUG=true
VITE_LOG_LEVEL=debug

# .env.staging
VITE_APP_ENV=staging
VITE_API_URL=https://staging-api.example.com
VITE_ENABLE_DEBUG=true
VITE_LOG_LEVEL=info

# .env.production
VITE_APP_ENV=production
VITE_API_URL=https://api.example.com
VITE_ENABLE_DEBUG=false
VITE_LOG_LEVEL=error
```

### Load Environment Config
```javascript
const config = {
  env: import.meta.env.VITE_APP_ENV,
  apiUrl: import.meta.env.VITE_API_URL,
  debug: import.meta.env.VITE_ENABLE_DEBUG === 'true',
  logLevel: import.meta.env.VITE_LOG_LEVEL
};

export default config;
```

---

## Deployment Strategy

### Development Deployment
- Manual: `npm run dev`
- Accessible at `localhost:5173`
- Auto-reload on file changes

### Staging Deployment
```bash
# Build for staging
npm run build -- --mode staging

# Deploy to staging server
rsync -avz dist/ user@staging-server:/var/www/staging/
```

### Production Deployment
```bash
# Build for production
npm run build -- --mode production

# Deploy to production (use your hosting provider's CLI)
# Examples:
# Vercel: vercel --prod
# Netlify: netlify deploy --prod
# AWS S3: aws s3 sync dist/ s3://my-bucket/
```

---

## Hosting Options

### Static Hosting (Recommended for Phase 1)
- **Vercel**: Easy deployment, automatic HTTPS
- **Netlify**: Similar to Vercel, good CI integration
- **GitHub Pages**: Free, good for open source
- **AWS S3 + CloudFront**: Scalable, more configuration

### Server-Based Hosting
- **DigitalOcean Droplet**: Full control, requires setup
- **AWS EC2**: Flexible, more expensive
- **Heroku**: Easy deployment, limited free tier

---

## Domain and SSL

### Domain Setup
- Register domain (e.g., videoeditor.com)
- Configure DNS:
  - A record: `videoeditor.com` → IP address
  - CNAME: `staging.videoeditor.com` → staging server
  - CNAME: `www.videoeditor.com` → main server

### SSL Certificates
- Use Let's Encrypt (free)
- Or use hosting provider's SSL (Vercel, Netlify auto-provide)
- Enforce HTTPS redirect

---

## Deployment Scripts

### Deploy Script (deploy.sh)
```bash
#!/bin/bash
set -e

ENV=$1

if [ "$ENV" = "staging" ]; then
    echo "Deploying to staging..."
    npm run build -- --mode staging
    rsync -avz dist/ user@staging:/var/www/staging/
elif [ "$ENV" = "production" ]; then
    echo "Deploying to production..."
    read -p "Are you sure? (yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
        npm run build -- --mode production
        rsync -avz dist/ user@production:/var/www/production/
    fi
else
    echo "Usage: ./deploy.sh [staging|production]"
    exit 1
fi

echo "Deployment complete!"
```

Usage: `./deploy.sh staging`

---

## Database/Storage (if needed)

### Local Storage
- Browser LocalStorage for app state
- IndexedDB for larger data
- File System API for file access

### Cloud Storage (if expanding)
- AWS S3 for user videos
- Firebase Storage
- Cloudinary for media assets

---

## Monitoring and Logging

### Error Tracking
- Sentry for error reporting
- LogRocket for session replay
- Custom error logger

### Analytics
- Google Analytics for usage
- Custom event tracking
- Performance monitoring

### Health Checks
- Uptime monitoring (UptimeRobot, Pingdom)
- Performance monitoring (Lighthouse CI)

---

## Deployment Checklist

- [ ] Environment variables configured
- [ ] Staging environment deployed
- [ ] Production environment deployed
- [ ] Domain configured
- [ ] SSL certificates installed
- [ ] Health checks configured
- [ ] Error tracking enabled
- [ ] Monitoring set up
- [ ] Deployment scripts tested
- [ ] Rollback procedure documented

---

## Success Criteria

✅ Can deploy to staging with one command  
✅ Can deploy to production with one command  
✅ Environments are isolated  
✅ SSL works on all environments  
✅ Monitoring captures errors  
✅ Can rollback if needed  

---

## Rollback Procedure

### Quick Rollback
1. Keep previous build artifacts
2. Switch symlink to previous version
3. Clear CDN cache
4. Verify rollback successful

```bash
# Rollback script
./rollback.sh production
```

---

## Notes

- Always test in staging before production
- Keep staging and production in sync (same build process)
- Document deployment procedures
- Automate as much as possible
- Have rollback plan ready
