import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Sooq",
  description: "Terms of Service for Sooq prediction market platform.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen pt-12 pb-24 max-w-[800px] mx-auto">
      <h1 className="font-satoshi text-3xl md:text-4xl font-black text-text tracking-tight mb-2">
        Terms of Service
      </h1>
      <p className="text-muted-custom text-sm mb-10">
        Last updated: April 15, 2026
      </p>

      <div className="space-y-8 text-text text-sm leading-relaxed [&_h2]:font-satoshi [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-text [&_h2]:mb-3 [&_p]:text-muted-custom [&_ul]:text-muted-custom [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:text-muted-custom [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1">
        <section>
          <h2>1. Agreement to Terms</h2>
          <p>
            These Terms of Service (&quot;Terms&quot;) constitute a legally
            binding agreement between you (&quot;User,&quot; &quot;you,&quot; or
            &quot;your&quot;) and Sooq Exchange Ltd. (&quot;Sooq,&quot;
            &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), a company
            incorporated under the laws of the British Virgin Islands with
            registered address at Craigmuir Chambers, Road Town, Tortola, VG1110,
            British Virgin Islands.
          </p>
          <p className="mt-2">
            By accessing or using the Sooq platform, mobile application, or any
            related services (collectively, the &quot;Platform&quot;), you
            acknowledge that you have read, understood, and agree to be bound by
            these Terms. If you do not agree to these Terms, you must not access
            or use the Platform.
          </p>
        </section>

        <section>
          <h2>2. Eligibility</h2>
          <p>To use the Platform, you must:</p>
          <ul>
            <li>Be at least 18 years of age or the age of majority in your jurisdiction, whichever is greater;</li>
            <li>Have the legal capacity to enter into a binding agreement;</li>
            <li>Not be a resident or national of any jurisdiction where the use of prediction markets is prohibited or restricted by law;</li>
            <li>Not be listed on any governmental sanctions list or otherwise subject to trade restrictions;</li>
            <li>Provide accurate and complete registration information.</li>
          </ul>
          <p className="mt-2">
            We reserve the right to verify your identity and eligibility at any
            time. Failure to provide requested verification may result in
            suspension or termination of your account.
          </p>
        </section>

        <section>
          <h2>3. Account Registration and Security</h2>
          <p>
            You are required to register an account to use certain features of
            the Platform. You agree to:
          </p>
          <ul>
            <li>Provide accurate, current, and complete information during registration;</li>
            <li>Maintain and promptly update your account information;</li>
            <li>Maintain the security and confidentiality of your login credentials;</li>
            <li>Notify us immediately of any unauthorized use of your account;</li>
            <li>Accept responsibility for all activities that occur under your account.</li>
          </ul>
          <p className="mt-2">
            You may not transfer, sell, or assign your account to any third
            party. We reserve the right to suspend or terminate accounts that we
            reasonably believe are being used in violation of these Terms.
          </p>
        </section>

        <section>
          <h2>4. Platform Description</h2>
          <p>
            Sooq operates a prediction market exchange where users can trade
            shares representing the likelihood of real-world events occurring.
            The Platform utilizes an automated market maker (&quot;AMM&quot;)
            to facilitate trading. Share prices reflect the market&rsquo;s
            aggregate assessment of the probability of a given outcome.
          </p>
          <p className="mt-2">
            Trading on the Platform involves real monetary value. Shares are
            denominated in US Dollars (USD). Winning shares pay out $1.00 per
            share (less applicable fees) upon resolution. Losing shares expire
            worthless.
          </p>
        </section>

        <section>
          <h2>5. Deposits and Withdrawals</h2>
          <p>
            Users may fund their accounts through the payment methods available
            on the Platform, which may include mobile payment services and
            cryptocurrency transfers. All deposits are subject to verification
            and applicable processing times.
          </p>
          <p className="mt-2">
            Withdrawal requests are processed within a reasonable timeframe,
            subject to identity verification and compliance checks. We reserve
            the right to delay or refuse withdrawals where we suspect fraudulent
            activity, money laundering, or violation of these Terms.
          </p>
          <p className="mt-2">
            Promotional credits or bonuses are subject to wagering requirements
            as specified at the time of issuance. Such credits may not be
            withdrawn until the applicable requirements are met.
          </p>
        </section>

        <section>
          <h2>6. Trading Rules</h2>
          <p>By placing trades on the Platform, you acknowledge and agree that:</p>
          <ul>
            <li>All trades are final once executed and cannot be reversed;</li>
            <li>Prices are determined by the AMM algorithm and fluctuate based on supply and demand;</li>
            <li>There is no guarantee of profit, and you may lose some or all of your deposited funds;</li>
            <li>Applicable fees (including trading fees, resolution fees, and spread) are deducted automatically;</li>
            <li>We reserve the right to impose position limits, trading restrictions, or market-specific rules;</li>
            <li>Markets may be voided or resolved at our sole discretion based on the resolution criteria specified for each market.</li>
          </ul>
        </section>

        <section>
          <h2>7. Market Resolution</h2>
          <p>
            Each market on the Platform has defined resolution criteria
            specified at the time of creation. We will resolve markets based on
            publicly verifiable information in accordance with those criteria.
          </p>
          <p className="mt-2">
            In the event of ambiguity, unavailability of resolution sources, or
            extraordinary circumstances, we reserve the right to void a market
            and return all funds to traders (less any fees already incurred). Our
            resolution decisions are final and binding.
          </p>
        </section>

        <section>
          <h2>8. Fees</h2>
          <p>
            The Platform charges fees on certain transactions, including but not
            limited to trading fees, resolution fees, and withdrawal fees. The
            applicable fee schedule is available on the Platform and may be
            updated from time to time. By using the Platform, you agree to pay
            all applicable fees.
          </p>
        </section>

        <section>
          <h2>9. Referral and Agent Program</h2>
          <p>
            The Platform may offer referral and agent programs through which
            users can earn commissions by referring new users. Participation in
            such programs is subject to additional terms and conditions,
            including activation thresholds and compliance requirements.
          </p>
          <p className="mt-2">
            We reserve the right to modify, suspend, or terminate any referral
            or agent program at any time. Commissions earned through fraudulent
            or abusive activity will be forfeited.
          </p>
        </section>

        <section>
          <h2>10. Prohibited Conduct</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use the Platform for money laundering, terrorist financing, or any other illegal purpose;</li>
            <li>Manipulate markets through coordinated trading, wash trading, or dissemination of false information;</li>
            <li>Use automated systems, bots, or scripts to interact with the Platform without our express written consent;</li>
            <li>Attempt to exploit system vulnerabilities, reverse-engineer the Platform, or interfere with its operation;</li>
            <li>Create multiple accounts or use another person&rsquo;s account;</li>
            <li>Circumvent geographic restrictions, identity verification, or any security measures;</li>
            <li>Engage in any activity that could damage, disable, or impair the Platform.</li>
          </ul>
        </section>

        <section>
          <h2>11. Intellectual Property</h2>
          <p>
            All content, trademarks, logos, software, and other intellectual
            property on the Platform are owned by or licensed to Sooq Exchange
            Ltd. You may not reproduce, distribute, modify, or create derivative
            works from any content on the Platform without our prior written
            consent.
          </p>
        </section>

        <section>
          <h2>12. Risk Disclosure</h2>
          <p>
            Trading prediction markets involves substantial risk. You should
            only trade with funds you can afford to lose. The value of shares
            can go to zero. Past performance of any market or trader is not
            indicative of future results. You are solely responsible for your
            trading decisions.
          </p>
          <p className="mt-2">
            We do not provide investment advice, trading recommendations, or
            financial guidance. Nothing on the Platform should be construed as
            such.
          </p>
        </section>

        <section>
          <h2>13. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by applicable law, Sooq Exchange
            Ltd., its directors, officers, employees, and agents shall not be
            liable for any indirect, incidental, special, consequential, or
            punitive damages, including loss of profits, data, or goodwill,
            arising out of or related to your use of the Platform.
          </p>
          <p className="mt-2">
            Our total aggregate liability for any claims arising from or related
            to these Terms or the Platform shall not exceed the amount of fees
            paid by you to us in the twelve (12) months preceding the claim.
          </p>
        </section>

        <section>
          <h2>14. Indemnification</h2>
          <p>
            You agree to indemnify, defend, and hold harmless Sooq Exchange
            Ltd. and its affiliates, directors, officers, employees, and agents
            from and against any claims, liabilities, damages, losses, and
            expenses (including reasonable legal fees) arising out of your use
            of the Platform, violation of these Terms, or infringement of any
            third-party rights.
          </p>
        </section>

        <section>
          <h2>15. Modifications to the Platform and Terms</h2>
          <p>
            We reserve the right to modify, suspend, or discontinue any aspect
            of the Platform at any time without prior notice. We may also update
            these Terms from time to time. Material changes will be notified
            through the Platform or via the contact information associated with
            your account. Your continued use of the Platform after such changes
            constitutes acceptance of the modified Terms.
          </p>
        </section>

        <section>
          <h2>16. Termination</h2>
          <p>
            We may suspend or terminate your access to the Platform at any time,
            with or without cause, and with or without notice. Upon termination,
            your right to use the Platform ceases immediately. Any outstanding
            balances will be handled in accordance with applicable law and our
            withdrawal policies, subject to any deductions for fees, penalties,
            or amounts owed.
          </p>
        </section>

        <section>
          <h2>17. Governing Law and Dispute Resolution</h2>
          <p>
            These Terms shall be governed by and construed in accordance with
            the laws of the British Virgin Islands, without regard to its
            conflict of laws principles.
          </p>
          <p className="mt-2">
            Any dispute arising out of or relating to these Terms or the
            Platform shall first be attempted to be resolved through good-faith
            negotiation. If the dispute cannot be resolved within thirty (30)
            days, it shall be submitted to binding arbitration administered in
            accordance with the rules of the BVI International Arbitration
            Centre, with the seat of arbitration in Road Town, Tortola, British
            Virgin Islands.
          </p>
        </section>

        <section>
          <h2>18. Severability</h2>
          <p>
            If any provision of these Terms is found to be unenforceable or
            invalid, that provision shall be limited or eliminated to the
            minimum extent necessary, and the remaining provisions shall remain
            in full force and effect.
          </p>
        </section>

        <section>
          <h2>19. Entire Agreement</h2>
          <p>
            These Terms, together with the Privacy Policy and any other
            agreements expressly referenced herein, constitute the entire
            agreement between you and Sooq Exchange Ltd. regarding your use of
            the Platform.
          </p>
        </section>

        <section>
          <h2>20. Contact</h2>
          <p>
            For questions or concerns regarding these Terms, please contact us
            at:
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
            Email: legal@sooq.exchange
          </p>
        </section>
      </div>
    </div>
  );
}
