import { ArrowLeft } from 'lucide-react';

const LAST_UPDATED = 'May 7, 2026';

export function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-300">
      {/* Header */}
      <div className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-gray-800 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <a href="/" className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </a>
          <h1 className="text-lg font-semibold text-white">Privacy Policy</h1>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-sm text-gray-500 mb-8">Last updated: {LAST_UPDATED}</p>

        {/* Table of Contents */}
        <nav className="mb-10 p-4 bg-white/5 rounded-lg">
          <h2 className="text-sm font-medium text-gray-400 mb-3">Contents</h2>
          <ol className="space-y-1 text-sm">
            <li><a href="#information-we-collect" className="text-blue-400 hover:underline">1. Information We Collect</a></li>
            <li><a href="#how-we-use" className="text-blue-400 hover:underline">2. How We Use Your Information</a></li>
            <li><a href="#how-we-share" className="text-blue-400 hover:underline">3. How We Share Your Information</a></li>
            <li><a href="#data-retention" className="text-blue-400 hover:underline">4. Data Retention</a></li>
            <li><a href="#your-rights" className="text-blue-400 hover:underline">5. Your Privacy Rights (CCPA/CPRA)</a></li>
            <li><a href="#childrens-privacy" className="text-blue-400 hover:underline">6. Children's Privacy (COPPA)</a></li>
            <li><a href="#cookies" className="text-blue-400 hover:underline">7. Cookies and Tracking</a></li>
            <li><a href="#do-not-track" className="text-blue-400 hover:underline">8. Do Not Track / Global Privacy Control</a></li>
            <li><a href="#security" className="text-blue-400 hover:underline">9. Security</a></li>
            <li><a href="#changes" className="text-blue-400 hover:underline">10. Changes to This Policy</a></li>
            <li><a href="#contact" className="text-blue-400 hover:underline">11. Contact Us</a></li>
          </ol>
        </nav>

        <p className="mb-6">
          Reel Ballers (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates the Reel Ballers video editing application (the &ldquo;Service&rdquo;). This Privacy Policy describes how we collect, use, disclose, and protect your personal information when you use our Service.
        </p>

        {/* Section 1 */}
        <Section id="information-we-collect" title="1. Information We Collect">
          <h4 className="text-white font-medium mb-2">Information You Provide</h4>
          <ul className="list-disc pl-5 space-y-1 mb-4">
            <li><strong className="text-white">Account Information:</strong> Email address, Google profile picture URL, Google ID</li>
            <li><strong className="text-white">Video Content:</strong> Game footage you upload (may contain identifiable minors)</li>
            <li><strong className="text-white">Payment Information:</strong> Credit card data processed entirely by Stripe — we do not store card numbers</li>
          </ul>

          <h4 className="text-white font-medium mb-2">Information Collected Automatically</h4>
          <ul className="list-disc pl-5 space-y-1 mb-4">
            <li><strong className="text-white">Session Data:</strong> Session tokens via httponly cookie (<code className="text-xs bg-white/10 px-1 rounded">rb_session</code>)</li>
            <li><strong className="text-white">Usage Analytics:</strong> Page views via Cloudflare Web Analytics (no cookies, no PII)</li>
          </ul>

          <h4 className="text-white font-medium mb-2">Information We Do NOT Collect</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>No biometric data — video cropping is manual</li>
            <li>No facial recognition or automated identification</li>
            <li>No location data, device identifiers, or advertising identifiers</li>
          </ul>
        </Section>

        {/* Section 2 */}
        <Section id="how-we-use" title="2. How We Use Your Information">
          <p className="mb-3">We use your personal information to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-4">
            <li>Provide, maintain, and improve the Service</li>
            <li>Process video uploads and generate highlights</li>
            <li>Process payments and manage storage credits</li>
            <li>Send transactional emails (OTP codes, share notifications)</li>
            <li>Respond to support requests</li>
          </ul>
          <p className="mb-3">We do <strong className="text-white">not</strong> use your information to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Sell to third parties</li>
            <li>Target advertising</li>
            <li>Build user profiles for marketing</li>
            <li>Train AI/ML models on your video content</li>
          </ul>
        </Section>

        {/* Section 3 */}
        <Section id="how-we-share" title="3. How We Share Your Information">
          <p className="mb-3">We share data only with service providers who help operate the Service:</p>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-2 pr-4 text-gray-400">Provider</th>
                  <th className="text-left py-2 pr-4 text-gray-400">Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                <tr><td className="py-2 pr-4 text-white">Cloudflare R2</td><td className="py-2">Cloud file storage</td></tr>
                <tr><td className="py-2 pr-4 text-white">Modal</td><td className="py-2">GPU video processing (temporary)</td></tr>
                <tr><td className="py-2 pr-4 text-white">Fly.io</td><td className="py-2">Application hosting</td></tr>
                <tr><td className="py-2 pr-4 text-white">Resend</td><td className="py-2">Transactional email</td></tr>
                <tr><td className="py-2 pr-4 text-white">Google</td><td className="py-2">OAuth authentication</td></tr>
                <tr><td className="py-2 pr-4 text-white">Stripe</td><td className="py-2">Payment processing</td></tr>
                <tr><td className="py-2 pr-4 text-white">Cloudflare Web Analytics</td><td className="py-2">Privacy-preserving analytics (no PII)</td></tr>
              </tbody>
            </table>
          </div>
          <p className="font-medium text-white">We do not sell or share your personal information as defined by CCPA/CPRA.</p>
        </Section>

        {/* Section 4 */}
        <Section id="data-retention" title="4. Data Retention">
          <ul className="list-disc pl-5 space-y-1">
            <li>Game footage: 30 days after game expiry</li>
            <li>Account data: retained until you request deletion</li>
            <li>Processing artifacts: deleted immediately after export</li>
            <li>Sessions: 30 days max, or until logout</li>
            <li>OTP codes: expire after 10 minutes</li>
          </ul>
          <p className="mt-3">Upon deletion request, all data is permanently removed immediately (within 45 days if via email).</p>
        </Section>

        {/* Section 5 */}
        <Section id="your-rights" title="5. Your Privacy Rights (CCPA/CPRA)">
          <p className="mb-3">California residents (and others where required by law) have the following rights:</p>
          <ul className="list-disc pl-5 space-y-2 mb-4">
            <li><strong className="text-white">Right to Know/Access:</strong> Request a copy of your data via &ldquo;Download My Data&rdquo; in Account Settings</li>
            <li><strong className="text-white">Right to Delete:</strong> Delete your account via &ldquo;Delete My Account&rdquo; in Account Settings. Deletion is permanent and immediate.</li>
            <li><strong className="text-white">Right to Correct:</strong> Contact us to correct inaccurate information</li>
            <li><strong className="text-white">Right to Opt-Out of Sale/Sharing:</strong> We do not sell or share your data. This right is automatically honored.</li>
            <li><strong className="text-white">Right to Limit Sensitive PI:</strong> Video content is used only as you direct</li>
            <li><strong className="text-white">Non-Discrimination:</strong> We will not discriminate against you for exercising rights</li>
          </ul>
          <p className="mb-2"><strong className="text-white">How to exercise your rights:</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li>In-app: Account Settings → Your Privacy Rights</li>
            <li>Email: <a href="mailto:privacy@reelballers.com" className="text-blue-400 hover:underline">privacy@reelballers.com</a></li>
          </ul>
        </Section>

        {/* Section 6 */}
        <Section id="childrens-privacy" title="6. Children's Privacy (COPPA)">
          <p className="mb-3 font-medium text-white">Reel Ballers is designed for adults (18+).</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Children do not create accounts. All users must confirm they are 18+.</li>
            <li>Children may appear in video content uploaded by their parent/guardian/coach.</li>
            <li>We do not knowingly collect personal information from children under 13.</li>
            <li>No biometric data is extracted. Cropping is manual.</li>
            <li>No automated identification of individuals is performed.</li>
          </ul>
          <p className="mt-3">If you believe a child under 13 has created an account, contact us at <a href="mailto:privacy@reelballers.com" className="text-blue-400 hover:underline">privacy@reelballers.com</a>.</p>
        </Section>

        {/* Section 7 */}
        <Section id="cookies" title="7. Cookies and Tracking">
          <p className="mb-3">We use <strong className="text-white">one cookie</strong>:</p>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-2 pr-4 text-gray-400">Cookie</th>
                  <th className="text-left py-2 pr-4 text-gray-400">Type</th>
                  <th className="text-left py-2 text-gray-400">Purpose</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="py-2 pr-4 text-white font-mono text-xs">rb_session</td><td className="py-2 pr-4">Strictly necessary</td><td className="py-2">Authentication</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mb-3">We use <strong className="text-white">Cloudflare Web Analytics</strong> which does not set cookies, collect PII, or track across sites.</p>
          <p>We do not use advertising cookies, tracking pixels, Google Analytics, or cross-site tracking of any kind.</p>
        </Section>

        {/* Section 8 */}
        <Section id="do-not-track" title="8. Do Not Track / Global Privacy Control">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-white">Do Not Track (DNT):</strong> Effectively honored — our analytics don't use cookies or cross-site tracking.</li>
            <li><strong className="text-white">Global Privacy Control (GPC):</strong> We honor the GPC signal. Since we don't sell or share data, no behavioral change is needed — your data is already protected.</li>
          </ul>
        </Section>

        {/* Section 9 */}
        <Section id="security" title="9. Security">
          <ul className="list-disc pl-5 space-y-1">
            <li>All data transmitted over HTTPS/TLS</li>
            <li>Session cookies are httponly and secure</li>
            <li>Video files stored in encrypted-at-rest cloud storage</li>
            <li>Per-user database isolation</li>
            <li>No shared access between user accounts</li>
            <li>Processing artifacts deleted immediately after use</li>
          </ul>
        </Section>

        {/* Section 10 */}
        <Section id="changes" title="10. Changes to This Policy">
          <p>We will notify you of material changes by displaying a notice in the application and updating the &ldquo;Last Updated&rdquo; date. Continued use after changes constitutes acceptance.</p>
        </Section>

        {/* Section 11 */}
        <Section id="contact" title="11. Contact Us">
          <p className="mb-2"><strong className="text-white">Reel Ballers</strong></p>
          <p className="mb-2">[PHYSICAL ADDRESS]</p>
          <p>Privacy inquiries: <a href="mailto:privacy@reelballers.com" className="text-blue-400 hover:underline">privacy@reelballers.com</a></p>
        </Section>
      </div>
    </div>
  );
}

function Section({ id, title, children }) {
  return (
    <section id={id} className="mb-10 scroll-mt-16">
      <h3 className="text-xl font-semibold text-white mb-4">{title}</h3>
      {children}
    </section>
  );
}
