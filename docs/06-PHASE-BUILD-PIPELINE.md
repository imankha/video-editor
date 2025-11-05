# Phase 6: Build Pipeline

**Core Concept**: Automated build and deployment system  
**Audience**: Production deployment  
**Dependencies**: Phases 1-5 (Feature complete)

---

## Objective

Set up automated build pipeline for creating optimized production bundles. This phase transitions from development to deployment.

---

## Build System Components

### Development Build
- Fast rebuild times
- Source maps enabled
- Hot module replacement
- Unminified code
- Dev server with live reload

### Production Build
- Minified JavaScript and CSS
- Tree shaking (remove unused code)
- Code splitting
- Asset optimization (images, fonts)
- Source maps (separate files)
- Cache busting (file hashes)
- Gzip/Brotli compression

---

## Build Configuration

### Package.json Scripts
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "build:analyze": "vite build --analyze",
    "test": "vitest",
    "lint": "eslint src --ext js,jsx",
    "format": "prettier --write src/**/*.{js,jsx,css}"
  }
}
```

### Vite Config (vite.config.js)
```javascript
export default {
  build: {
    target: 'esnext',
    minify: 'terser',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ffmpeg: ['@ffmpeg/ffmpeg']
        }
      }
    }
  },
  optimizeDeps: {
    include: ['react', 'react-dom']
  }
}
```

---

## Optimization Strategies

### Code Splitting
- Split vendor code from application code
- Lazy load heavy components (Export dialog)
- Dynamic imports for FFmpeg

### Asset Optimization
- Compress images
- Optimize SVG files
- Use WebP format where supported
- Font subsetting

### Bundle Analysis
- Use webpack-bundle-analyzer or rollup-plugin-visualizer
- Identify large dependencies
- Remove duplicate code
- Split large chunks

---

## CI/CD Setup

### GitHub Actions (Simple)
```yaml
name: Build and Deploy
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build
      - run: npm test
      - uses: actions/upload-artifact@v3
        with:
          name: dist
          path: dist/
```

---

## Build Outputs

### Directory Structure
```
dist/
├── index.html
├── assets/
│   ├── index-[hash].js
│   ├── vendor-[hash].js
│   ├── ffmpeg-[hash].js
│   └── index-[hash].css
├── assets/fonts/
├── assets/images/
└── assets/workers/
```

### Build Artifacts
- Minified JavaScript bundles
- Optimized CSS
- Compressed images
- Source maps (separate files)
- Build report/statistics

---

## Quality Gates

### Pre-Build Checks
- [ ] ESLint passes (no errors)
- [ ] Tests pass
- [ ] TypeScript compilation (if using TS)
- [ ] No console.logs in production code

### Post-Build Verification
- [ ] Bundle size within limits (< 2MB total)
- [ ] All chunks load correctly
- [ ] Source maps work
- [ ] Assets accessible
- [ ] No broken imports

---

## Version Management

### Versioning Strategy
- Semantic versioning (1.0.0)
- Tag releases in Git
- Update package.json version
- Generate CHANGELOG.md

### Build Metadata
```javascript
// Inject build info
const buildInfo = {
  version: process.env.npm_package_version,
  buildTime: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || 'local'
};
```

---

## Implementation Checklist

- [ ] Set up Vite/Webpack configuration
- [ ] Configure build scripts
- [ ] Set up CI/CD pipeline
- [ ] Configure code splitting
- [ ] Optimize assets
- [ ] Add bundle analysis
- [ ] Set up version tagging
- [ ] Document build process
- [ ] Test production build locally
- [ ] Verify all features work in production mode

---

## Success Criteria

✅ Production build completes without errors  
✅ Bundle size is reasonable (< 2MB)  
✅ All features work in production build  
✅ Build time is acceptable (< 5 minutes)  
✅ CI/CD pipeline runs automatically  
✅ Artifacts are properly generated  

---

## Notes

- Test production build locally before deploying
- Monitor bundle size - don't let it grow unbounded
- Keep dependencies minimal
- Use build caching in CI for faster builds
