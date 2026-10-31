import { Link } from 'react-router-dom';
import { PageTitle } from '../components/ui';

const Shell = ({ title, sub, children }) => (
  <article className="container-x max-w-3xl py-8">
    <PageTitle title={title} sub={sub} />
    <div className="mt-6 space-y-5 text-[15px] leading-7 text-ink/75">{children}</div>
  </article>
);

export function About() {
  return <Shell title="About FameVote" sub="An independent space for community-led celebrity fan voting and rankings.">
    <p>FameVote is an independent fan-voting platform focused on monthly community participation and celebrity rankings in India. People can explore categories, view public rankings and published results, and participate in campaigns when voting is open.</p>
    <p>FameVote is not an official award body, talent agency, celebrity representative or government organization. Names, images and other identifying references are used to identify the public figures being discussed; their appearance does not imply endorsement or affiliation.</p>
    <p>Our platform explains its voting process in <Link className="font-semibold text-brand underline" to="/how-it-works">How it works</Link> and publishes information about result handling in <Link className="font-semibold text-brand underline" to="/voting-integrity">Voting integrity</Link>.</p>
  </Shell>;
}

export function Contact() {
  return <Shell title="Contact & Support" sub="For help with your account, a vote, a receipt or information on this platform.">
    <p>For account or voting questions, use the support contact published by the FameVote operator on the website or in official FameVote communications.</p>
    <p><strong>Operator action required:</strong> publish and maintain a monitored support email address and, where applicable, a business correspondence address here before promoting the service. Do not rely on an unattended inbox.</p>
    <p>When reporting a problem, do not send passwords, one-time passcodes or full payment-card details. Include only the minimum information needed to identify the issue.</p>
  </Shell>;
}

export function Privacy() {
  return <Shell title="Privacy Policy" sub="A plain-language overview of information used by the FameVote service.">
    <p>FameVote may process information needed to operate accounts and voting, such as account and profile details, selected state, authentication records, voting activity, payment status and receipt references. The exact information depends on the features you use and the services configured by the operator.</p>
    <p>Information is used to provide account access, enforce campaign rules, prevent duplicate or abusive activity, maintain voting records, provide receipts, respond to support requests and operate the website.</p>
    <p>Some service providers may process information on the operator's behalf, such as hosting, database, image storage, authentication, email or payment providers where those integrations are enabled. Their own terms and privacy notices may also apply.</p>
    <p>Do not publish private account details, authentication tokens or personal voting records. Public rankings should contain only information intentionally made public by the platform.</p>
    <p><strong>Operator action required:</strong> before launch, have this policy reviewed against the production configuration. Add the operator's legal identity, contact details, applicable retention periods, actual provider list, data-subject request process and effective date. This template is not legal advice.</p>
  </Shell>;
}

export function Terms() {
  return <Shell title="Terms & Conditions" sub="Conditions for accessing and using FameVote.">
    <p>By using FameVote, you agree to use the service lawfully, provide accurate account information and protect your sign-in credentials. You must not attempt to disrupt the service, manipulate rankings, create duplicate or deceptive accounts, exploit vulnerabilities or interfere with other users.</p>
    <p>Campaign availability, eligibility, voting limits, deadlines and result publication are described on the website and may vary by campaign. A submitted vote is subject to server-side validation and the published campaign rules.</p>
    <p>FameVote may investigate suspicious activity and take proportionate action under its voting rules. Where a decision affects a vote or result, the platform should retain an appropriate administrative record.</p>
    <p>The platform is independent and is not affiliated with or endorsed by any celebrity, public figure, award organizer or rights holder unless expressly stated with verifiable authorization.</p>
    <p><strong>Operator action required:</strong> add the operator's legal identity, governing law, dispute process, limitation clauses and effective date after obtaining appropriate legal review. This template is not legal advice.</p>
  </Shell>;
}

export function VotingRules() {
  return <Shell title="Voting Rules & Guidelines" sub="The core participation rules for FameVote campaigns.">
    <ul className="list-disc space-y-2 pl-6">
      <li>You need an account to participate in voting campaigns.</li>
      <li>Each category permits one confirmed vote per user per campaign, subject to the campaign's published rules.</li>
      <li>Campaign start and end times are determined by the platform's server clock and displayed campaign schedule.</li>
      <li>Only votes that pass server-side validation are counted in rankings.</li>
      <li>Rankings may be provisional while a campaign is active. Published winners appear after campaign results are finalized.</li>
      <li>Do not use bots, scripts, multiple deceptive accounts or other methods intended to manipulate results.</li>
    </ul>
    <p>Read <Link className="font-semibold text-brand underline" to="/how-it-works">How it works</Link> and <Link className="font-semibold text-brand underline" to="/voting-integrity">Voting integrity</Link> for additional detail. If campaign-specific rules differ, the rules shown for that campaign take precedence.</p>
  </Shell>;
}
