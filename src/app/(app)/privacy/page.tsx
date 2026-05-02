import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Sooq",
  description: "Privacy Policy for Sooq prediction market platform.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen pt-12 pb-24 max-w-[800px] mx-auto">
      <h1 className="font-satoshi text-3xl md:text-4xl font-black text-text tracking-tight mb-2">
        Privacy Policy
      </h1>
      <p className="text-muted-custom text-sm mb-10">
        Last updated: April 15, 2026
      </p>

      <div className="space-y-8 text-text text-sm leading-relaxed [&_h2]:font-satoshi [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-text [&_h2]:mb-3 [&_p]:text-muted-custom [&_ul]:text-muted-custom [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:text-muted-custom [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_a]:text-accent-yes [&_a]:underline">
        <section>
          <h2>1. Introduction</h2>
          <p>
            Sooq Exchange Ltd. (&quot;Sooq,&quot; &quot;we,&quot;
            &quot;us,&quot; or &quot;our&quot;), a company incorporated under
            the laws of the British Virgin Islands with registered address at
            Craigmuir Chambers, Road Town, Tortola, VG1110, British Virgin
            Islands, is committed to protecting your privacy.
          </p>
          <p className="mt-2">
            This Privacy Policy explains how we collect, use, store, share, and
            protect your personal information when you use the Sooq platform,
            mobile application, or any related services (collectively, the
            &quot;Platform&quot;). By using the Platform, you consent to the
            practices described in this Privacy Policy.
          </p>
        </section>

        <section>
          <h2>2. Information We Collect</h2>
          <p>
            We collect the following categories of information:
          </p>

          <p className="mt-3 font-semibold !text-text">2.1 Information You Provide</p>
          <ul>
            <li>
              <strong className="text-text">Account information:</strong> phone number, display name, profile picture, and any other information you provide during registration or profile completion;
            </li>
            <li>
              <strong className="text-text">Identity verification:</strong> government-issued identification documents, proof of address, and other information required for Know Your Customer (KYC) compliance;
            </li>
            <li>
              <strong className="text-text">Financial information:</strong> payment method details, transaction history, deposit and withdrawal records;
            </li>
            <li>
              <strong className="text-text">Communications:</strong> messages sent through our support system, feedback, and other correspondence.
            </li>
          </ul>

          <p className="mt-3 font-semibold !text-text">2.2 Information Collected Automatically</p>
          <ul>
            <li>
              <strong className="text-text">Device information:</strong> device type, operating system, browser type, unique device identifiers;
            </li>
            <li>
              <strong className="text-text">Usage data:</strong> pages visited, features used, trading activity, session duration, timestamps;
            </li>
            <li>
              <strong className="text-text">Location data:</strong> approximate geographic location derived from IP address;
            </li>
            <li>
              <strong className="text-text">Log data:</strong> IP address, access times, error logs, referral URLs.
            </li>
          </ul>

          <p className="mt-3 font-semibold !text-text">2.3 Information from Third Parties</p>
          <ul>
            <li>Payment processors and financial institutions;</li>
            <li>Identity verification service providers;</li>
            <li>Analytics providers;</li>
            <li>Referral partners.</li>
          </ul>
        </section>

        <section>
          <h2>3. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Provide, maintain, and improve the Platform;</li>
            <li>Process transactions, deposits, and withdrawals;</li>
            <li>Verify your identity and comply with legal obligations (KYC/AML);</li>
            <li>Detect, investigate, and prevent fraudulent, unauthorized, or illegal activity;</li>
            <li>Communicate with you about your account, transactions, and Platform updates;</li>
            <li>Provide customer support;</li>
            <li>Administer referral and agent programs;</li>
            <li>Analyze usage patterns to improve user experience;</li>
            <li>Enforce our Terms of Service and other agreements;</li>
            <li>Comply with applicable laws, regulations, and legal processes.</li>
          </ul>
        </section>

        <section>
          <h2>4. Legal Basis for Processing</h2>
          <p>We process your personal information on the following legal bases:</p>
          <ul>
            <li>
              <strong className="text-text">Performance of contract:</strong> processing necessary to provide the Platform and fulfill our obligations under the Terms of Service;
            </li>
            <li>
              <strong className="text-text">Legal obligation:</strong> processing required to comply with applicable laws, including KYC/AML regulations;
            </li>
            <li>
              <strong className="text-text">Legitimate interest:</strong> processing necessary for fraud prevention, security, analytics, and service improvement;
            </li>
            <li>
              <strong className="text-text">Consent:</strong> where required by applicable law, we obtain your consent before processing.
            </li>
          </ul>
        </section>

        <section>
          <h2>5. Information Sharing and Disclosure</h2>
          <p>
            We do not sell your personal information. We may share your
            information in the following circumstances:
          </p>
          <ul>
            <li>
              <strong className="text-text">Service providers:</strong> third-party vendors who assist us in operating the Platform, processing payments, verifying identities, and providing customer support, subject to confidentiality obligations;
            </li>
            <li>
              <strong className="text-text">Legal requirements:</strong> when required by law, regulation, legal process, or governmental request;
            </li>
            <li>
              <strong className="text-text">Protection of rights:</strong> when necessary to protect the rights, property, or safety of Sooq, our users, or others;
            </li>
            <li>
              <strong className="text-text">Business transfers:</strong> in connection with a merger, acquisition, reorganization, or sale of assets, where your information may be transferred as a business asset;
            </li>
            <li>
              <strong className="text-text">With your consent:</strong> when you have given us explicit permission to share your information.
            </li>
          </ul>
        </section>

        <section>
          <h2>6. Data Retention</h2>
          <p>
            We retain your personal information for as long as your account is
            active or as needed to provide services. We also retain information
            as necessary to comply with legal obligations, resolve disputes,
            enforce agreements, and for legitimate business purposes.
          </p>
          <p className="mt-2">
            Financial transaction records are retained for a minimum of seven
            (7) years in accordance with applicable anti-money laundering
            regulations. Upon account closure, we may retain certain information
            as required by law.
          </p>
        </section>

        <section>
          <h2>7. Data Security</h2>
          <p>
            We implement appropriate technical and organizational security
            measures to protect your personal information against unauthorized
            access, alteration, disclosure, or destruction. These measures
            include:
          </p>
          <ul>
            <li>Encryption of data in transit and at rest;</li>
            <li>Access controls and authentication mechanisms;</li>
            <li>Regular security assessments and monitoring;</li>
            <li>Employee training on data protection practices.</li>
          </ul>
          <p className="mt-2">
            However, no method of transmission or storage is completely secure.
            While we strive to protect your information, we cannot guarantee
            absolute security.
          </p>
        </section>

        <section>
          <h2>8. Your Rights</h2>
          <p>
            Depending on your jurisdiction, you may have the following rights
            regarding your personal information:
          </p>
          <ul>
            <li>
              <strong className="text-text">Access:</strong> request a copy of the personal information we hold about you;
            </li>
            <li>
              <strong className="text-text">Correction:</strong> request correction of inaccurate or incomplete information;
            </li>
            <li>
              <strong className="text-text">Deletion:</strong> request deletion of your personal information, subject to legal retention requirements;
            </li>
            <li>
              <strong className="text-text">Portability:</strong> request a copy of your data in a structured, machine-readable format;
            </li>
            <li>
              <strong className="text-text">Objection:</strong> object to the processing of your information for certain purposes;
            </li>
            <li>
              <strong className="text-text">Withdrawal of consent:</strong> withdraw consent at any time, where processing is based on consent.
            </li>
          </ul>
          <p className="mt-2">
            To exercise any of these rights, please contact us using the
            information provided in Section 13. We will respond to your request
            within a reasonable timeframe and in accordance with applicable law.
          </p>
        </section>

        <section>
          <h2>9. Cookies and Tracking Technologies</h2>
          <p>
            We use cookies and similar technologies to enhance your experience,
            analyze usage, and assist in our marketing efforts. These include:
          </p>
          <ul>
            <li>
              <strong className="text-text">Essential cookies:</strong> required for the Platform to function, including authentication and session management;
            </li>
            <li>
              <strong className="text-text">Analytics cookies:</strong> help us understand how users interact with the Platform;
            </li>
            <li>
              <strong className="text-text">Performance cookies:</strong> used to monitor and improve Platform performance.
            </li>
          </ul>
          <p className="mt-2">
            You can manage your cookie preferences through your browser
            settings. Disabling certain cookies may affect your ability to use
            some features of the Platform.
          </p>
        </section>

        <section>
          <h2>10. International Data Transfers</h2>
          <p>
            Your information may be transferred to and processed in countries
            other than your country of residence, including the British Virgin
            Islands and other jurisdictions where our service providers operate.
            We ensure that appropriate safeguards are in place to protect your
            information in accordance with this Privacy Policy and applicable
            law.
          </p>
        </section>

        <section>
          <h2>11. Children&rsquo;s Privacy</h2>
          <p>
            The Platform is not intended for individuals under the age of 18. We
            do not knowingly collect personal information from children. If we
            become aware that we have collected information from a child, we
            will take steps to delete that information promptly.
          </p>
        </section>

        <section>
          <h2>12. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. Material
            changes will be notified through the Platform or via the contact
            information associated with your account. The &quot;Last
            updated&quot; date at the top of this page indicates when the policy
            was last revised. Your continued use of the Platform after any
            changes constitutes acceptance of the updated Privacy Policy.
          </p>
        </section>

        <section>
          <h2>13. Contact Us</h2>
          <p>
            If you have any questions, concerns, or requests regarding this
            Privacy Policy or our data practices, please contact us at:
          </p>
          <p className="mt-2">
            <strong className="text-text">Sooq Exchange Ltd.</strong>
            <br />
            Craigmuir Chambers, Road Town
            <br />
            Tortola, VG1110
            <br />
            British Virgin Islands
            <br />
            Email: privacy@sooq.exchange
          </p>
          <p className="mt-2">
            For data protection inquiries, you may also contact our Data
            Protection Officer at dpo@sooq.exchange.
          </p>
        </section>
      </div>
    </div>
  );
}
