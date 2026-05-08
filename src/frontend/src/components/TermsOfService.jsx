import { ArrowLeft } from 'lucide-react';

const LAST_UPDATED = 'May 8, 2026';

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
            <li><a href="#third-party" className="text-blue-400 hover:underline">5. Third-Party Content and Services</a></li>
            <li><a href="#content-ownership" className="text-blue-400 hover:underline">6. Content Ownership and License</a></li>
            <li><a href="#payments" className="text-blue-400 hover:underline">7. Storage Credits and Payments</a></li>
            <li><a href="#warranties" className="text-blue-400 hover:underline">8. Disclaimer of Warranties</a></li>
            <li><a href="#liability" className="text-blue-400 hover:underline">9. Limitation of Liability</a></li>
            <li><a href="#indemnification" className="text-blue-400 hover:underline">10. Indemnification</a></li>
            <li><a href="#dmca" className="text-blue-400 hover:underline">11. DMCA Takedown Procedure</a></li>
            <li><a href="#disputes" className="text-blue-400 hover:underline">12. Dispute Resolution</a></li>
            <li><a href="#termination" className="text-blue-400 hover:underline">13. Termination</a></li>
            <li><a href="#changes" className="text-blue-400 hover:underline">14. Changes to Terms</a></li>
            <li><a href="#contact" className="text-blue-400 hover:underline">15. Contact</a></li>
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
          <ul className="list-disc pl-5 space-y-1 mb-4">
            <li>You are at least 18 years of age</li>
            <li>You are the parent, legal guardian, or authorized coach of any minor depicted in content you upload</li>
            <li>You have the legal authority to upload and process content depicting minors</li>
            <li>You will comply with all applicable laws regarding content depicting minors</li>
          </ul>

          <h4 className="text-white font-medium mb-2">Your Content Rights</h4>
          <p className="mb-3">You represent and warrant that you have all necessary rights, licenses, and permissions to upload content to Reel Ballers, including but not limited to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-4">
            <li>The right to upload, edit, and redistribute video depicting any individuals shown</li>
            <li>The right to create derivative works (clips, highlights, cropped versions) from the content you upload</li>
            <li>Compliance with any terms of service, license agreements, or usage restrictions imposed by the original source of the content (including but not limited to club camera systems, league recording platforms, or any third-party video service)</li>
            <li>Any required consents from individuals depicted in the content, including parental or guardian consent for minors</li>
          </ul>
          <p className="mb-4">If you upload video obtained from a third-party platform or recording service, <strong className="text-white">you are solely responsible for ensuring that your use of that content &mdash; including uploading it to Reel Ballers, editing it, and exporting or sharing the results &mdash; is permitted</strong> under that platform&apos;s terms of service and applicable law. Reel Ballers does not verify the source of content you upload and assumes no responsibility for your compliance with third-party terms.</p>

          <h4 className="text-white font-medium mb-2">No Monitoring Obligation</h4>
          <p>Reel Ballers has no obligation to pre-screen, monitor, or verify the source, ownership, or legality of content uploaded by users. We are a video editing tool. You bring the content; you are responsible for it.</p>
        </Section>

        {/* Section 4 */}
        <Section id="acceptable-use" title="4. Acceptable Use Policy">
          <h4 className="text-white font-medium mb-2">Prohibited Content</h4>
          <p className="mb-4">You may not upload content that is: (a) unlawful, harmful, threatening, abusive, or harassing; (b) depicts the exploitation or abuse of any person, especially minors; (c) infringes any third party&apos;s intellectual property rights; (d) contains malware or harmful code; or (e) violates any applicable law or regulation.</p>

          <h4 className="text-white font-medium mb-2">Intended Use</h4>
          <p className="mb-4">Reel Ballers is designed for youth sports video editing. You agree to use the Service only for uploading and editing sports-related video content. We reserve the right to remove content that falls outside this intended use.</p>

          <h4 className="text-white font-medium mb-2">Prohibited Activities</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Attempt to gain unauthorized access to other users&apos; data</li>
            <li>Interfere with or disrupt the Service</li>
            <li>Use bots or automated systems to access the Service</li>
            <li>Resell or redistribute the Service without authorization</li>
            <li>Use the Service to circumvent access controls, download restrictions, or terms of service of any third-party platform</li>
            <li>Upload content that you know or reasonably should know you do not have the right to use</li>
          </ul>
          <p className="mt-3">We reserve the right to suspend or terminate accounts that violate this policy.</p>
        </Section>

        {/* Section 5 */}
        <Section id="third-party" title="5. Third-Party Content and Services">
          <h4 className="text-white font-medium mb-2">Reel Ballers as a Neutral Tool</h4>
          <p className="mb-4">Reel Ballers is a video editing tool. We do not host, source, or provide video content. All content on the Service is uploaded by users from their own devices or cloud storage. We have no knowledge of, and assume no responsibility for, the original source of any content uploaded to the Service.</p>

          <h4 className="text-white font-medium mb-2">Third-Party Platforms</h4>
          <p className="mb-3">Some users may upload content originally recorded by third-party services (such as club camera systems, league recording platforms, or other video providers). Reel Ballers has no relationship with, endorsement of, or affiliation with any such third-party platform. We do not access, scrape, or pull content from any third-party service.</p>
          <p className="mb-3">You are solely responsible for:</p>
          <ul className="list-disc pl-5 space-y-1 mb-4">
            <li>Complying with the terms of service of any platform from which you obtained your content</li>
            <li>Ensuring you have the right to upload, edit, and redistribute such content</li>
            <li>Obtaining any required permissions or licenses from the content&apos;s original source or rights holder</li>
          </ul>

          <h4 className="text-white font-medium mb-2">No Verification</h4>
          <p>We do not and cannot verify whether content uploaded to our Service was lawfully obtained, properly licensed, or authorized for redistribution by the original source. By uploading content, you accept full legal responsibility for that content and its use.</p>
        </Section>

        {/* Section 6 */}
        <Section id="content-ownership" title="6. Content Ownership and License">
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

        {/* Section 7 */}
        <Section id="payments" title="7. Storage Credits and Payments">
          <ul className="list-disc pl-5 space-y-1">
            <li>Games expire after 30 days unless credits are applied</li>
            <li>Payments processed by Stripe — we do not store credit card information</li>
            <li>Credits are non-refundable except as required by law</li>
            <li>Pricing may change with 30 days' notice</li>
          </ul>
        </Section>

        {/* Section 8 */}
        <Section id="warranties" title="8. Disclaimer of Warranties">
          <p className="uppercase text-xs text-gray-400 mb-3">THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.</p>
          <p className="uppercase text-xs text-gray-400 mb-3">WITHOUT LIMITING THE FOREGOING, REEL BALLERS DOES NOT WARRANT THAT:</p>
          <ul className="list-disc pl-5 space-y-1 mb-4">
            <li>The Service will be uninterrupted or error-free</li>
            <li>The results obtained from the Service will be accurate or reliable</li>
            <li>The quality of any content processed through the Service will meet your expectations</li>
            <li>Any content you upload is lawfully obtained, properly licensed, or non-infringing</li>
          </ul>
          <p className="mb-3">Reel Ballers is a video editing tool. We process content as directed by you. We make no representations regarding the legality, ownership, or licensing status of content you upload.</p>
          <p>We may modify, suspend, or discontinue the Service at any time with reasonable notice.</p>
        </Section>

        {/* Section 9 */}
        <Section id="liability" title="9. Limitation of Liability">
          <p className="uppercase text-xs text-gray-400 mb-3">TO THE MAXIMUM EXTENT PERMITTED BY LAW:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>We shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including damages for loss of profits, goodwill, data, or other intangible losses</li>
            <li>Our total aggregate liability shall not exceed the greater of (a) amounts paid to us in the 12 months preceding the claim, or (b) fifty dollars ($50)</li>
            <li>We are not liable for data loss due to user error or account deletion</li>
            <li>We are not liable for content uploaded by users, including any claims that such content infringes third-party rights</li>
            <li>We are not liable for any claims arising from your use of content obtained from third-party platforms or recording services</li>
            <li>We are not liable for your violation of any third-party terms of service or applicable law in connection with content you upload or export</li>
          </ul>
        </Section>

        {/* Section 10 */}
        <Section id="indemnification" title="10. Indemnification">
          <p className="mb-3">You agree to defend, indemnify, and hold harmless Reel Ballers, its officers, directors, employees, agents, and affiliates from and against any and all claims, damages, obligations, losses, liabilities, costs, and expenses (including attorney&apos;s fees) arising from:</p>
          <ul className="list-disc pl-5 space-y-1 mb-3">
            <li>Your use of the Service</li>
            <li>Content you upload, edit, export, or share using the Service</li>
            <li>Your violation of these Terms</li>
            <li>Your violation of any third party&apos;s rights, including intellectual property rights</li>
            <li>Your violation of any third-party platform&apos;s terms of service in connection with content you upload</li>
            <li>Any claim that content you uploaded was obtained, used, or redistributed without proper authorization</li>
            <li>Your violation of any applicable law or regulation</li>
          </ul>
          <p>This indemnification obligation survives termination of your account and these Terms.</p>
        </Section>

        {/* Section 11 */}
        <Section id="dmca" title="11. DMCA Takedown Procedure">
          <p className="mb-3">If you believe content on Reel Ballers infringes your copyright, send a DMCA notice to <a href="mailto:copyright@reelballers.com" className="text-blue-400 hover:underline">copyright@reelballers.com</a> including:</p>
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

        {/* Section 12 */}
        <Section id="disputes" title="12. Dispute Resolution">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-white">Governing Law:</strong> State of California</li>
            <li><strong className="text-white">Venue:</strong> State or federal courts in California</li>
            <li><strong className="text-white">Informal Resolution:</strong> Contact us and attempt informal resolution for 30 days before formal action</li>
          </ul>
        </Section>

        {/* Section 13 */}
        <Section id="termination" title="13. Termination">
          <ul className="list-disc pl-5 space-y-1">
            <li>You may terminate your account at any time via Account Settings</li>
            <li>We may terminate accounts for Terms violations</li>
            <li>Upon termination, your content is permanently deleted</li>
            <li>Sections 5, 6, 8, 9, 10, and 12 survive termination</li>
          </ul>
        </Section>

        {/* Section 14 */}
        <Section id="changes" title="14. Changes to Terms">
          <p>We may update these Terms from time to time. We will notify you of material changes by displaying a notice in the application. Continued use after changes constitutes acceptance.</p>
        </Section>

        {/* Section 15 */}
        <Section id="contact" title="15. Contact">
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
