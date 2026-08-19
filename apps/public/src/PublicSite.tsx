import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity, ArrowRight, Brain, Check, ChevronRight, Clock3, Flower2,
  Globe2, HeartHandshake, HeartPulse, Leaf, Menu, MoonStar, Orbit, PackageCheck,
  Mail, ShieldCheck, ShieldPlus, Sparkles, Stethoscope, UserRoundCheck, Video, X,
} from 'lucide-react';
import './public-site.css';

const MARK = '/holistic-health-hub-mark.png';
const HERO_IMAGE = '/hhh-consultation-hero.jpg';
const WELLBEING_IMAGE = '/hhh-wellbeing-couple.jpg';
const ELIGIBILITY_IMAGE = '/hhh-eligibility-check.jpg';
const SPECIALIST_IMAGE = '/hhh-specialist-consult.jpg';
const PHARMACY_IMAGE = '/hhh-pharmacy-care.jpg';

const posts = [
  {
    slug: 'sleep-easy-7-ways-to-get-a-better-nights-rest-naturally',
    title: 'Sleep Easy - 7 ways to get a better nights rest naturally',
    author: 'Holistic Health Hub', date: 'Mar 15, 2024', read: '5 min read', category: 'Sleep', art: 'sleep',
    excerpt: 'Today is World Sleep Day—the annual celebration of healthy sleeping patterns and awareness day for sleep disorders.',
    body: ['A good night’s sleep supports physical recovery, mood and concentration. Small, repeatable changes to your routine can make a meaningful difference.', 'Keep a regular bedtime, create a calm and dark sleep environment, reduce late caffeine and screen time, and make room for gentle movement during the day.', 'If poor sleep is persistent or affecting daily life, speak to a healthcare professional. The right support should always be tailored to you.'],
  },
  {
    slug: 'cannabis-for-anxiety-what-you-need-to-know',
    title: 'Medical Cannabis for Anxiety: What You Need to Know',
    author: 'Holistic Health Hub', date: 'Feb 14, 2024', read: '5 min read', category: 'Mental wellbeing', art: 'anxiety',
    excerpt: 'In today’s fast-paced world, anxiety has emerged as a silent shadow, affecting millions globally.',
    body: ['Anxiety can affect sleep, work, relationships and physical wellbeing. Treatment may include talking therapies, lifestyle support and licensed medicines.', 'Cannabis-based products for medicinal use are prescription-only medicines. A specialist doctor must assess whether they are appropriate after conventional treatment options have been explored.', 'Benefits and side effects vary from person to person. A careful clinical review and ongoing monitoring are essential.'],
  },
  {
    slug: 'navigating-pain-relief-the-role-of-medical-cannabis-in-chronic-pain-management',
    title: 'Navigating Pain Relief: The Role of Medical Cannabis in Chronic Pain Management',
    author: 'Shaylen Patel', date: 'Jan 31, 2024', read: '3 min read', category: 'Pain', art: 'pain',
    excerpt: 'Chronic pain represents a profound challenge in healthcare, persisting far beyond the expected period of healing.',
    body: ['Chronic pain is complex and can affect every part of daily life. Effective care often brings together physical, psychological and medical approaches.', 'The body’s endocannabinoid system plays a role in pain signalling and inflammation. This is one reason specialist clinicians continue to study cannabis-based medicines for selected patients.', 'Treatment decisions should be evidence-led, individual and regularly reviewed by a specialist.'],
  },
  {
    slug: 'the-endocannabinoid-system-bringing-your-body-back-to-balance',
    title: 'The Endocannabinoid System: Bringing your body back to balance',
    author: 'Shaylen Patel', date: 'Jan 26, 2024', read: '2 min read', category: 'CBPM 101', art: 'balance',
    excerpt: 'The endocannabinoid system is a complex cell-signalling system involved in establishing and maintaining balance.',
    body: ['The endocannabinoid system is found throughout the body and helps regulate processes including appetite, mood, sleep, memory and pain.', 'Endocannabinoids, receptors and enzymes work together to help maintain balance. Plant cannabinoids may interact with parts of this system in different ways.', 'Research is still developing, so clinical advice and appropriate monitoring remain vital.'],
  },
] as const;

function PublicLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return <a className={className} href={href}>{children}</a>;
}

function SiteHeader() {
  const [open, setOpen] = useState(false);
  const path = window.location.pathname;
  return <header className="hhh-header"><div className="hhh-header__inner">
    <PublicLink href="/" className="hhh-mark"><img src={MARK} alt="" /><span><strong>Holistic Health Hub</strong><small>Personalised healthcare</small></span></PublicLink>
    <button className="hhh-menu-toggle" type="button" aria-expanded={open} aria-controls="public-navigation" onClick={() => setOpen(value => !value)}>{open ? <X /> : <Menu />}<span className="sr-only">Menu</span></button>
    <nav id="public-navigation" className={`hhh-nav ${open ? 'is-open' : ''}`} aria-label="Primary navigation">
      <PublicLink href="/" className={path === '/' ? 'is-active' : ''}>Home</PublicLink>
      <PublicLink href="/how-it-works" className={path === '/how-it-works' ? 'is-active' : ''}>How it works</PublicLink>
      <PublicLink href="/conditions" className={path === '/conditions' ? 'is-active' : ''}>Conditions</PublicLink>
      <PublicLink href="/pricing" className={path === '/pricing' ? 'is-active' : ''}>Pricing</PublicLink>
      <PublicLink href="/blog" className={path.startsWith('/blog') || path.startsWith('/post/') ? 'is-active' : ''}>Blog</PublicLink>
      <PublicLink href="/faq" className={path === '/faq' ? 'is-active' : ''}>FAQs</PublicLink>
      <PublicLink href="/contact" className={path === '/contact' ? 'is-active' : ''}>Contact</PublicLink>
      <PublicLink href="/eligibility" className="hhh-button hhh-button--pale">Check eligibility</PublicLink>
    </nav>
  </div></header>;
}

function SiteFooter() {
  return <footer className="hhh-footer"><div className="hhh-footer__inner">
    <div className="hhh-footer__brand"><img src={MARK} alt="" /><p>Personalised specialist care, connected to trusted community pharmacies.</p><small>© {new Date().getFullYear()} Holistic Health Hub.</small></div>
    <div><strong>About</strong><PublicLink href="/about">Our mission</PublicLink><PublicLink href="/conditions">Treatable conditions</PublicLink><PublicLink href="/pricing">Pricing</PublicLink></div>
    <div><strong>Contact</strong><PublicLink href="/contact">info@holistichealthhub.live</PublicLink><span className="hhh-social"><a href="https://www.instagram.com/holistichealthhub1" aria-label="Instagram">ig</a><a href="https://www.facebook.com/profile.php?id=61555967331192" aria-label="Facebook">f</a></span></div>
    <div><strong>Legal</strong><PublicLink href="/privacy">Privacy policy</PublicLink><PublicLink href="/faq">FAQs</PublicLink><PublicLink href="/consent">Consent</PublicLink></div>
  </div></footer>;
}

function PageShell({ children }: { children: ReactNode }) {
  useEffect(() => { document.body.classList.add('hhh-public-active'); window.scrollTo(0, 0); return () => document.body.classList.remove('hhh-public-active'); }, []);
  return <div className="hhh-public"><a className="hhh-skip" href="#main-content">Skip to main content</a><SiteHeader />{children}<SiteFooter /></div>;
}

const steps = [
  {
    image: ELIGIBILITY_IMAGE,
    imageAlt: 'Someone privately completing an eligibility check at home',
    icon: <img src={MARK} alt="" />,
    number: '01',
    title: 'Check eligibility',
    copy: 'Complete a short, secure form so HHH can review whether you may benefit from CBPM therapy. Your application stays with Holistic Health Hub first, including when you arrive through a pharmacy-specific link.',
  },
  {
    image: SPECIALIST_IMAGE,
    imageAlt: 'A specialist doctor speaking with a patient during an online consultation',
    icon: <Stethoscope />,
    number: '02',
    title: 'Online consultation',
    copy: 'A doctor who specialises in your condition assesses you. After the consultation, a multi-disciplinary team of doctors and pharmacists determines which CBPM treatment, if any, is appropriate.',
  },
  {
    image: PHARMACY_IMAGE,
    imageAlt: 'A community pharmacist speaking with a patient at the dispensary counter',
    icon: <PackageCheck />,
    number: '03',
    title: 'Receive treatment',
    copy: 'If prescribed, your prescription is sent to your nominated pharmacy, who contacts you to arrange payment and delivery or collection.',
  },
  {
    image: WELLBEING_IMAGE,
    imageAlt: 'A couple walking together in a garden',
    icon: <HeartHandshake />,
    number: '04',
    title: 'Ongoing support',
    copy: 'The quality of your care matters after the first appointment. Between HHH, your nominated pharmacy and the partnered clinic, support continues on your journey to health.',
  },
];

function HomePage() {
  return <PageShell><main id="main-content">
    <section className="hhh-hero hhh-reveal"><div className="hhh-section-inner hhh-hero__inner"><div className="hhh-hero__copy"><p className="hhh-kicker">Personalised healthcare</p><h1>Feel heard.<br />Find a way forward.</h1><p>At Holistic Health Hub, we are dedicated to improving your health and well-being. We offer access to specialist therapies, including comprehensive medical cannabis (CBPM) treatment programmes for a variety of conditions, provided by specialist healthcare professionals.</p><p>Get access to evidence-based treatment and compassionate care through our network of trusted partnered pharmacies and specialist clinic.</p><div className="hhh-hero__actions"><PublicLink href="/eligibility" className="hhh-button hhh-button--rust">Check your eligibility <ArrowRight /></PublicLink><PublicLink href="/how-it-works" className="hhh-text-link">See how it works <ChevronRight /></PublicLink></div><div className="hhh-hero__assurance"><span><ShieldCheck /> Private and secure</span><span><Stethoscope /> Specialist-led</span><span><HeartHandshake /> Pharmacy connected</span></div></div><div className="hhh-hero__media"><img src={HERO_IMAGE} alt="A clinician listening to a patient in a private consultation room" fetchPriority="high" /><div><span><HeartPulse /></span><p><strong>Care built around you</strong><small>From first questions to ongoing support</small></p></div></div></div></section>
    <section className="hhh-journey"><div className="hhh-section-inner"><p className="hhh-kicker">A clear route to care</p><h2>How it works in four simple steps</h2><div className="hhh-journey__grid">{steps.map(step => <article key={step.number}><figure><img src={step.image} alt={step.imageAlt} /><figcaption>{step.number}</figcaption></figure><div><h3>{step.title}</h3><p>{step.copy}</p></div></article>)}</div></div></section>
    <section className="hhh-network"><div className="hhh-section-inner"><p className="hhh-kicker">Who supports you</p><h2>HHH, a specialist clinic and your pharmacy, working together.</h2><div>{[['Holistic Health Hub','Reviews your eligibility, stays with you through intake and confirms the referral.'],['Specialist clinic','A doctor who specialises in your condition assesses you. Treatment decisions are clinical, not automatic.'],['Nominated pharmacy','Arranges payment, dispensing and delivery or collection once a prescription is issued.']].map(([title, copy]) => <article key={title}><h3>{title}</h3><p>{copy}</p></article>)}</div></div></section>
    <section className="hhh-benefits hhh-section-inner">{[{ icon: <Globe2 />, text: 'Online appointments that suit you' }, { icon: <Clock3 />, text: 'Personalised treatment options' }, { icon: <Video />, text: 'No GP referral required' }, { icon: <UserRoundCheck />, text: 'Access to specialist medical professionals' }, { icon: <HeartHandshake />, text: 'Dedicated patient support' }].map(item => <div key={item.text}><span>{item.icon}</span><p>{item.text}</p></div>)}</section>
    <section className="hhh-condition-feature"><div className="hhh-section-inner"><div className="hhh-condition-feature__top"><div><p className="hhh-kicker">Conditions we support</p><h2>Some of the conditions<br />we can help you with</h2></div><PublicLink className="hhh-button hhh-button--outline" href="/conditions">Which conditions can be treated?</PublicLink></div><div className="hhh-condition-card"><div className="hhh-condition-card__intro"><span><Activity /></span><h3>Pain</h3><p>For many of the 28 million people in the UK living with chronic pain, traditional painkillers like opioids aren’t always the answer. Holistic therapies such as medical cannabis offer alternative options.</p></div><div className="hhh-condition-card__body"><h4>How medical cannabis can help with pain</h4><p>Everybody has an endocannabinoid system (ECS) which plays a significant role in regulating pain, inflammation and other vital functions. Medical cannabis, which contains phytocannabinoids like THC and CBD, influences how the body responds to pain signals.</p><p className="hhh-condition-card__note">Pain-related conditions we can help you treat:</p><div className="hhh-tag-list">{['Arthritis','Back Pain','Chronic Pain','Cluster Headache','Complex Regional Pain Syndrome','Cancer-Related Pain','Ehlers-Danlos Syndromes (EDS)','Endometriosis','Fibromyalgia','Musculoskeletal Pain','Migraine','Neuropathic Pain','Palliative Care','Sciatica'].map(tag => <span key={tag}>{tag}</span>)}</div></div></div></div></section>
    <section className="hhh-key-benefits hhh-section-inner"><p className="hhh-kicker">Key benefits</p><div>{['Appointments with pain specialists','Alternative to opioids','Anti-inflammatory properties'].map((item, index) => <article key={item}><span>0{index + 1}</span><h3>{item}</h3><ChevronRight /></article>)}</div><PublicLink href="/eligibility" className="hhh-button hhh-button--rust">Check your eligibility today <ArrowRight /></PublicLink></section>
    <section className="hhh-testimonials"><div className="hhh-section-inner"><p className="hhh-kicker">Patient testimonials</p><div>{[['“I felt that I was listened to, and the different types of pain I was experiencing was understood and my treatment plan was tailored to suit my individual needs.”','Keasha'],['“It wasn’t until I saw my consultant that I felt properly listened to for the first time in years. The service I’ve received is second to none.”','Xavier'],['“Life with social anxiety and insomnia is horrendous. But my experience at the clinic has been amazing, they have been very understanding, a life saver.”','Kim']].map(([quote,name]) => <blockquote key={name}><p>{quote}</p><cite>{name}</cite></blockquote>)}</div></div></section>
    <section className="hhh-press" aria-label="As seen in"><div className="hhh-section-inner"><p className="hhh-kicker">As seen in</p><div>{['GOV.UK','Sky News','The Guardian'].map(name => <span key={name}>{name}</span>)}</div></div></section>
    <section className="hhh-trust-band"><div className="hhh-section-inner"><span><ShieldCheck /></span><div><p className="hhh-kicker">Thoughtful, responsible care</p><h2>Private treatment should still feel personal.</h2><p>Your eligibility check is only a starting point. A specialist clinician makes treatment decisions after an appropriate assessment, and your pharmacy remains part of the support around you.</p></div><PublicLink href="/about" className="hhh-button hhh-button--pale">Meet HHH</PublicLink></div></section>
    <section className="hhh-learn hhh-section-inner"><p className="hhh-kicker">Learn</p><div className="hhh-post-grid">{posts.slice(0,3).map(post => <PostCard key={post.slug} post={post} />)}</div><PublicLink href="/blog" className="hhh-text-link">Read all articles <ArrowRight /></PublicLink></section>
  </main></PageShell>;
}

function StandardHero({ children }: { children: ReactNode }) { return <section className="hhh-page-hero"><div className="hhh-section-inner">{children}</div></section>; }

function InnerPageHero({ eyebrow, title, copy, image, imageAlt, children }: { eyebrow: string; title: ReactNode; copy: string; image?: string; imageAlt?: string; children?: ReactNode }) {
  return <section className={`hhh-inner-hero${image ? ' hhh-inner-hero--with-image' : ''}`}><div className="hhh-section-inner"><div className="hhh-inner-hero__copy"><p className="hhh-kicker">{eyebrow}</p><h1>{title}</h1><p>{copy}</p>{children && <div className="hhh-inner-hero__actions">{children}</div>}</div>{image && <div className="hhh-inner-hero__media"><img src={image} alt={imageAlt ?? ''} /></div>}</div></section>;
}

const conditionGroups = [
  { title: 'Pain', icon: <Activity />, items: ['Arthritis','Back pain','Cancer-related pain','Chronic pain','Cluster headache','Complex regional pain syndrome','Ehlers-Danlos syndromes','Endometriosis','Fibromyalgia','Migraine','Musculoskeletal pain','Neuropathic pain','Sciatica'] },
  { title: 'Neurological', icon: <Brain />, items: ['Autistic spectrum disorder','Epilepsy (adult and child)','Multiple sclerosis','Parkinson’s disease','Tourette’s syndrome','Trigeminal neuralgia'] },
  { title: 'Psychiatric', icon: <Flower2 />, items: ['ADHD','Agoraphobia','Anxiety','Depression','Insomnia','Obsessive compulsive disorder','Post-traumatic stress disorder','Social phobia'] },
  { title: 'Other conditions', icon: <ShieldPlus />, items: ['Anorexia','Binge eating disorder','Bulimia nervosa','Cancer-related appetite loss','Chemotherapy-induced nausea and vomiting','Crohn’s disease','Eating disorders','Palliative care','Rare skin conditions','Ulcerative colitis'] },
];

function ConditionsPage() {
  return <PageShell><main id="main-content"><StandardHero><h1>Conditions that can be treated<br />with medical cannabis (CBPM)</h1></StandardHero><section className="hhh-conditions-intro"><div className="hhh-section-inner"><p>If you have tried 2 therapies/treatments for these conditions you may be eligible for referral</p><PublicLink className="hhh-button hhh-button--rust" href="/eligibility">Check eligibility</PublicLink></div></section><section className="hhh-condition-groups hhh-section-inner">{conditionGroups.map(group => <article key={group.title}><span>{group.icon}</span><h2>{group.title}</h2><ul>{group.items.map(item => <li key={item}><Check />{item}</li>)}</ul><PublicLink href="/eligibility">Check eligibility <ArrowRight /></PublicLink></article>)}</section><section className="hhh-wide-cta"><div><h2>What is the cost of treatment?</h2><PublicLink href="/pricing" className="hhh-button hhh-button--pale">View pricing</PublicLink></div></section></main></PageShell>;
}

function PricingPage() {
  return <PageShell><main id="main-content"><section className="hhh-pricing-head hhh-section-inner"><p className="hhh-kicker">Simple, transparent pricing</p><h1>Get the personalised care you deserve, at affordable prices.</h1><p>All appointments are with a consultant physician who specialises in your condition.</p><div className="hhh-price-grid">{[['Initial consultation','£30'],['Follow-up consultation','£30'],['Quarterly check-up','£30']].map(([label,price], index) => <article key={label}><span>0{index + 1}</span><h2>{label}</h2><strong>{price}</strong><small>Consultation fee</small></article>)}</div></section><section className="hhh-medication"><div className="hhh-section-inner"><p className="hhh-kicker">Medication</p><h2>Affordable medicine through your community pharmacy</h2><p>Indicative medicine prices; your exact treatment and costs are confirmed before you proceed.</p><div>{[['Flower','From £5.50 per gram'],['Oils','From £30 per 10ml bottle'],['Vape','From £49 per cartridge']].map(([name,price]) => <article key={name}><span><Leaf /></span><h3>{name}</h3><p>{price}</p></article>)}</div></div></section><section className="hhh-included hhh-section-inner"><div className="hhh-included__image"><img src={WELLBEING_IMAGE} alt="A couple enjoying a relaxed walk together" /></div><div><p className="hhh-kicker">What’s included in your care?</p><h2>Support that continues beyond your first appointment.</h2>{['Personalised treatment','Specialist care','Ongoing support','No waiting list'].map(item => <p className="hhh-included__item" key={item}><Check />{item}</p>)}<PublicLink href="/eligibility" className="hhh-button hhh-button--rust">Start your journey today</PublicLink></div></section><section className="hhh-timeline"><div className="hhh-section-inner"><p className="hhh-kicker">Your care timeline</p><h2>Your first months of care</h2><div>{[['Month 1','Initial consultation','£30'],['Month 2','Follow-up consultation','£30'],['Month 5','Quarterly check-up thereafter','£30']].map(([month,label,price]) => <article key={month}><span>{month}</span><h3>{label}</h3><strong>{price}</strong></article>)}</div></div></section></main></PageShell>;
}

function AboutPage() {
  return <PageShell><main id="main-content"><section className="hhh-about-hero"><img src={WELLBEING_IMAGE} alt="A couple enjoying a relaxed walk through a garden" /><div><p className="hhh-kicker">Our purpose</p><h1>Get back to doing the things you enjoy most.</h1></div></section><section className="hhh-about-copy hhh-section-inner"><p>Our mission is to provide holistic plant-based treatment options to those in need. Your team can include specialist <strong>doctors</strong>, clinical <strong>pharmacists</strong> and <strong>nurses</strong>, all committed to providing personalised care to each patient.</p><p>They understand that every patient is unique, and will work closely with you to develop a medical cannabis treatment plan that is tailored to your specific needs, where that is clinically appropriate.</p><div><PublicLink href="/conditions" className="hhh-button hhh-button--outline">Explore conditions</PublicLink><PublicLink href="/pricing" className="hhh-button hhh-button--outline">View pricing</PublicLink></div></section><section className="hhh-planet"><div className="hhh-section-inner"><div><p className="hhh-kicker">Our commitment to the planet</p><h2>Care that looks<br />beyond today.</h2></div><div><p><strong>We believe it is our collective duty to preserve the planet and the various forms of life that live on it.</strong></p><p>Future generations deserve a greener planet with better air quality.</p><p>Cannabis itself is a carbon sequester, meaning it takes in more CO2 than it produces. That is not enough on its own, so for every CBPM prescription dispensed at a participating pharmacy, we support tree planting through Ecologi.</p><PublicLink href="/eligibility" className="hhh-button hhh-button--rust">Check your eligibility</PublicLink></div></div></section></main></PageShell>;
}

const faqs = [
  ['Is medical cannabis legal?','Cannabis based products for medicinal use (CBPM) have been legal for medicinal purposes in the UK since November 2018. They require a valid prescription issued by a specialist doctor.'],
  ['Are CBPMs safe?','Like all medicines, CBPMs can cause side effects and are not suitable for everyone. A specialist weighs the potential benefits and risks and monitors treatment.'],
  ['What can CBPMs be prescribed for?','A specialist may consider CBPMs for a range of conditions when conventional licensed treatments have not provided sufficient benefit.'],
  ['What do CBPMs look like?','Depending on the prescription, products can include dried flower, oils or cartridges. Your clinical team and pharmacist explain how the prescribed medicine should be used.'],
  ['Will CBPMs get me high?','Treatment is prescribed and monitored to achieve a clinical benefit. THC can affect alertness or cause intoxication, so dosing and specialist guidance matter.'],
  ['What is the difference between CBD and THC?','CBD and THC are cannabinoids with different effects. THC can be intoxicating; CBD is not. Prescription products may contain one or both.'],
  ['What’s the difference between CBD products and CBPMs?','Over-the-counter CBD products are not the same as prescription cannabis-based medicines, which have defined clinical oversight, quality requirements and dosing.'],
  ['What does EU GMP medical cannabis mean?','EU GMP refers to recognised manufacturing standards designed to support consistent quality and controlled production.'],
  ['What is a Summary Care Record (SCR)?','A Summary Care Record contains key information from your GP record. With appropriate permission, it can help clinicians understand your medicines, allergies and health history.'],
  ['How do I get a prescription for CBPMs?','A specialist doctor must assess you. If treatment is appropriate, the prescription is sent to your nominated specialist or community pharmacy.'],
  ['Am I eligible for CBPM therapy?','Eligibility depends on your condition, treatment history and clinical circumstances. Complete the secure HHH eligibility check to start a review.'],
];

function FaqPage() {
  return <PageShell><main id="main-content">
    <InnerPageHero eyebrow="Questions, clearly answered" title={<>Understand your options<br />before you begin.</>} copy="Straightforward information about eligibility, cannabis-based medicines and what to expect from specialist care.">
      <PublicLink href="/eligibility" className="hhh-button hhh-button--rust">Check eligibility <ArrowRight /></PublicLink>
    </InnerPageHero>
    <section className="hhh-faq hhh-section-inner">
      <aside className="hhh-faq__intro"><span><Sparkles aria-hidden="true" /></span><p className="hhh-kicker">Frequently asked</p><h2>Start with the essentials.</h2><p>These answers are general information, not medical advice. A specialist clinician makes decisions about treatment.</p><PublicLink href="/contact" className="hhh-text-link">Still have a question? <ArrowRight /></PublicLink></aside>
      <div className="hhh-faq__list">{faqs.map(([question,answer],index) => <details key={question} open={index === 0}><summary><span>{question}</span><span className="hhh-faq__plus" aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
    </section>
    <section className="hhh-page-cta"><div className="hhh-section-inner"><div><p className="hhh-kicker">Ready when you are</p><h2>Take the first step securely.</h2><p>Your eligibility application is reviewed by HHH before any patient record is activated for a pharmacy.</p></div><PublicLink href="/eligibility" className="hhh-button hhh-button--pale">Start eligibility check</PublicLink></div></section>
  </main></PageShell>;
}

function ContactPage() {
  return <PageShell><main id="main-content">
    <InnerPageHero eyebrow="We’re here to help" title={<>Start the right<br />conversation.</>} copy="Choose the secure eligibility route for anything about your health, or email our team with a general service question." image={WELLBEING_IMAGE} imageAlt="A couple enjoying a relaxed walk together" />
    <section className="hhh-contact hhh-section-inner">
      <div className="hhh-contact__heading"><p className="hhh-kicker">Choose how to get in touch</p><h2>Two clear routes, depending on what you need.</h2></div>
      <div className="hhh-contact__layout">
        <article className="hhh-contact__card"><span className="hhh-contact__icon"><Mail aria-hidden="true" /></span><p className="hhh-kicker">General questions</p><h3>Email the HHH team</h3><p>For questions about our service, pricing or how the journey works.</p><a className="hhh-contact__email" href="mailto:info@holistichealthhub.live">info@holistichealthhub.live</a><div className="hhh-contact__notice"><ShieldCheck aria-hidden="true" /><p><strong>Keep health information secure.</strong> Please do not send health, prescription or patient details by email.</p></div></article>
        <article className="hhh-contact__card hhh-contact__card--green"><span className="hhh-contact__icon"><HeartPulse aria-hidden="true" /></span><p className="hhh-kicker">Health and eligibility</p><h3>Use the secure form</h3><p>Tell HHH about your circumstances, choose a convenient participating pharmacy where available, or continue with Holistic Health Hub Allocation.</p><PublicLink href="/eligibility" className="hhh-button hhh-button--pale">Start eligibility check <ArrowRight /></PublicLink><small>Your application goes to HHH first. A pharmacy sees a patient record only after HHH confirms the referral.</small></article>
      </div>
    </section>
  </main></PageShell>;
}

function HowItWorksPage() { return <PageShell><main id="main-content">
  <InnerPageHero eyebrow="A supported route to care" title={<>From first questions<br />to ongoing support.</>} copy="HHH stays at the centre of your intake and referral. A specialist clinic assesses you, and a pharmacy receives your record only when the referral is ready." image={HERO_IMAGE} imageAlt="A clinician listening carefully during a private conversation">
    <PublicLink href="/eligibility" className="hhh-button hhh-button--rust">Check eligibility <ArrowRight /></PublicLink>
    <PublicLink href="/pricing" className="hhh-text-link">See pricing <ChevronRight /></PublicLink>
  </InnerPageHero>
  <section className="hhh-process hhh-section-inner"><header><p className="hhh-kicker">Your journey</p><h2>Four stages. One coordinated experience.</h2><p>A dedicated pharmacy link fixes your intended pharmacy; the main website lets you express a location preference. In both cases, HHH completes the intake first.</p></header><ol>{steps.map(step => <li key={step.number}><span className="hhh-process__number">{step.number}</span><span className="hhh-process__media"><img src={step.image} alt="" /></span><div><h3>{step.title}</h3><p>{step.copy}</p></div></li>)}</ol></section>
  <section className="hhh-visibility-band"><div className="hhh-section-inner"><div><p className="hhh-kicker">Before HHH refers you</p><h2>Your application stays with HHH.</h2><p>HHH can record follow-up needs, check your route and confirm the destination. A pharmacy does not review new eligibility applications.</p></div><div><p className="hhh-kicker">After HHH confirms</p><h2>Your pharmacy record is activated.</h2><p>The confirmed pharmacy can then support the operational parts of your care, including payment, dispensing, delivery or collection.</p></div></div></section>
  <section className="hhh-how-next hhh-section-inner"><span><ShieldCheck aria-hidden="true" /></span><div><p className="hhh-kicker">Private by design</p><h2>Ready to see whether you may be eligible?</h2><p>The secure form keeps your health information out of emails, page URLs and browser storage.</p></div><PublicLink href="/eligibility" className="hhh-button hhh-button--rust">Begin securely</PublicLink></section>
</main></PageShell>; }

function PostCard({ post }: { post: typeof posts[number] }) {
  return <article className="hhh-post-card"><PublicLink href={`/post/${post.slug}`} className="hhh-post-card__image"><PostArtwork post={post} /></PublicLink><div><p className="hhh-post-meta">{post.category} · {post.read}</p><h2><PublicLink href={`/post/${post.slug}`}>{post.title}</PublicLink></h2><p>{post.excerpt}</p><PublicLink href={`/post/${post.slug}`} className="hhh-post-card__more">Read article <ArrowRight /></PublicLink></div></article>;
}

function PostArtwork({ post, large = false }: { post: typeof posts[number]; large?: boolean }) {
  const icons = { sleep: <MoonStar />, anxiety: <Sparkles />, pain: <HeartPulse />, balance: <Orbit /> } as const;
  return <span className={`hhh-post-art hhh-post-art--${post.art} ${large ? 'is-large' : ''}`} aria-hidden="true"><span>{icons[post.art]}</span><small>{post.category}</small></span>;
}

function BlogPage() {
  const [featured, ...morePosts] = posts;
  return <PageShell><main id="main-content">
    <section className="hhh-blog-hero"><div className="hhh-section-inner"><div><p className="hhh-kicker">The HHH journal</p><h1>Ideas for feeling<br />more like yourself.</h1><p>Clear, considered reading on sleep, pain, wellbeing and cannabis-based medicines.</p></div><div className="hhh-blog-hero__note"><Leaf aria-hidden="true" /><span>Written to inform</span><small>General information, never a substitute for individual clinical advice.</small></div></div></section>
    <section className="hhh-blog hhh-section-inner">
      <article className="hhh-blog-feature"><PublicLink href={`/post/${featured.slug}`} className="hhh-blog-feature__art"><PostArtwork post={featured} /></PublicLink><div><p className="hhh-post-meta">Featured · {featured.category} · {featured.read}</p><h2><PublicLink href={`/post/${featured.slug}`}>{featured.title}</PublicLink></h2><p>{featured.excerpt}</p><PublicLink href={`/post/${featured.slug}`} className="hhh-button hhh-button--outline">Read featured article <ArrowRight /></PublicLink></div></article>
      <div className="hhh-blog__heading"><div><p className="hhh-kicker">More from the journal</p><h2>Explore our latest articles.</h2></div><span>{posts.length} articles</span></div>
      <div className="hhh-post-grid hhh-post-grid--wide">{morePosts.map(post => <PostCard key={post.slug} post={post} />)}</div>
    </section>
  </main></PageShell>;
}

function ArticlePage({ slug }: { slug: string }) {
  const post = posts.find(item => item.slug === slug);
  if (!post) return <NotFoundPage />;
  return <PageShell><main id="main-content"><article className="hhh-article hhh-section-inner"><PublicLink href="/blog" className="hhh-text-link">← Back to all posts</PublicLink><p className="hhh-post-meta">{post.author} · {post.date} · {post.read}</p><h1>{post.title}</h1><p className="hhh-article__lead">{post.excerpt}</p><PostArtwork post={post} large />{post.body.map(paragraph => <p key={paragraph}>{paragraph}</p>)}<aside><strong>Important</strong><p>This article is general information, not medical advice. Prescription decisions must be made by an appropriate specialist clinician.</p></aside></article></main></PageShell>;
}

function PrivacyPage() {
  return <PageShell><main id="main-content"><article className="hhh-legal hhh-section-inner"><h1>Privacy Policy</h1><p>This privacy policy explains how Holistic Health Hub collects, uses and shares personal information when you visit our website or use our services. We are committed to protecting your privacy and complying with the UK GDPR and Data Protection Act 2018.</p><p><strong>Notification:</strong> We comply with current requirements to notify our data processing activities to the Information Commissioner’s Office and are registered under number <strong>ZB639206</strong>.</p><h2>Data Protection Principles</h2><p>Personal information must be processed fairly, lawfully and transparently; collected for explicit and legitimate purposes; adequate, relevant and limited to what is necessary; accurate; retained only as long as needed; and processed securely.</p><h2>What information do we collect?</h2><ul><li>Personal and contact details.</li><li>Communications about our services.</li><li>Website usage and technical information.</li><li>With explicit consent, information about your health and medical history.</li></ul><h2>How is your personal information collected?</h2><p>We may collect information when you enquire about or use our services, join a mailing list or provide details to our team. We may also receive relevant information from doctors and your nominated community pharmacy.</p><h2>How do we use and share your information?</h2><p>We use information to provide and improve services, communicate with you, meet legal obligations and protect our systems. Where appropriate, information may be shared with a CQC-registered clinic, your nominated community pharmacy, professional advisers, regulators or law enforcement.</p><h2>How do we protect your information?</h2><p>We use appropriate technical and organisational safeguards, restrict access, train staff and review our practices. No transmission or storage method can be guaranteed to be completely secure.</p><h2>Your rights</h2><p>You may have rights to access, correct, erase, restrict or object to the use of your information, withdraw consent and complain to the Information Commissioner’s Office.</p><h2>Cookies</h2><p>We may use strictly necessary, functional, performance and marketing technologies. You can manage these through your browser and any cookie controls we provide.</p><h2>Contact us</h2><p>Holistic Health Hub<br />124 City Road, London, EC1V 2NX<br /><a href="mailto:info@holistichealthhub.live">info@holistichealthhub.live</a></p></article></main></PageShell>;
}

function ConsentPage() {
  return <PageShell><main id="main-content"><article className="hhh-legal hhh-section-inner"><h1>Consent and terms of use</h1><p>New eligibility applications are reviewed first by Holistic Health Hub. A pharmacy does not receive the application while HHH is completing its intake and referral checks.</p><h2>Your information</h2><p>Health information is sensitive and is collected only through the secure eligibility flow with explicit consent. A pharmacy selected on the main website is a preference until HHH confirms the final referral. A pharmacy-specific link has a fixed destination, but HHH still completes the review before activating the referral for that pharmacy.</p><h2>Clinical decisions</h2><p>An eligibility check is not a diagnosis, guarantee of consultation or promise of a prescription. A specialist clinician makes treatment decisions after an appropriate assessment.</p><h2>Costs</h2><p>Private consultations and prescribed medicines may involve costs. Your pharmacy or clinic should explain the applicable charges before treatment.</p><h2>Questions</h2><p>Contact Holistic Health Hub at <a href="mailto:info@holistichealthhub.live">info@holistichealthhub.live</a>.</p></article></main></PageShell>;
}

function NotFoundPage() { return <PageShell><main id="main-content"><section className="hhh-not-found hhh-section-inner"><p className="hhh-kicker">404</p><h1>We couldn’t find that page.</h1><PublicLink href="/" className="hhh-button hhh-button--rust">Back home</PublicLink></section></main></PageShell>; }

function updateMeta(selector: string, content: string | null) {
  const element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) return;
  if (content === null) element.removeAttribute('content');
  else element.content = content;
}

export default function PublicSite() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  useEffect(() => {
    const article = path.startsWith('/post/') ? posts.find(item => item.slug === path.slice('/post/'.length)) : null;
    const page = article ? { title: article.title, description: article.excerpt } : {
      '/': { title: 'Personalised healthcare', description: 'Access specialist CBPM treatment programmes through Holistic Health Hub, partnered pharmacies and a specialist clinic.' },
      '/about': { title: 'Our purpose', description: 'Meet Holistic Health Hub and discover our personal, pharmacy-connected approach to specialist care.' },
      '/conditions': { title: 'Conditions we support', description: 'Learn about conditions that may be considered for cannabis-based medicinal treatment by a specialist.' },
      '/how-it-works': { title: 'How it works', description: 'A clear, supported route from eligibility to specialist consultation and ongoing pharmacy care.' },
      '/pricing': { title: 'Simple, transparent pricing', description: 'Understand consultation and indicative medicine costs before beginning your care journey.' },
      '/faq': { title: 'Frequently asked questions', description: 'Clear answers about cannabis-based medicines, eligibility, safety and specialist care.' },
      '/contact': { title: 'Contact us', description: 'Contact Holistic Health Hub or begin the secure eligibility check.' },
      '/blog': { title: 'Learn', description: 'Accessible articles about sleep, wellbeing, pain and cannabis-based medicines.' },
      '/privacy': { title: 'Privacy policy', description: 'How Holistic Health Hub collects, uses and protects personal information.' },
      '/consent': { title: 'Consent and terms', description: 'Understand consent, information sharing, clinical decisions and treatment costs.' },
    }[path as '/' | '/about' | '/conditions' | '/how-it-works' | '/pricing' | '/faq' | '/contact' | '/blog' | '/privacy' | '/consent'] ?? { title: 'Page not found', description: 'The requested Holistic Health Hub page could not be found.' };
    const title = `${page.title} | Holistic Health Hub`;
    document.title = title;
    updateMeta('meta[name="description"]', page.description);
    updateMeta('meta[property="og:title"]', title);
    updateMeta('meta[property="og:description"]', page.description);
    updateMeta('meta[name="twitter:title"]', title);
    updateMeta('meta[name="twitter:description"]', page.description);
    updateMeta('meta[property="og:image"]', article ? null : 'https://holistichealthhub.cc/og.jpg');
    updateMeta('meta[name="twitter:image"]', article ? null : 'https://holistichealthhub.cc/og.jpg');
  }, [path]);
  if (path === '/') return <HomePage />;
  if (path === '/conditions') return <ConditionsPage />;
  if (path === '/pricing') return <PricingPage />;
  if (path === '/about') return <AboutPage />;
  if (path === '/faq' || path === '/general-5') return <FaqPage />;
  if (path === '/how-it-works') return <HowItWorksPage />;
  if (path === '/contact') return <ContactPage />;
  if (path === '/blog' || path.startsWith('/blog/categories/')) return <BlogPage />;
  if (path === '/privacy' || path === '/general-5-1') return <PrivacyPage />;
  if (path === '/consent') return <ConsentPage />;
  if (path.startsWith('/post/')) return <ArticlePage slug={path.slice('/post/'.length)} />;
  return <NotFoundPage />;
}
