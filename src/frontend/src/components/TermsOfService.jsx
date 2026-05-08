import { ArrowLeft } from 'lucide-react';

const LAST_UPDATED = 'May 7, 2026';

export function TermsOfService() {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-300">
      {/* Header */}
      <div className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-gray-800 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <a href="/" className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </a>
          <h1 className="text-lg font-semibold text-white">Terms of Service</h1>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-sm text-gray-500 mb-8">Last updated: {LAST_UPDATED}</p>

        {/* Table of Contents */}
        <nav className="mb-10 p-4 bg-white/5 rounded-lg">
          <h2 className="text-sm font-medium text-gray-400 mb-3">Contents</h2>
          <ol className="space-y-1 text-sm">
            <li><a href="#acceptance" className="text-blue-400 hover:underline">1. Acceptance of Terms</a></li>
            <li><a href="#description" className="text-blue-400 hover:underline">2. Description of Service</a></li>
            <li><a href="#responsibilities" className="text-blue-400 hover:underline">3. User Representations</a></li>
            <li><a href="#acceptable-use" className="text-blue-400 hover:underline">4. Acceptable Use Policy</a></li>
            <li><a href="#content-ownership" className="text-blue-400 hover:underline">5. Content Ownership and License</a></li>
            <li><a href="#payments" className="text-blue-400 hover:underline">6. Storage Credits and Payments</a></li>
            <li><a href="#availability" className="text-blue-400 hover:underline">7. Service Availability</a></li>
            <li><a href="#liability" className="text-blue-400 hover:underline">8. Limitation of Liability</a></li>
            <li><a href="#indemnification" className="text-blue-400 hover:underline">9. Indemnification</a></li>
            <li><a href="#dmca" className="text-blue-400 hover:underline">10. DMCA Takedown Procedure</a></li>
            <li><a href="#disputes" className="text-blue-400 hover:underline">11. Dispute Resolution</a></li>
            <li><a href="#termination" className="text-blue-400 hover:underline">12. Termination</a></li>
            <li><a href="#changes" className="text-blue-400 hover:underline">13. Changes to Terms</a></li>
            <li><a href="#contact" className="text-blue-400 hover:underline">14. Contact</a></li>
          </ol>
        </nav>

        {/* Section 1 */}
        <Section id="acceptance" title="1. Acceptance of Terms">
          <p className="mb-3">By accessing or using Reel Ballers (the &ldquo;Service&rdquo;), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
          <p>You must be at least <strong className="text-white">18 years of age</strong> to create an account. By creating an account, you represent and warrant that you are 18 or older.</p>
        </Section>

        {/* Section 2 */}
        <Section id="description" title="2. Description of Service">
          <p className="mb-3">Reel Ballers is a browser-based video editing application for youth sports highlights. The Service includes:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Video upload and storage</li>
            <li>Clip extraction and annotation</li>
            <li>Video framing and cropping (with AI-assisted upscaling)</li>
            <li>Highlight overlay creation</li>
            <li>Video export and sharing</li>
          </ul>
        </Section>

        {/* Section 3 */}
        <Section id="responsibilities" title="3. User Representations and Responsibilities">
          <p className="mb-3">By using the Service, you represent and warrant that:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>You are at least 18 years of age</li>
            <li>You are the parent, legal guardian, or authorized coach of any minor depicted in content you upload</li>
            <li>You have the legal authority to upload and process content depicting minors</li>
            <li>You will not upload content you do not have the right to use</li>
            <li>You will comply with all applicable laws regarding content depicting minors</li>
          </ul>
        </Section>

        {/* Section 4 */}
        <Section id="acceptable-use" title="4. Acceptable Use Policy">
          <p className="mb-3">You agree NOT to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Upload content depicting abuse, exploitation, or harm</li>
            <li>Upload content you do not own or have rights to</li>
            <li>Use the Service for any illegal purpose</li>
            <li>Attempt to gain unauthorized access to other users' data</li>
            <li>Interfere with or disrupt the Service</li>
            <li>Use bots or automated systems to access the Service</li>
            <li>Upload content containing malware</li>
          </ul>
          <p className="mt-3">We reserve the right to suspend or terminate accounts that violate this policy.</p>
        </Section>

        {/* Section 5 */}
        <Section id="content-ownership" title="5. Content Ownership and License">
          <h4 className="text-white font-medium mb-2">Your Content</h4>
          <p className="mb-4">You retain full ownership of all content you upload. We do not claim ownership of your videos, clips, or highlights.</p>

          <h4 className="text-white font-medium mb-2">License Grant</h4>
          <p className="mb-3">By uploading content, you grant Reel Ballers a limited, non-exclusive, royalty-free license to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-4">
            <li>Store your content on our servers and cloud storage</li>
            <li>Process your content (transcode, crop, upscale, overlay) as directed by you</li>
            <li>Display your content back to you within the Service</li>
            <li>Transmit your content to recipients you explicitly share with</li>
          </ul>
          <p>This license exists solely to operate the Service on your behalf. It terminates when you delete your content or account.</p>
        </Section>

        {/* Section 6 */}
        <Section id="payments" title="6. Storage Credits and Payments">
          <ul className="list-disc pl-5 space-y-1">
            <li>Games expire after 30 days unless credits are applied</li>
            <li>Payments processed by Stripe — we do not store credit card information</li>
            <li>Credits are non-refundable except as required by law</li>
            <li>Pricing may change with 30 days' notice</li>
          </ul>
        </Section>

        {/* Section 7 */}
        <Section id="availability" title="7. Service Availability">
          <ul className="list-disc pl-5 space-y-1">
            <li>The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;</li>
            <li>We do not guarantee uninterrupted or error-free operation</li>
            <li>We may modify, suspend, or discontinue the Service with reasonable notice</li>
          </ul>
        </Section>

        {/* Section 8 */}
        <Section id="liability" title="8. Limitation of Liability">
          <p className="uppercase text-xs text-gray-400 mb-3">TO THE MAXIMUM EXTENT PERMITTED BY LAW:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>We shall not be liable for indirect, incidental, special, consequential, or punitive damages</li>
            <li>Total liability shall not exceed amounts paid to us in the 12 months preceding the claim</li>
            <li>We are not liable for data loss due to user error or account deletion</li>
            <li>We are not liable for content uploaded by other users</li>
          </ul>
        </Section>

        {/* Section 9 */}
        <Section id="indemnification" title="9. Indemnification">
          <p>You agree to indemnify and hold harmless Reel Ballers from any claims, damages, or expenses arising from your use of the Service, content you upload, your violation of these Terms, or your violation of any third party's rights.</p>
        </Section>

        {/* Section 10 */}
        <Section id="dmca" title="10. DMCA Takedown Procedure">
          <p className="mb-3">If you believe content infringes your copyright, send a DMCA notice to <a href="mailto:privacy@reelballers.com" className="text-blue-400 hover:underline">privacy@reelballers.com</a> including:</p>
          <ol className="list-decimal pl-5 space-y-1 mb-4">
            <li>Identification of the copyrighted work</li>
            <li>Identification of the infringing material with location</li>
            <li>Your contact information</li>
            <li>Good faith belief statement</li>
            <li>Accuracy statement under penalty of perjury</li>
            <li>Your signature</li>
          </ol>
          <p>Counter-notices will be processed in accordance with the DMCA.</p>
        </Section>

        {/* Section 11 */}
        <Section id="disputes" title="11. Dispute Resolution">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-white">Governing Law:</strong> State of California</li>
            <li><strong className="text-white">Venue:</strong> State or federal courts in California</li>
            <li><strong className="text-white">Informal Resolution:</strong> Contact us and attempt informal resolution for 30 days before formal action</li>
          </ul>
        </Section>

        {/* Section 12 */}
        <Section id="termination" title="12. Termination">
          <ul className="list-disc pl-5 space-y-1">
            <li>You may terminate your account at any time via Account Settings</li>
            <li>We may terminate accounts for Terms violations</li>
            <li>Upon termination, your content is permanently deleted</li>
          </ul>
        </Section>

        {/* Section 13 */}
        <Section id="changes" title="13. Changes to Terms">
          <p>We may update these Terms from time to time. We will notify you of material changes by displaying a notice in the application. Continued use after changes constitutes acceptance.</p>
        </Section>

        {/* Section 14 */}
        <Section id="contact" title="14. Contact">
          <p className="mb-2"><strong className="text-white">Reel Ballers</strong></p>
          <p>Email: <a href="mailto:privacy@reelballers.com" className="text-blue-400 hover:underline">privacy@reelballers.com</a></p>
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
