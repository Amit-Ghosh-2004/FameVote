import { Link } from 'react-router-dom';
import { PageTitle } from '../components/ui';

const Shell = ({ title, sub, children }) => (
  <article className="container-x max-w-3xl py-8">
    <PageTitle title={title} sub={sub} />
    <div className="mt-6 space-y-5 text-[15px] leading-7 text-ink/75">{children}</div>
  </article>
);
const Support = () => <a className="font-semibold text-brand underline" href="mailto:famevote@gmail.com">famevote@gmail.com</a>;

export function About() {
  return <Shell title="About FameVote" sub="An independent space for community-led celebrity fan voting and rankings.">
    <p>FameVote is an independent fan-voting platform focused on community participation and celebrity rankings in India. People can explore categories, view public rankings and published results, and participate in campaigns when voting is open.</p>
    <p>FameVote is operated as an individual project in India. It is not an official award body, talent agency, celebrity representative or government organization. Names, images and other identifying references are used to identify public figures and do not imply endorsement or affiliation.</p>
    <p>Free voting is available to eligible account holders, including users under 18 subject to applicable child-safety and parental-consent requirements. Paid voting and all payment features are strictly limited to adults aged 18 or above.</p>
    <p>Learn more in <Link className="font-semibold text-brand underline" to="/how-it-works">How it works</Link> and <Link className="font-semibold text-brand underline" to="/voting-integrity">Voting integrity</Link>.</p>
  </Shell>;
}

export function Contact() {
  return <Shell title="Contact & Support" sub="Help with your account, votes, payments, refunds or privacy requests.">
    <p><strong>FameVote operator:</strong> Independent individual operator, India.</p>
    <p><strong>Support email:</strong> <Support /></p>
    <p>For account deletion, privacy requests, payment issues, failed votes or complaints, email us from the address associated with your account where possible. Include the relevant campaign, approximate transaction date and receipt/reference number. Never send passwords, OTPs or full card details.</p>
    <p>FameVote does not publish a public street address. Email is the primary support and grievance contact.</p>
  </Shell>;
}

export function Privacy() {
  return <Shell title="Privacy Policy" sub="How FameVote handles personal information.">
    <p><strong>Effective date:</strong> 31 October 2026.</p>
    <p><strong>Who operates FameVote:</strong> FameVote is operated by an independent individual in India. For privacy questions or requests, contact <Support />.</p>
    <h2 className="text-lg font-bold text-ink">Information we may process</h2>
    <p>Depending on the features used, this may include name, email address, verified phone number, state or region, profile image, account/authentication data, date-of-birth or age-eligibility information, votes and campaign activity, payment and refund status, receipt/reference identifiers, device/security logs and messages sent to support.</p>
    <h2 className="text-lg font-bold text-ink">Why we use it</h2>
    <p>We use information to create and secure accounts, provide free voting, validate campaign eligibility and vote limits, prevent fraud and manipulation, process adult payments, issue receipts and refunds, provide support, maintain service security and comply with legal obligations.</p>
    <h2 className="text-lg font-bold text-ink">Children and age restrictions</h2>
    <p>Users under 18 may use free voting only. Paid voting, payment checkout and other paid features are restricted to people aged 18 or above. Users under 13 may create accounts and cast free votes only where the required verifiable consent of a parent or lawful guardian has been obtained. We do not permit under-18 users to make payments or participate in paid voting. We do not intentionally use children's personal data for targeted advertising or behavioural tracking. If you are a parent or guardian and believe a child's information has been submitted without appropriate consent, contact <Support />.</p>
    <p>India's Digital Personal Data Protection Act, 2023 defines a child as a person under 18. Its child-data provisions are scheduled to commence 18 months after the 13 November 2025 commencement notification (13 May 2027). FameVote intends to prepare for those requirements; this statement is not a representation that a complete parental-consent verification system is already implemented.</p>
    <h2 className="text-lg font-bold text-ink">Service providers and sharing</h2>
    <p>Information may be processed by providers used to host the website and API, store the database and images, authenticate users, send email or SMS, and process payments. Depending on production configuration, these may include Vercel, Render, MongoDB Atlas, Cloudinary, Google, Brevo, SMS providers and Razorpay. Providers receive only information needed for their service. We do not sell personal information.</p>
    <h2 className="text-lg font-bold text-ink">Retention and security</h2>
    <p>We retain information for as long as reasonably necessary to operate accounts, preserve vote integrity, resolve disputes, maintain financial records and meet legal requirements. Retention periods vary by record type; some voting, security and transaction records may need to be retained after account closure. We use reasonable technical and organizational safeguards, but no online service can guarantee absolute security.</p>
    <h2 className="text-lg font-bold text-ink">Your choices and requests</h2>
    <p>You may request access, correction or deletion of account information by emailing <Support />. We may need to verify the request. Deletion may be subject to legal retention, fraud-prevention and vote-integrity requirements; where full deletion is not possible, we will explain the reason and limit further use where appropriate. Parents or lawful guardians may contact us about a child's information.</p>
    <h2 className="text-lg font-bold text-ink">Changes</h2>
    <p>We may update this policy as the service or legal requirements change. The latest version will be published on this page with its effective date.</p>
  </Shell>;
}

export function Terms() {
  return <Shell title="Terms & Conditions" sub="Conditions for accessing and using FameVote.">
    <p><strong>Effective date:</strong> 31 October 2026. FameVote is operated by an independent individual in India. Questions and complaints may be sent to <Support />.</p>
    <h2 className="text-lg font-bold text-ink">Eligibility and age rules</h2>
    <p>You must provide accurate information and use only an account you are authorized to use. Users under 18 may create accounts and participate in free voting only, subject to applicable parental-consent requirements. Users under 13 may use the service only with the required verifiable consent of a parent or lawful guardian. Paid voting, payment checkout and all paid features are strictly restricted to adults aged 18 or above. Do not use another person's identity or date of birth to bypass these rules.</p>
    <h2 className="text-lg font-bold text-ink">Voting and campaigns</h2>
    <p>Campaign availability, categories, eligibility, vote limits, deadlines and result publication are described on the website and may vary by campaign. Each category permits one confirmed vote per user per campaign, subject to the published campaign rules. Only votes that pass server-side validation are counted. Campaign schedules use the platform's server clock. Rankings may be provisional until results are finalized.</p>
    <h2 className="text-lg font-bold text-ink">Paid votes, failed votes and refunds</h2>
    <p>Paid voting is available only to users aged 18 or above. A payment does not guarantee a particular ranking or result. If a paid vote fails, is rejected, or cannot be counted, FameVote will arrange a refund of the corresponding payment. Refund processing may depend on the payment provider and banking timelines. Contact <Support /> with the receipt/reference number if a refund has not appeared.</p>
    <h2 className="text-lg font-bold text-ink">Acceptable use and enforcement</h2>
    <p>You must not use bots, scripts, duplicate or deceptive accounts, exploit vulnerabilities, manipulate rankings, disrupt the service or interfere with other users. FameVote may investigate suspicious activity and take proportionate action, including rejecting invalid votes or suspending accounts, consistent with applicable law and campaign rules.</p>
    <h2 className="text-lg font-bold text-ink">Independent platform; changes</h2>
    <p>FameVote is not affiliated with or endorsed by any celebrity, public figure, award organizer or rights holder unless expressly stated with verifiable authorization. We may update campaigns, features or these terms. Material changes will be reflected on this page.</p>
    <p>These terms are intended to be read subject to applicable laws of India. This page is a service notice and is not a substitute for advice from an Indian lawyer; obtain legal review before enabling paid voting.</p>
  </Shell>;
}

export function VotingRules() {
  return <Shell title="Voting Rules & Guidelines" sub="The core participation rules for FameVote campaigns.">
    <ul className="list-disc space-y-2 pl-6">
      <li>An account is required to participate in voting campaigns.</li>
      <li>Users under 18 may cast free votes only. Paid voting is strictly 18+.</li>
      <li>Users under 13 may create accounts and cast free votes only where required verifiable parent or guardian consent has been obtained.</li>
      <li>Each category permits one confirmed vote per user per campaign, subject to campaign-specific rules.</li>
      <li>Campaign start and end times are determined by the platform's server clock.</li>
      <li>Only votes that pass server-side validation are counted in rankings.</li>
      <li>If a paid vote fails, is rejected or cannot be counted, the corresponding payment is refundable.</li>
      <li>Do not use bots, scripts, multiple deceptive accounts or other methods intended to manipulate results.</li>
    </ul>
    <p>Read <Link className="font-semibold text-brand underline" to="/how-it-works">How it works</Link> and <Link className="font-semibold text-brand underline" to="/voting-integrity">Voting integrity</Link> for additional detail. Campaign-specific rules displayed on the campaign page also apply.</p>
  </Shell>;
}
