import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Activity, ArrowRight, Brain, Check, ChevronDown, ChevronRight, Clock3, Flower2,
  Globe2, HeartHandshake, HeartPulse, Leaf, Mail, Menu, MoonStar, Orbit, PackageCheck,
  ShieldCheck, ShieldPlus, Sparkles, Stethoscope, UserRoundCheck, Video, X,
} from 'lucide-react';
import './public-site.css';

const MARK = '/holistic-health-hub-mark.png';
const HERO_IMAGE = '/hhh-consultation-hero.jpg';
const WELLBEING_IMAGE = '/hhh-wellbeing-couple.jpg';
const ELIGIBILITY_IMAGE = '/hhh-eligibility-check.jpg';
const SPECIALIST_IMAGE = '/hhh-specialist-consult.jpg';
const PHARMACY_IMAGE = '/hhh-pharmacy-care.jpg';
const SUPPORT_IMAGE = '/hhh-ongoing-support.jpg';

const CANONICAL_ORIGIN = 'https://holistichealthhub.cc';

const posts = [
  {
    slug: 'sleep-easy-7-ways-to-get-a-better-nights-rest-naturally',
    title: 'Sleep Easy - 7 ways to get a better nights rest naturally',
    author: 'Holistic Health Hub',
    date: 'Mar 15, 2024',
    dateIso: '2024-03-15T09:00:00+00:00',
    read: '5 min read',
    category: 'Sleep',
    art: 'sleep',
    excerpt: 'Today is World Sleep Day—the annual celebration of healthy sleeping patterns and awareness day for sleep disorders.',
    body: [
      'A good night’s sleep supports physical recovery, mood and concentration. Small, repeatable changes to your routine can make a meaningful difference.',
      'Keep a regular bedtime, create a calm and dark sleep environment, reduce late caffeine and screen time, and make room for gentle movement during the day.',
      'If poor sleep is persistent or affecting daily life, speak to a healthcare professional. The right support should always be tailored to you.',
    ],
  },
  {
    slug: 'cannabis-for-anxiety-what-you-need-to-know',
    title: 'Medical Cannabis for Anxiety: What You Need to Know',
    author: 'Holistic Health Hub',
    date: 'Feb 14, 2024',
    dateIso: '2024-02-14T09:00:00+00:00',
    read: '5 min read',
    category: 'Mental wellbeing',
    art: 'anxiety',
    excerpt: 'In today’s fast-paced world, anxiety has emerged as a silent shadow, affecting millions globally.',
    body: [
      'Anxiety can affect sleep, work, relationships and physical wellbeing. Treatment may include talking therapies, lifestyle support and licensed medicines.',
      'Cannabis-based products for medicinal use are prescription-only medicines. A specialist doctor must assess whether they are appropriate after conventional treatment options have been explored.',
      'Benefits and side effects vary from person to person. A careful clinical review and ongoing monitoring are essential.',
    ],
  },
  {
    slug: 'navigating-pain-relief-the-role-of-medical-cannabis-in-chronic-pain-management',
    title: 'Navigating Pain Relief: The Role of Medical Cannabis in Chronic Pain Management',
    author: 'Shaylen Patel',
    date: 'Jan 31, 2024',
    dateIso: '2024-01-31T09:00:00+00:00',
    read: '3 min read',
    category: 'Pain',
    art: 'pain',
    excerpt: 'Chronic pain represents a profound challenge in healthcare, persisting far beyond the expected period of healing.',
    body: [
      'Chronic pain is complex and can affect every part of daily life. Effective care often brings together physical, psychological and medical approaches.',
      'The body’s endocannabinoid system plays a role in pain signalling and inflammation. This is one reason specialist clinicians continue to study cannabis-based medicines for selected patients.',
      'Treatment decisions should be evidence-led, individual and regularly reviewed by a specialist.',
    ],
  },
  {
    slug: 'the-endocannabinoid-system-bringing-your-body-back-to-balance',
    title: 'The Endocannabinoid System: Bringing your body back to balance',
    author: 'Shaylen Patel',
    date: 'Jan 26, 2024',
    dateIso: '2024-01-26T09:00:00+00:00',
    read: '2 min read',
    category: 'CBPM 101',
    art: 'balance',
    excerpt: 'The endocannabinoid system is a complex cell-signalling system involved in establishing and maintaining balance.',
    body: [
      'The endocannabinoid system is found throughout the body and helps regulate processes including appetite, mood, sleep, memory and pain.',
      'Endocannabinoids, receptors and enzymes work together to help maintain balance. Plant cannabinoids may interact with parts of this system in different ways.',
      'Research is still developing, so clinical advice and appropriate monitoring remain vital.',
    ],
  },
] as const;

const steps = [
  {
    number: '01',
    kicker: 'Intake & Pre-Screening',
    title: 'Check eligibility',
    copy: 'Complete a short, secure form so HHH can review whether you may benefit from CBPM therapy. Your application stays with Holistic Health Hub first, including when you arrive through a pharmacy-specific link.',
    image: ELIGIBILITY_IMAGE,
    imageAlt: 'A patient privately completing a confidential eligibility pre-check at home',
    tag: 'Private intake review',
  },
  {
    number: '02',
    kicker: 'Clinical Assessment',
    title: 'Online consultation',
    copy: 'A doctor who specialises in your condition assesses you. After the consultation, a multi-disciplinary team (MDT) of doctors and pharmacists determines which CBPM treatment, if any, is clinically appropriate.',
    image: SPECIALIST_IMAGE,
    imageAlt: 'A consultant specialist physician discussing treatment options with a patient during a video assessment',
    tag: 'Consultant physician & MDT review',
  },
  {
    number: '03',
    kicker: 'Dispensing & Care',
    title: 'Receive treatment',
    copy: 'If prescribed, your prescription is sent to your nominated pharmacy, who contacts you to arrange payment and convenient delivery or dispensary collection.',
    image: PHARMACY_IMAGE,
    imageAlt: 'A community pharmacist providing prescription guidance at the pharmacy dispensary',
    tag: 'Nominated community pharmacy',
  },
  {
    number: '04',
    kicker: 'Continuous Support',
    title: 'Ongoing support',
    copy: 'The quality of your care matters after the first appointment. Between HHH, your nominated pharmacy and the partnered clinic, support continues on your journey to health.',
    image: SUPPORT_IMAGE,
    imageAlt: 'A dedicated patient support specialist conducting an ongoing health follow-up',
    tag: 'Dedicated check-ins & reviews',
  },
] as const;

const conditionGroups = [
  {
    title: 'Pain',
    icon: <Activity aria-hidden="true" />,
    lead: 'For chronic and complex pain conditions where conventional treatments have not provided sufficient relief.',
    items: [
      'Arthritis', 'Back pain', 'Cancer-related pain', 'Chronic pain', 'Cluster headache',
      'Complex regional pain syndrome', 'Ehlers-Danlos syndromes', 'Endometriosis',
      'Fibromyalgia', 'Migraine', 'Musculoskeletal pain', 'Neuropathic pain', 'Sciatica',
    ],
  },
  {
    title: 'Neurological',
    icon: <Brain aria-hidden="true" />,
    lead: 'Specialist-assessed neurological indications evaluated under dedicated clinical protocols.',
    items: [
      'Autistic spectrum disorder', 'Epilepsy (adult and child)', 'Multiple sclerosis',
      'Parkinson’s disease', 'Tourette’s syndrome', 'Trigeminal neuralgia',
    ],
  },
  {
    title: 'Psychiatric',
    icon: <Flower2 aria-hidden="true" />,
    lead: 'Targeted support for mental wellbeing under consultant psychiatric oversight.',
    items: [
      'ADHD', 'Agoraphobia', 'Anxiety', 'Depression', 'Insomnia',
      'Obsessive compulsive disorder', 'Post-traumatic stress disorder', 'Social phobia',
    ],
  },
  {
    title: 'Other conditions',
    icon: <ShieldPlus aria-hidden="true" />,
    lead: 'Gastrointestinal, palliative and specialized clinical indications reviewed individually.',
    items: [
      'Anorexia', 'Binge eating disorder', 'Bulimia nervosa', 'Cancer-related appetite loss',
      'Chemotherapy-induced nausea and vomiting', 'Crohn’s disease', 'Eating disorders',
      'Palliative care', 'Rare skin conditions', 'Ulcerative colitis',
    ],
  },
] as const;

const faqs = [
  ['Is medical cannabis legal in the UK?', 'Cannabis based products for medicinal use (CBPM) have been legal for medicinal purposes in the UK since November 2018. They require a valid prescription issued by a specialist doctor on the GMC Specialist Register.'],
  ['Are CBPMs safe?', 'Like all medicines, CBPMs can cause side effects and are not suitable for everyone. A specialist clinician weighs the potential benefits and risks for your specific circumstances and monitors your treatment plan on an ongoing basis.'],
  ['What can CBPMs be prescribed for?', 'A specialist may consider CBPMs for a range of conditions—including chronic pain, neurological conditions, anxiety, insomnia, and palliative symptoms—when conventional licensed treatments have not provided sufficient relief.'],
  ['What do CBPMs look like?', 'Depending on your individual clinical prescription, products can include dried flower for vaporisation, sublingual oils, or inhalation cartridges. Your clinical team and dispensing pharmacist explain exactly how the prescribed medicine should be used.'],
  ['Will CBPMs get me high?', 'Treatment is prescribed and carefully monitored to achieve therapeutic clinical benefit. THC can affect alertness or cause intoxication, which is why dosing, titration and specialist medical guidance are strictly observed.'],
  ['What is the difference between CBD and THC?', 'CBD and THC are two primary cannabinoids with distinct physiological effects. THC is psychoactive; CBD is non-intoxicating. Prescription products may contain formulated ratios of one or both, tailored by your specialist doctor.'],
  ['What’s the difference between CBD products and CBPMs?', 'Over-the-counter CBD wellness products sold on the high street are not the same as prescription cannabis-based medicines, which require formal clinical oversight, pharmaceutical GMP quality certification, and tailored clinical dosing.'],
  ['What does EU GMP medical cannabis mean?', 'EU GMP (Good Manufacturing Practice) refers to stringent European pharmaceutical manufacturing standards designed to guarantee consistent quality, purity, and controlled production without contaminants.'],
  ['What is a Summary Care Record (SCR)?', 'A Summary Care Record contains key information from your GP medical file (including current medications, allergies, and health history). With your explicit consent, it allows the assessing specialist clinician to review your treatment history safely.'],
  ['How do I get a prescription for CBPMs?', 'A specialist doctor must assess you through a clinical consultation. If treatment is appropriate and approved by the multi-disciplinary team (MDT), the prescription is transmitted to your nominated pharmacy for dispensing.'],
  ['Am I eligible for CBPM therapy?', 'Eligibility generally requires that you have a diagnosed eligible condition and have previously tried at least two licensed therapies or medications that proved ineffective or caused intolerable side effects. Complete the secure HHH eligibility pre-check to start a review.'],
] as const;

function PublicLink({ href, children, className = '', ...props }: { href: string; children: ReactNode; className?: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={className} href={href} {...props}>{children}</a>;
}

function SiteHeader() {
  const [open, setOpen] = useState(false);
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  return (
    <header className="hhh-header">
      <div className="hhh-header__inner">
        <PublicLink href="/" className="hhh-mark" aria-label="Holistic Health Hub Home">
          <img src={MARK} alt="Holistic Health Hub Emblem" width="48" height="48" />
          <span>
            <strong>Holistic Health Hub</strong>
            <small>Personalised healthcare</small>
          </span>
        </PublicLink>
        <button
          className="hhh-menu-toggle"
          type="button"
          aria-expanded={open}
          aria-controls="public-navigation"
          onClick={() => setOpen(value => !value)}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          <span className="sr-only">Toggle Navigation Menu</span>
        </button>
        <nav id="public-navigation" className={`hhh-nav ${open ? 'is-open' : ''}`} aria-label="Primary navigation">
          <PublicLink href="/" className={path === '/' ? 'is-active' : ''}>Home</PublicLink>
          <PublicLink href="/how-it-works" className={path === '/how-it-works' ? 'is-active' : ''}>How it works</PublicLink>
          <PublicLink href="/conditions" className={path === '/conditions' ? 'is-active' : ''}>Conditions</PublicLink>
          <PublicLink href="/pricing" className={path === '/pricing' ? 'is-active' : ''}>Pricing</PublicLink>
          <PublicLink href="/about" className={path === '/about' ? 'is-active' : ''}>About</PublicLink>
          <PublicLink href="/blog" className={path.startsWith('/blog') || path.startsWith('/post/') ? 'is-active' : ''}>Journal</PublicLink>
          <PublicLink href="/faq" className={path === '/faq' ? 'is-active' : ''}>FAQs</PublicLink>
          <PublicLink href="/contact" className={path === '/contact' ? 'is-active' : ''}>Contact</PublicLink>
          <PublicLink href="/eligibility" className="hhh-button hhh-button--rust hhh-nav__cta">
            Check eligibility <ArrowRight aria-hidden="true" />
          </PublicLink>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="hhh-footer">
      <div className="hhh-footer__inner">
        <div className="hhh-footer__brand">
          <img src={MARK} alt="Holistic Health Hub" width="58" height="58" />
          <p>Personalised specialist healthcare, connecting patients with specialist doctors and trusted community pharmacies.</p>
          <div className="hhh-footer__badges">
            <span>ICO Registered ZB639206</span>
            <span>UK Medical Cannabis (CBPM)</span>
          </div>
          <small>© {new Date().getFullYear()} Holistic Health Hub. A Healius Consulting service.</small>
        </div>
        <div>
          <strong>Care Journey</strong>
          <PublicLink href="/how-it-works">How it works</PublicLink>
          <PublicLink href="/conditions">Treatable conditions</PublicLink>
          <PublicLink href="/pricing">Pricing &amp; costs</PublicLink>
          <PublicLink href="/eligibility">Eligibility check</PublicLink>
        </div>
        <div>
          <strong>Company</strong>
          <PublicLink href="/about">About our mission</PublicLink>
          <PublicLink href="/blog">Health journal</PublicLink>
          <PublicLink href="/faq">Patient FAQs</PublicLink>
          <PublicLink href="/contact">Contact team</PublicLink>
        </div>
        <div>
          <strong>Legal &amp; Trust</strong>
          <PublicLink href="/privacy">Privacy policy</PublicLink>
          <PublicLink href="/consent">Consent &amp; terms</PublicLink>
          <a href="mailto:info@holistichealthhub.live">info@holistichealthhub.live</a>
          <div className="hhh-social" aria-label="Social links">
            <a href="https://www.instagram.com/holistichealthhub1" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
              <span>ig</span>
            </a>
            <a href="https://www.facebook.com/profile.php?id=61555967331192" target="_blank" rel="noopener noreferrer" aria-label="Facebook">
              <span>f</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.body.classList.add('hhh-public-active');
    window.scrollTo(0, 0);

    const blocks = document.querySelectorAll('.hhh-reveal-block');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      blocks.forEach(block => block.classList.add('is-visible'));
      return () => document.body.classList.remove('hhh-public-active');
    }

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    blocks.forEach(block => observer.observe(block));
    return () => {
      observer.disconnect();
      document.body.classList.remove('hhh-public-active');
    };
  }, []);

  return (
    <div className="hhh-public">
      <a className="hhh-skip" href="#main-content">Skip to main content</a>
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}

/**
 * Sticky Chapter Scroller for the 4-step process story.
 * The media column pins on desktop while steps 01-04 scroll alongside, crossfading photos cleanly.
 */
function StickyStepNarrative() {
  const [activeStep, setActiveStep] = useState(0);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute('data-step-index'));
            if (!Number.isNaN(index)) {
              setActiveStep(index);
            }
          }
        });
      },
      { rootMargin: '-25% 0px -45% 0px', threshold: 0.2 }
    );

    stepRefs.current.forEach(ref => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <section className="hhh-sticky-chapter" aria-label="Step by step care journey">
      <div className="hhh-section-inner hhh-sticky-chapter__inner">
        <div className="hhh-sticky-chapter__pinned" aria-hidden="true">
          <div className="hhh-sticky-chapter__frame">
            {steps.map((step, idx) => (
              <img
                key={step.number}
                src={step.image}
                alt=""
                className={`hhh-sticky-chapter__image ${idx === activeStep ? 'is-active' : ''}`}
                loading={idx === 0 ? 'eager' : 'lazy'}
              />
            ))}
            <div className="hhh-sticky-chapter__badge">
              <span className="hhh-sticky-chapter__badge-number">Step {steps[activeStep].number}</span>
              <span className="hhh-sticky-chapter__badge-title">{steps[activeStep].title}</span>
            </div>
            <div className="hhh-sticky-chapter__arc" />
          </div>
        </div>

        <div className="hhh-sticky-chapter__rail">
          <div className="hhh-sticky-chapter__spine" aria-hidden="true">
            <div
              className="hhh-sticky-chapter__spine-fill"
              style={{ height: `${((activeStep + 1) / steps.length) * 100}%` }}
            />
          </div>

          <div className="hhh-sticky-chapter__steps">
            {steps.map((step, idx) => (
              <article
                key={step.number}
                ref={el => { stepRefs.current[idx] = el; }}
                data-step-index={idx}
                className={`hhh-sticky-chapter__step ${idx === activeStep ? 'is-active' : ''}`}
              >
                <div className="hhh-sticky-chapter__step-mobile-media">
                  <img src={step.image} alt={step.imageAlt} loading="lazy" />
                  <span className="hhh-sticky-chapter__step-num">{step.number}</span>
                </div>

                <div className="hhh-sticky-chapter__step-header">
                  <span className="hhh-kicker">{step.kicker}</span>
                  <span className="hhh-sticky-chapter__tag">{step.tag}</span>
                </div>

                <h2>{step.number}. {step.title}</h2>
                <p>{step.copy}</p>

                <div className="hhh-sticky-chapter__step-footer">
                  {idx === 0 && (
                    <PublicLink href="/eligibility" className="hhh-button hhh-button--rust">
                      Begin eligibility check <ArrowRight aria-hidden="true" />
                    </PublicLink>
                  )}
                  {idx === 1 && (
                    <span className="hhh-inline-note">
                      <Stethoscope aria-hidden="true" /> Dedicated GMC-registered specialist assessment
                    </span>
                  )}
                  {idx === 2 && (
                    <span className="hhh-inline-note">
                      <PackageCheck aria-hidden="true" /> GPhC registered pharmacy dispensing
                    </span>
                  )}
                  {idx === 3 && (
                    <PublicLink href="/pricing" className="hhh-text-link">
                      View care timeline &amp; transparent fees <ChevronRight aria-hidden="true" />
                    </PublicLink>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function HomePage() {
  return (
    <PageShell>
      <main id="main-content">
        {/* Cinematic Hero */}
        <section className="hhh-hero hhh-reveal">
          <div className="hhh-section-inner hhh-hero__inner">
            <div className="hhh-hero__copy">
              <div className="hhh-pill-kicker">
                <Leaf aria-hidden="true" />
                <span>Personalised specialist healthcare · UK</span>
              </div>
              <h1>Feel heard.<br />Find a way forward.</h1>
              <p className="hhh-hero__lede">
                At Holistic Health Hub, we are dedicated to improving your health and well-being. We offer access to specialist therapies, including comprehensive medical cannabis (CBPM) treatment programmes for a variety of conditions, provided by specialist healthcare professionals.
              </p>
              <p>
                Get access to evidence-based treatment and compassionate care through our network of trusted partnered pharmacies and specialist clinic.
              </p>
              <div className="hhh-hero__actions">
                <PublicLink href="/eligibility" className="hhh-button hhh-button--rust">
                  Check your eligibility <ArrowRight aria-hidden="true" />
                </PublicLink>
                <PublicLink href="/how-it-works" className="hhh-text-link">
                  See how it works <ChevronRight aria-hidden="true" />
                </PublicLink>
              </div>
              <div className="hhh-hero__assurance">
                <span><ShieldCheck aria-hidden="true" /> Private and secure</span>
                <span><Stethoscope aria-hidden="true" /> Specialist-led</span>
                <span><HeartHandshake aria-hidden="true" /> Pharmacy connected</span>
              </div>
            </div>

            <div className="hhh-hero__media">
              <div className="hhh-hero__frame">
                <img
                  src={HERO_IMAGE}
                  alt="A consultant clinician listening attentively to a patient in a private clinic consultation room"
                  fetchPriority="high"
                  width="720"
                  height="570"
                />
                <div className="hhh-hero__tag-badge">
                  <span><HeartPulse aria-hidden="true" /></span>
                  <div>
                    <strong>Care built around you</strong>
                    <small>From first questions to ongoing support</small>
                  </div>
                </div>
              </div>
              <div className="hhh-hero__arc-motif" aria-hidden="true" />
            </div>
          </div>
        </section>

        {/* Section flow transition */}
        <div className="hhh-motif-divider" aria-hidden="true">
          <div className="hhh-motif-divider__line" />
          <div className="hhh-motif-divider__orbit"><Orbit /></div>
        </div>

        {/* 4-Step Journey Narrative */}
        <section className="hhh-journey hhh-reveal-block">
          <div className="hhh-section-inner">
            <div className="hhh-journey__header">
              <div>
                <p className="hhh-kicker">A clear route to care</p>
                <h2>How it works in four simple steps</h2>
              </div>
              <PublicLink href="/how-it-works" className="hhh-button hhh-button--outline">
                Explore the full journey <ArrowRight aria-hidden="true" />
              </PublicLink>
            </div>

            <div className="hhh-journey__grid">
              {steps.map((step, index) => (
                <article key={step.number} style={{ '--stagger-index': index } as CSSProperties}>
                  <figure className="hhh-journey__figure">
                    <img src={step.image} alt={step.imageAlt} loading="lazy" />
                    <figcaption>{step.number}</figcaption>
                  </figure>
                  <div className="hhh-journey__body">
                    <span className="hhh-journey__step-tag">{step.kicker}</span>
                    <h3>{step.title}</h3>
                    <p>{step.copy}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Clinical Network Architecture */}
        <section className="hhh-network hhh-reveal-block">
          <div className="hhh-section-inner">
            <div className="hhh-network__intro">
              <p className="hhh-kicker">Who supports you</p>
              <h2>HHH, a specialist clinic and your pharmacy, working together.</h2>
              <p className="hhh-network__lede">
                Care is delivered through distinct, regulated roles ensuring patient privacy, independent clinical assessment, and safe dispensing.
              </p>
            </div>

            <div className="hhh-network__cards">
              {[
                {
                  number: '01',
                  role: 'Intake & Referral',
                  title: 'Holistic Health Hub',
                  copy: 'Reviews your initial eligibility, answers pre-screening questions, stays with you through intake, and confirms the referral destination.',
                  icon: <ShieldCheck aria-hidden="true" />,
                },
                {
                  number: '02',
                  role: 'Clinical Assessment',
                  title: 'Specialist clinic',
                  copy: 'A GMC-registered doctor who specialises in your condition assesses you. Treatment decisions are clinical, made with an MDT, and never automatic.',
                  icon: <Stethoscope aria-hidden="true" />,
                },
                {
                  number: '03',
                  role: 'Dispensing & Care',
                  title: 'Nominated pharmacy',
                  copy: 'Arranges payment, pharmaceutical dispensing, and reliable delivery or collection once an appropriate prescription is issued.',
                  icon: <PackageCheck aria-hidden="true" />,
                },
              ].map((item, index) => (
                <article key={item.title} style={{ '--stagger-index': index } as CSSProperties}>
                  <div className="hhh-network__card-top">
                    <span className="hhh-network__num">{item.number}</span>
                    <span className="hhh-network__icon">{item.icon}</span>
                  </div>
                  <span className="hhh-network__role">{item.role}</span>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Value Highlights */}
        <section className="hhh-benefits hhh-section-inner hhh-reveal-block" aria-label="Key patient benefits">
          {[
            { icon: <Globe2 aria-hidden="true" />, text: 'Online appointments that suit you' },
            { icon: <Clock3 aria-hidden="true" />, text: 'Personalised treatment options' },
            { icon: <Video aria-hidden="true" />, text: 'No GP referral required' },
            { icon: <UserRoundCheck aria-hidden="true" />, text: 'Access to specialist medical professionals' },
            { icon: <HeartHandshake aria-hidden="true" />, text: 'Dedicated patient support' },
          ].map((item, index) => (
            <div key={item.text} style={{ '--stagger-index': index } as CSSProperties}>
              <span>{item.icon}</span>
              <p>{item.text}</p>
            </div>
          ))}
        </section>

        {/* Condition Feature Showcase */}
        <section className="hhh-condition-feature hhh-reveal-block">
          <div className="hhh-section-inner">
            <div className="hhh-condition-feature__top">
              <div>
                <p className="hhh-kicker">Conditions we support</p>
                <h2>Some of the conditions<br />we can help you with</h2>
              </div>
              <PublicLink className="hhh-button hhh-button--outline" href="/conditions">
                Which conditions can be treated? <ArrowRight aria-hidden="true" />
              </PublicLink>
            </div>

            <div className="hhh-condition-card">
              <div className="hhh-condition-card__intro">
                <span><Activity aria-hidden="true" /></span>
                <span className="hhh-condition-card__category">Primary Focus</span>
                <h3>Pain</h3>
                <p>
                  For many of the 28 million people in the UK living with chronic pain, traditional painkillers like opioids aren’t always the answer. Holistic therapies such as medical cannabis offer alternative options.
                </p>
                <div className="hhh-condition-card__kpis">
                  <div><strong>28M+</strong><small>UK adults with chronic pain</small></div>
                  <div><strong>MDT</strong><small>Specialist team review</small></div>
                </div>
              </div>
              <div className="hhh-condition-card__body">
                <h4>How medical cannabis can help with pain</h4>
                <p>
                  Everybody has an endocannabinoid system (ECS) which plays a significant role in regulating pain, inflammation and other vital functions. Medical cannabis, which contains phytocannabinoids like THC and CBD, influences how the body responds to pain signals.
                </p>
                <p className="hhh-condition-card__note">Pain-related conditions we can help you treat:</p>
                <div className="hhh-tag-list">
                  {[
                    'Arthritis', 'Back Pain', 'Chronic Pain', 'Cluster Headache',
                    'Complex Regional Pain Syndrome', 'Cancer-Related Pain', 'Ehlers-Danlos Syndromes (EDS)',
                    'Endometriosis', 'Fibromyalgia', 'Musculoskeletal Pain', 'Migraine',
                    'Neuropathic Pain', 'Palliative Care', 'Sciatica',
                  ].map(tag => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Key Benefits List */}
        <section className="hhh-key-benefits hhh-section-inner hhh-reveal-block">
          <div className="hhh-key-benefits__top">
            <p className="hhh-kicker">Key benefits</p>
            <h2>Why patients choose specialist referral</h2>
          </div>
          <div className="hhh-key-benefits__list">
            {[
              { num: '01', title: 'Appointments with pain specialists', desc: 'Consult with GMC-registered consultants who specialise in your specific condition.' },
              { num: '02', title: 'Alternative to opioids', desc: 'Explore plant-based options where conventional pain management has fallen short.' },
              { num: '03', title: 'Anti-inflammatory properties', desc: 'Target inflammation pathways through guided cannabinoid therapies.' },
            ].map(item => (
              <article key={item.title}>
                <span>{item.num}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.desc}</p>
                </div>
                <ChevronRight aria-hidden="true" />
              </article>
            ))}
          </div>
          <div className="hhh-key-benefits__cta">
            <PublicLink href="/eligibility" className="hhh-button hhh-button--rust">
              Check your eligibility today <ArrowRight aria-hidden="true" />
            </PublicLink>
          </div>
        </section>

        {/* Patient Testimonials */}
        <section className="hhh-testimonials hhh-reveal-block" aria-label="Patient feedback">
          <div className="hhh-section-inner">
            <div className="hhh-testimonials__header">
              <p className="hhh-kicker">Patient testimonials</p>
              <h2>Experiences from our patient community</h2>
            </div>
            <div className="hhh-testimonials__grid">
              {[
                ['“I felt that I was listened to, and the different types of pain I was experiencing was understood and my treatment plan was tailored to suit my individual needs.”', 'Keasha', 'Chronic pain patient'],
                ['“It wasn’t until I saw my consultant that I felt properly listened to for the first time in years. The service I’ve received is second to none.”', 'Xavier', 'Specialist clinic patient'],
                ['“Life with social anxiety and insomnia is horrendous. But my experience at the clinic has been amazing, they have been very understanding, a life saver.”', 'Kim', 'Anxiety & sleep patient'],
              ].map(([quote, name, role]) => (
                <blockquote key={name}>
                  <p>{quote}</p>
                  <footer>
                    <cite><strong>{name}</strong><small>{role}</small></cite>
                  </footer>
                </blockquote>
              ))}
            </div>
          </div>
        </section>

        {/* Press Wordmarks */}
        <section className="hhh-press hhh-reveal-block" aria-label="Media coverage wordmarks">
          <div className="hhh-section-inner">
            <p className="hhh-kicker">As seen in UK media</p>
            <div className="hhh-press__wordmarks">
              <span>GOV.UK</span>
              <span>Sky News</span>
              <span>The Guardian</span>
            </div>
          </div>
        </section>

        {/* Trust & Responsibility Band */}
        <section className="hhh-trust-band hhh-reveal-block">
          <div className="hhh-section-inner">
            <span><ShieldCheck aria-hidden="true" /></span>
            <div>
              <p className="hhh-kicker">Thoughtful, responsible care</p>
              <h2>Private treatment should still feel personal.</h2>
              <p>Your eligibility check is only a starting point. A specialist clinician makes treatment decisions after an appropriate assessment, and your pharmacy remains part of the support around you.</p>
            </div>
            <PublicLink href="/about" className="hhh-button hhh-button--pale">Meet HHH</PublicLink>
          </div>
        </section>

        {/* Journal Teaser */}
        <section className="hhh-learn hhh-section-inner hhh-reveal-block">
          <div className="hhh-learn__header">
            <div>
              <p className="hhh-kicker">Learn &amp; Explore</p>
              <h2>From the HHH Journal</h2>
            </div>
            <PublicLink href="/blog" className="hhh-text-link">
              Read all articles <ArrowRight aria-hidden="true" />
            </PublicLink>
          </div>
          <div className="hhh-post-grid">
            {posts.slice(0, 3).map(post => <PostCard key={post.slug} post={post} />)}
          </div>
        </section>
      </main>
    </PageShell>
  );
}

function InnerPageHero({
  eyebrow,
  title,
  copy,
  image,
  imageAlt,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  copy: string;
  image?: string;
  imageAlt?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`hhh-inner-hero hhh-reveal${image ? ' hhh-inner-hero--with-image' : ''}`}>
      <div className="hhh-section-inner">
        <div className="hhh-inner-hero__copy">
          <p className="hhh-kicker">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{copy}</p>
          {children && <div className="hhh-inner-hero__actions">{children}</div>}
        </div>
        {image && (
          <div className="hhh-inner-hero__media">
            <img src={image} alt={imageAlt ?? ''} />
          </div>
        )}
      </div>
    </section>
  );
}

function PageCta({ kicker, title, copy, href, label }: { kicker: string; title: string; copy: string; href: string; label: string }) {
  return (
    <section className="hhh-page-cta hhh-reveal-block">
      <div className="hhh-section-inner">
        <div>
          <p className="hhh-kicker">{kicker}</p>
          <h2>{title}</h2>
          <p>{copy}</p>
        </div>
        <PublicLink href={href} className="hhh-button hhh-button--pale">
          {label} <ArrowRight aria-hidden="true" />
        </PublicLink>
      </div>
    </section>
  );
}

function ConditionsPage() {
  return (
    <PageShell>
      <main id="main-content">
        <InnerPageHero
          eyebrow="Conditions we support"
          title={<>Conditions that can be treated<br />with medical cannabis (CBPM)</>}
          copy="If you have tried two therapies or treatments for these conditions that have not provided sufficient benefit, you may be eligible for referral. A specialist clinician assesses you and decides whether treatment is appropriate."
        >
          <PublicLink href="/eligibility" className="hhh-button hhh-button--rust">
            Check eligibility <ArrowRight aria-hidden="true" />
          </PublicLink>
          <PublicLink href="/pricing" className="hhh-text-link">
            See pricing &amp; fees <ChevronRight aria-hidden="true" />
          </PublicLink>
        </InnerPageHero>

        <section className="hhh-condition-groups hhh-section-inner hhh-reveal-block">
          {conditionGroups.map((group, index) => (
            <article key={group.title} style={{ '--stagger-index': index } as CSSProperties}>
              <div className="hhh-condition-group__head">
                <span>{group.icon}</span>
                <h2>{group.title}</h2>
              </div>
              <p className="hhh-condition-group__lead">{group.lead}</p>
              <ul>
                {group.items.map(item => (
                  <li key={item}>
                    <Check aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="hhh-condition-group__footer">
                <PublicLink href="/eligibility" className="hhh-button hhh-button--outline">
                  Check eligibility for {group.title.toLowerCase()} <ArrowRight aria-hidden="true" />
                </PublicLink>
              </div>
            </article>
          ))}
        </section>

        <PageCta
          kicker="Next question"
          title="What is the cost of treatment?"
          copy="Consultation fees are published clearly at £30 per appointment, and indicative medicine prices are confirmed before you proceed."
          href="/pricing"
          label="View pricing"
        />
      </main>
    </PageShell>
  );
}

function PricingPage() {
  return (
    <PageShell>
      <main id="main-content">
        <section className="hhh-pricing-head hhh-section-inner hhh-reveal">
          <p className="hhh-kicker">Simple, transparent pricing</p>
          <h1>Get the personalised care you deserve, at affordable prices.</h1>
          <p>All appointments are with a consultant physician on the GMC Specialist Register who specialises in your condition.</p>
          <div className="hhh-price-grid">
            {[
              ['Initial consultation', '£30', 'Comprehensive specialist medical assessment & MDT review'],
              ['Follow-up consultation', '£30', 'Detailed dosage review and therapeutic outcome monitoring'],
              ['Quarterly check-up', '£30', 'Regular reviews to ensure your care remains effective'],
            ].map(([label, price, desc], index) => (
              <article key={label} style={{ '--stagger-index': index } as CSSProperties}>
                <span className="hhh-price-num">0{index + 1}</span>
                <h2>{label}</h2>
                <strong className="hhh-price-amount">{price}</strong>
                <span className="hhh-price-fee-label">Consultation fee</span>
                <p className="hhh-price-desc">{desc}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Medication Breakdown */}
        <section className="hhh-medication hhh-reveal-block">
          <div className="hhh-section-inner">
            <p className="hhh-kicker">Prescribed Medication</p>
            <h2>Affordable medicine through your community pharmacy</h2>
            <p>Indicative medicine prices; your exact treatment and costs are confirmed by your pharmacy before you proceed.</p>
            <div className="hhh-medication__grid">
              {[
                ['Dried Flower', 'From £5.50 per gram', 'Vaporised medical cannabis flower prescribed by clinical strain and cannabinoid profile.'],
                ['Sublingual Oils', 'From £30 per 10ml bottle', 'Formulated whole-plant cannabinoid oils for metered sublingual administration.'],
                ['Vape Cartridges', 'From £49 per cartridge', 'Standardised inhalation cartridges for rapid onset and measured therapeutic dosing.'],
              ].map(([name, price, detail], index) => (
                <article key={name} style={{ '--stagger-index': index } as CSSProperties}>
                  <span><Leaf aria-hidden="true" /></span>
                  <h3>{name}</h3>
                  <strong>{price}</strong>
                  <p>{detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Included in Care Feature */}
        <section className="hhh-included hhh-section-inner hhh-reveal-block">
          <div className="hhh-included__image">
            <img
              src={PHARMACY_IMAGE}
              alt="A registered community pharmacist consulting with a patient at the pharmacy dispensary"
              loading="lazy"
            />
          </div>
          <div className="hhh-included__copy">
            <p className="hhh-kicker">What’s included in your care?</p>
            <h2>Support that continues beyond your first appointment.</h2>
            <div className="hhh-included__list">
              {[
                'Personalised treatment plans developed with specialist clinicians',
                'Multi-disciplinary clinical team (MDT) review before prescribing',
                'Community pharmacy dispensing with direct delivery or collection',
                'Ongoing patient support team to assist with queries and check-ins',
                'No waiting list — fast-track intake review and scheduling',
              ].map(item => (
                <div className="hhh-included__item" key={item}>
                  <Check aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
            <PublicLink href="/eligibility" className="hhh-button hhh-button--rust">
              Start your journey today <ArrowRight aria-hidden="true" />
            </PublicLink>
          </div>
        </section>

        {/* Care Timeline */}
        <section className="hhh-timeline hhh-reveal-block">
          <div className="hhh-section-inner">
            <p className="hhh-kicker">Your care timeline</p>
            <h2>Your first months of care</h2>
            <div className="hhh-timeline__grid">
              {[
                ['Month 1', 'Initial consultation', '£30', 'Consultation with specialist physician and initial prescription review.'],
                ['Month 2', 'Follow-up consultation', '£30', 'Assessing therapeutic response, symptom improvement and dosage.'],
                ['Month 5', 'Quarterly check-up', '£30', 'Long-term monitoring and ongoing support thereafter every 3 months.'],
              ].map(([month, label, price, note], index) => (
                <article key={month} style={{ '--stagger-index': index } as CSSProperties}>
                  <span className="hhh-timeline__badge">{month}</span>
                  <h3>{label}</h3>
                  <strong className="hhh-timeline__price">{price}</strong>
                  <p>{note}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </PageShell>
  );
}

function AboutPage() {
  return (
    <PageShell>
      <main id="main-content">
        {/* About Hero: Oversized photo with solid green panel BELOW the photo (never text over busy photography) */}
        <section className="hhh-about-hero hhh-reveal">
          <div className="hhh-about-hero__media">
            <img
              src={WELLBEING_IMAGE}
              alt="A couple walking together comfortably through a lush garden park"
              fetchPriority="high"
              width="1280"
              height="600"
            />
          </div>
          <div className="hhh-about-hero__copy">
            <div className="hhh-section-inner">
              <p className="hhh-kicker">Our purpose</p>
              <h1>Get back to doing the things you enjoy most.</h1>
              <p className="hhh-about-hero__sub">
                Bridging the gap between specialist medical care and trusted local community pharmacies.
              </p>
            </div>
          </div>
        </section>

        {/* Editorial Narrative */}
        <section className="hhh-about-copy hhh-section-inner hhh-reveal-block">
          <p>
            Our mission is to provide holistic plant-based treatment options to those in need. Your team can include specialist <strong>doctors</strong>, clinical <strong>pharmacists</strong> and <strong>nurses</strong>, all committed to providing personalised care to each patient.
          </p>
          <p>
            They understand that every patient is unique, and will work closely with you to develop a medical cannabis treatment plan that is tailored to your specific needs, where that is clinically appropriate.
          </p>
          <div className="hhh-about-copy__actions">
            <PublicLink href="/conditions" className="hhh-button hhh-button--outline">Explore conditions</PublicLink>
            <PublicLink href="/pricing" className="hhh-button hhh-button--outline">View pricing</PublicLink>
          </div>
        </section>

        {/* Care Team Roles */}
        <section className="hhh-team hhh-reveal-block">
          <div className="hhh-section-inner">
            <p className="hhh-kicker">Your care team</p>
            <h2>Specialists, pharmacists and nurses, working around you.</h2>
            <div className="hhh-team__grid">
              {[
                {
                  icon: <Stethoscope aria-hidden="true" />,
                  title: 'Specialist doctors',
                  copy: 'A GMC-registered doctor who specialises in your condition assesses your history and decides whether a prescription is clinically appropriate.',
                },
                {
                  icon: <PackageCheck aria-hidden="true" />,
                  title: 'Clinical pharmacists',
                  copy: 'Your nominated community pharmacy supports dispensing, medication reviews, and convenient delivery or dispensary collection.',
                },
                {
                  icon: <HeartPulse aria-hidden="true" />,
                  title: 'Nurses & patient support',
                  copy: 'Personalised follow-up sits alongside the clinic and pharmacy, so care and communication do not stop after the first appointment.',
                },
              ].map((item, index) => (
                <article key={item.title} style={{ '--stagger-index': index } as CSSProperties}>
                  <span>{item.icon}</span>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Ecological Commitment */}
        <section className="hhh-planet hhh-reveal-block">
          <div className="hhh-section-inner">
            <div>
              <p className="hhh-kicker">Our commitment to the planet</p>
              <h2>Care that looks<br />beyond today.</h2>
            </div>
            <div>
              <p><strong>We believe it is our collective duty to preserve the planet and the various forms of life that live on it.</strong></p>
              <p>Future generations deserve a greener planet with better air quality.</p>
              <p>Cannabis itself is a carbon sequester, meaning it takes in more CO2 than it produces. That is not enough on its own, so for every CBPM prescription dispensed at a participating pharmacy, we support tree planting through Ecologi.</p>
              <PublicLink href="/eligibility" className="hhh-button hhh-button--rust">
                Check your eligibility <ArrowRight aria-hidden="true" />
              </PublicLink>
            </div>
          </div>
        </section>
      </main>
    </PageShell>
  );
}

function HowItWorksPage() {
  return (
    <PageShell>
      <main id="main-content">
        <InnerPageHero
          eyebrow="A supported route to care"
          title={<>From first questions<br />to ongoing support.</>}
          copy="HHH stays at the centre of your intake and referral. A specialist clinic assesses you, and a pharmacy receives your record only when the referral is ready."
        >
          <PublicLink href="/eligibility" className="hhh-button hhh-button--rust">
            Check eligibility <ArrowRight aria-hidden="true" />
          </PublicLink>
          <PublicLink href="/pricing" className="hhh-text-link">
            See pricing <ChevronRight aria-hidden="true" />
          </PublicLink>
        </InnerPageHero>

        {/* Sticky Chapter Pin-and-Scrub Experience */}
        <StickyStepNarrative />

        {/* Data Protection Separation Band */}
        <section className="hhh-visibility-band hhh-reveal-block">
          <div className="hhh-section-inner">
            <div className="hhh-visibility-col">
              <span className="hhh-kicker">Before HHH refers you</span>
              <h2>Your application stays with HHH.</h2>
              <p>HHH reviews your eligibility, checks your treatment history, and confirms the referral destination with you. A community pharmacy does not review unverified eligibility applications.</p>
            </div>
            <div className="hhh-visibility-col hhh-visibility-col--dark">
              <span className="hhh-kicker">After HHH confirms</span>
              <h2>Your pharmacy record is activated.</h2>
              <p>The confirmed pharmacy can then support the operational parts of your care, including prescription management, dispensing, payment, and delivery or collection.</p>
            </div>
          </div>
        </section>

        {/* Next Step Security Card */}
        <section className="hhh-how-next hhh-section-inner hhh-reveal-block">
          <span><ShieldCheck aria-hidden="true" /></span>
          <div>
            <p className="hhh-kicker">Private by design</p>
            <h2>Ready to see whether you may be eligible?</h2>
            <p>The secure form keeps your health information out of emails, page URLs and browser storage.</p>
          </div>
          <PublicLink href="/eligibility" className="hhh-button hhh-button--rust">
            Begin securely <ArrowRight aria-hidden="true" />
          </PublicLink>
        </section>
      </main>
    </PageShell>
  );
}

function FaqPage() {
  return (
    <PageShell>
      <main id="main-content">
        <InnerPageHero
          eyebrow="Questions, clearly answered"
          title={<>Understand your options<br />before you begin.</>}
          copy="Straightforward information about eligibility, cannabis-based medicines, clinical assessment, and what to expect from specialist care."
        >
          <PublicLink href="/eligibility" className="hhh-button hhh-button--rust">
            Check eligibility <ArrowRight aria-hidden="true" />
          </PublicLink>
        </InnerPageHero>

        <section className="hhh-faq hhh-section-inner hhh-reveal-block">
          <aside className="hhh-faq__intro">
            <span><Sparkles aria-hidden="true" /></span>
            <p className="hhh-kicker">Frequently asked</p>
            <h2>Start with the essentials.</h2>
            <p>These answers are general information, not medical advice. A specialist clinician makes individual treatment decisions.</p>
            <PublicLink href="/contact" className="hhh-text-link">
              Still have a question? <ArrowRight aria-hidden="true" />
            </PublicLink>
          </aside>

          <div className="hhh-faq__list" role="region" aria-label="Frequently Asked Questions list">
            {faqs.map(([question, answer], index) => (
              <details key={question} open={index === 0}>
                <summary>
                  <span>{question}</span>
                  <span className="hhh-faq__plus" aria-hidden="true">
                    <ChevronDown />
                  </span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <PageCta
          kicker="Ready when you are"
          title="Take the first step securely."
          copy="Your eligibility application is reviewed by HHH before any patient record is activated for a pharmacy."
          href="/eligibility"
          label="Start eligibility check"
        />
      </main>
    </PageShell>
  );
}

function ContactPage() {
  return (
    <PageShell>
      <main id="main-content">
        <InnerPageHero
          eyebrow="We’re here to help"
          title={<>Start the right<br />conversation.</>}
          copy="Choose the secure eligibility route for anything about your health, or email our team with a general service enquiry."
        >
          <PublicLink href="/eligibility" className="hhh-button hhh-button--rust">
            Start eligibility check <ArrowRight aria-hidden="true" />
          </PublicLink>
        </InnerPageHero>

        <section className="hhh-contact hhh-section-inner hhh-reveal-block">
          <div className="hhh-contact__heading">
            <p className="hhh-kicker">Choose how to get in touch</p>
            <h2>Two clear routes, depending on what you need.</h2>
          </div>

          <div className="hhh-contact__layout">
            <article className="hhh-contact__card" style={{ '--stagger-index': 0 } as CSSProperties}>
              <span className="hhh-contact__icon"><Mail aria-hidden="true" /></span>
              <p className="hhh-kicker">General enquiries</p>
              <h3>Email the HHH team</h3>
              <p>For questions about our service, pricing, partnering pharmacies, or how the referral journey works.</p>
              <a className="hhh-contact__email" href="mailto:info@holistichealthhub.live">
                info@holistichealthhub.live
              </a>
              <div className="hhh-contact__notice">
                <ShieldCheck aria-hidden="true" />
                <p><strong>Keep health information secure.</strong> Please do not send medical history, symptoms, or prescription details by email.</p>
              </div>
            </article>

            <article className="hhh-contact__card hhh-contact__card--green" style={{ '--stagger-index': 1 } as CSSProperties}>
              <span className="hhh-contact__icon"><HeartPulse aria-hidden="true" /></span>
              <p className="hhh-kicker">Health &amp; eligibility</p>
              <h3>Use the secure form</h3>
              <p>Tell HHH about your health circumstances, choose a participating community pharmacy, or continue with Holistic Health Hub Allocation.</p>
              <PublicLink href="/eligibility" className="hhh-button hhh-button--pale">
                Start eligibility check <ArrowRight aria-hidden="true" />
              </PublicLink>
              <small>Your application goes to HHH first. A pharmacy sees a patient record only after HHH confirms the clinical referral.</small>
            </article>
          </div>
        </section>
      </main>
    </PageShell>
  );
}

function PostArtwork({ post, large = false }: { post: typeof posts[number]; large?: boolean }) {
  const icons = {
    sleep: <MoonStar aria-hidden="true" />,
    anxiety: <Sparkles aria-hidden="true" />,
    pain: <HeartPulse aria-hidden="true" />,
    balance: <Orbit aria-hidden="true" />,
  } as const;

  return (
    <span className={`hhh-post-art hhh-post-art--${post.art} ${large ? 'is-large' : ''}`} aria-hidden="true">
      <span>{icons[post.art]}</span>
      <small>{post.category}</small>
    </span>
  );
}

function PostCard({ post }: { post: typeof posts[number] }) {
  return (
    <article className="hhh-post-card">
      <PublicLink href={`/post/${post.slug}`} className="hhh-post-card__image" tabIndex={-1} aria-hidden="true">
        <PostArtwork post={post} />
      </PublicLink>
      <div className="hhh-post-card__body">
        <p className="hhh-post-meta">{post.category} · {post.read}</p>
        <h2><PublicLink href={`/post/${post.slug}`}>{post.title}</PublicLink></h2>
        <p>{post.excerpt}</p>
        <PublicLink href={`/post/${post.slug}`} className="hhh-post-card__more">
          Read article <ArrowRight aria-hidden="true" />
        </PublicLink>
      </div>
    </article>
  );
}

function BlogPage() {
  const [featured, ...morePosts] = posts;

  return (
    <PageShell>
      <main id="main-content">
        <section className="hhh-blog-hero hhh-reveal">
          <div className="hhh-section-inner">
            <div>
              <p className="hhh-kicker">The HHH Journal</p>
              <h1>Ideas for feeling<br />more like yourself.</h1>
              <p>Clear, considered reading on sleep, pain management, mental wellbeing, and cannabis-based medicines.</p>
            </div>
            <div className="hhh-blog-hero__note">
              <Leaf aria-hidden="true" />
              <div>
                <span>Written to inform</span>
                <small>General health information, never a substitute for individual clinical advice.</small>
              </div>
            </div>
          </div>
        </section>

        <section className="hhh-blog hhh-section-inner hhh-reveal-block">
          <article className="hhh-blog-feature">
            <PublicLink href={`/post/${featured.slug}`} className="hhh-blog-feature__art" tabIndex={-1} aria-hidden="true">
              <PostArtwork post={featured} />
            </PublicLink>
            <div className="hhh-blog-feature__body">
              <p className="hhh-post-meta">Featured · {featured.category} · {featured.read}</p>
              <h2><PublicLink href={`/post/${featured.slug}`}>{featured.title}</PublicLink></h2>
              <p>{featured.excerpt}</p>
              <PublicLink href={`/post/${featured.slug}`} className="hhh-button hhh-button--outline">
                Read featured article <ArrowRight aria-hidden="true" />
              </PublicLink>
            </div>
          </article>

          <div className="hhh-blog__heading">
            <div>
              <p className="hhh-kicker">More from the journal</p>
              <h2>Explore our latest articles</h2>
            </div>
            <span>{posts.length} articles</span>
          </div>

          <div className="hhh-post-grid hhh-post-grid--wide">
            {morePosts.map(post => <PostCard key={post.slug} post={post} />)}
          </div>
        </section>
      </main>
    </PageShell>
  );
}

function ArticlePage({ slug }: { slug: string }) {
  const post = posts.find(item => item.slug === slug);
  if (!post) return <NotFoundPage />;

  return (
    <PageShell>
      <main id="main-content">
        <article className="hhh-article hhh-section-inner hhh-reveal">
          <PublicLink href="/blog" className="hhh-text-link">← Back to all journal articles</PublicLink>
          <p className="hhh-post-meta">{post.author} · {post.date} · {post.read}</p>
          <h1>{post.title}</h1>
          <p className="hhh-article__lead">{post.excerpt}</p>
          <PostArtwork post={post} large />
          <div className="hhh-article__content">
            {post.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
          <aside className="hhh-article__disclaimer">
            <strong>Important Clinical Notice</strong>
            <p>This article provides general educational information and is not medical advice. Prescription decisions for cannabis-based medicinal products (CBPM) must be made by a specialist doctor on the GMC register following an individual clinical assessment.</p>
          </aside>
        </article>
      </main>
    </PageShell>
  );
}

function PrivacyPage() {
  return (
    <PageShell>
      <main id="main-content">
        <article className="hhh-legal hhh-section-inner hhh-reveal">
          <p className="hhh-kicker">Legal &amp; Privacy</p>
          <h1>Privacy Policy</h1>
          <p>
            This privacy policy explains how Holistic Health Hub collects, uses and shares personal information when you visit our website or use our services. We are committed to protecting your privacy and complying with the UK GDPR and Data Protection Act 2018.
          </p>
          <p>
            <strong>ICO Registration:</strong> We comply with current requirements to notify our data processing activities to the Information Commissioner’s Office and are registered under number <strong>ZB639206</strong>.
          </p>

          <h2>Data Protection Principles</h2>
          <p>
            Personal information must be processed fairly, lawfully and transparently; collected for explicit and legitimate purposes; adequate, relevant and limited to what is necessary; accurate; retained only as long as needed; and processed securely.
          </p>

          <h2>What information do we collect?</h2>
          <ul>
            <li>Personal and contact details (name, date of birth, postcode, email, mobile number).</li>
            <li>Communications about our services and pre-screening enquiries.</li>
            <li>Website usage and technical telemetry (without storing health information in tracking URLs).</li>
            <li>With explicit consent through the secure eligibility intake, information about your health and medical history.</li>
          </ul>

          <h2>How is your personal information collected?</h2>
          <p>
            We collect information when you complete the secure eligibility check, enquire about our services, or communicate with our team. We may also receive relevant referral information from partner doctors and your nominated community pharmacy.
          </p>

          <h2>How do we use and share your information?</h2>
          <p>
            We use information to provide and improve services, communicate with you, meet legal obligations, and complete referral checks. Where appropriate and consented to, information is shared with a CQC-registered specialist clinic, your nominated community pharmacy, professional advisers, or regulators.
          </p>

          <h2>How do we protect your information?</h2>
          <p>
            We employ robust technical and organizational safeguards, restrict access to authorized personnel, train staff on confidentiality, and enforce fail-closed data separation between pre-screening and pharmacy activation.
          </p>

          <h2>Your rights</h2>
          <p>
            You have the right to access, rectify, erase, restrict or object to the processing of your personal data, withdraw consent at any time, and lodge a complaint with the UK Information Commissioner’s Office (ICO).
          </p>

          <h2>Cookies and Storage</h2>
          <p>
            We use strictly necessary and functional technologies to operate our services securely. No sensitive health information is stored in local storage or cookies.
          </p>

          <h2>Contact Us</h2>
          <p>
            Holistic Health Hub<br />
            124 City Road, London, EC1V 2NX<br />
            <a href="mailto:info@holistichealthhub.live">info@holistichealthhub.live</a>
          </p>
        </article>
      </main>
    </PageShell>
  );
}

function ConsentPage() {
  return (
    <PageShell>
      <main id="main-content">
        <article className="hhh-legal hhh-section-inner hhh-reveal">
          <p className="hhh-kicker">Terms &amp; Consent</p>
          <h1>Consent and terms of use</h1>
          <p>
            New eligibility applications are reviewed first by Holistic Health Hub. A community pharmacy does not receive the application while HHH is completing its intake and referral checks.
          </p>

          <h2>Your information and consent</h2>
          <p>
            Health information is sensitive and is collected only through the secure eligibility flow with explicit patient consent. A pharmacy selected on the main website is a preference until HHH confirms the final referral. A pharmacy-specific link has a fixed destination, but HHH still completes the intake review before activating the referral for that pharmacy.
          </p>

          <h2>Clinical decisions</h2>
          <p>
            An eligibility check is not a medical diagnosis, guarantee of consultation, or promise of a prescription. A specialist physician on the GMC Specialist Register makes all treatment decisions following an individual assessment and MDT review.
          </p>

          <h2>Treatment costs</h2>
          <p>
            Private medical consultations and prescribed cannabis-based medicines involve fees (£30 consultation fees and indicative medication pricing). Applicable charges are confirmed before you proceed with treatment.
          </p>

          <h2>Questions</h2>
          <p>
            For questions regarding consent or terms, contact Holistic Health Hub at{' '}
            <a href="mailto:info@holistichealthhub.live">info@holistichealthhub.live</a>.
          </p>
        </article>
      </main>
    </PageShell>
  );
}

function NotFoundPage() {
  return (
    <PageShell>
      <main id="main-content">
        <section className="hhh-not-found hhh-section-inner hhh-reveal">
          <p className="hhh-kicker">404 Error</p>
          <h1>We couldn’t find that page.</h1>
          <p>The link may have moved, or the page may no longer be published. Return home to continue your care journey.</p>
          <PublicLink href="/" className="hhh-button hhh-button--rust">
            Back to homepage <ArrowRight aria-hidden="true" />
          </PublicLink>
        </section>
      </main>
    </PageShell>
  );
}

function updateMetaTag(selector: string, content: string | null) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (content === null) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement('meta');
    if (selector.startsWith('meta[name=')) {
      const name = selector.match(/name="([^"]+)"/)?.[1];
      if (name) element.setAttribute('name', name);
    } else if (selector.startsWith('meta[property=')) {
      const property = selector.match(/property="([^"]+)"/)?.[1];
      if (property) element.setAttribute('property', property);
    }
    document.head.appendChild(element);
  }
  element.content = content;
}

function updateCanonicalLink(url: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!element) {
    element = document.createElement('link');
    element.rel = 'canonical';
    document.head.appendChild(element);
  }
  element.href = url;
}

function updateJsonLd(schemaId: string, schema: object | null) {
  const existing = document.getElementById(schemaId);
  if (schema === null) {
    existing?.remove();
    return;
  }
  let script = existing as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = schemaId;
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(schema);
}

export default function PublicSite() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  useEffect(() => {
    const isPost = path.startsWith('/post/');
    const article = isPost ? posts.find(item => item.slug === path.slice('/post/'.length)) : null;

    const pageMeta = article
      ? {
          title: `${article.title} | Holistic Health Hub Journal`,
          description: article.excerpt,
          type: 'article',
          is404: false,
        }
      : {
          '/': {
            title: 'Holistic Health Hub | UK Medical Cannabis & CBPM Specialist Referral',
            description: 'Access personalised medical cannabis (CBPM) care programmes through Holistic Health Hub, partnered specialist doctors and trusted community pharmacies.',
            type: 'website',
            is404: false,
          },
          '/how-it-works': {
            title: 'How It Works | 4-Step Medical Cannabis Consultation & Pharmacy Care | HHH',
            description: 'Discover the 4-step route to care: confidential pre-screening, specialist online doctor consultation, MDT review, and community pharmacy dispensing.',
            type: 'website',
            is404: false,
          },
          '/conditions': {
            title: 'Treatable Conditions | Medical Cannabis & Chronic Pain Referral | HHH',
            description: 'Learn about chronic pain, neurological, and psychiatric conditions considered for cannabis-based medicinal products (CBPM) in the UK.',
            type: 'website',
            is404: false,
          },
          '/pricing': {
            title: 'Transparent Pricing | £30 Specialist Consultations & Medication Costs | HHH',
            description: 'Clear, transparent pricing: £30 initial and follow-up specialist consultations, with indicative pharmacy medication pricing.',
            type: 'website',
            is404: false,
          },
          '/about': {
            title: 'About Us | Specialist Clinicians & Community Pharmacy Network | HHH',
            description: 'Meet Holistic Health Hub. Discover our personal, pharmacy-connected approach to specialist medical care and our commitment to the planet.',
            type: 'website',
            is404: false,
          },
          '/faq': {
            title: 'Frequently Asked Questions | UK Medical Cannabis & CBPM Therapy | HHH',
            description: 'Clear, accurate answers to common questions about UK medical cannabis legality, eligibility, consultation process, and prescription costs.',
            type: 'website',
            is404: false,
          },
          '/contact': {
            title: 'Contact Us | Patient Support & General Enquiries | Holistic Health Hub',
            description: 'Contact the Holistic Health Hub team for general service enquiries, or begin a confidential online eligibility check securely.',
            type: 'website',
            is404: false,
          },
          '/blog': {
            title: 'Journal & Educational Articles | Medical Cannabis & Wellbeing | HHH',
            description: 'Educational articles and clinical insights on sleep, chronic pain management, anxiety, the endocannabinoid system, and medical cannabis.',
            type: 'website',
            is404: false,
          },
          '/privacy': {
            title: 'Privacy Policy | UK GDPR & Data Protection | Holistic Health Hub',
            description: 'Learn how Holistic Health Hub protects your health data under the UK GDPR, Data Protection Act 2018, and ICO registration ZB639206.',
            type: 'website',
            is404: false,
          },
          '/consent': {
            title: 'Consent & Terms of Use | Holistic Health Hub',
            description: 'Understand patient consent, intake review terms, clinical MDT assessments, and treatment pricing for Holistic Health Hub.',
            type: 'website',
            is404: false,
          },
        }[path as '/' | '/how-it-works' | '/conditions' | '/pricing' | '/about' | '/faq' | '/contact' | '/blog' | '/privacy' | '/consent'] ?? {
          title: 'Page Not Found | Holistic Health Hub',
          description: 'The requested Holistic Health Hub page could not be found. Return to our homepage to continue.',
          type: 'website',
          is404: true,
        };

    const canonicalUrl = `${CANONICAL_ORIGIN}${path === '/' ? '/' : path}`;
    document.title = pageMeta.title;

    updateMetaTag('meta[name="description"]', pageMeta.description);
    updateMetaTag('meta[property="og:title"]', pageMeta.title);
    updateMetaTag('meta[property="og:description"]', pageMeta.description);
    updateMetaTag('meta[property="og:url"]', canonicalUrl);
    updateMetaTag('meta[property="og:type"]', pageMeta.type);
    updateMetaTag('meta[property="og:locale"]', 'en_GB');
    updateMetaTag('meta[property="og:image"]', `${CANONICAL_ORIGIN}/og.jpg`);
    updateMetaTag('meta[name="twitter:title"]', pageMeta.title);
    updateMetaTag('meta[name="twitter:description"]', pageMeta.description);
    updateMetaTag('meta[name="twitter:image"]', `${CANONICAL_ORIGIN}/og.jpg`);

    if (pageMeta.is404) {
      updateMetaTag('meta[name="robots"]', 'noindex, follow');
    } else {
      updateMetaTag('meta[name="robots"]', 'index, follow, max-image-preview:large');
    }

    updateCanonicalLink(canonicalUrl);

    // Organization & WebSite JSON-LD Schema
    updateJsonLd('hhh-schema-org', {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Holistic Health Hub',
      url: CANONICAL_ORIGIN,
      logo: `${CANONICAL_ORIGIN}/holistic-health-hub-logo.png`,
      description: 'Personalised specialist healthcare connecting patients to specialist doctors and participating community pharmacies for cannabis-based medicinal products (CBPM).',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '124 City Road',
        addressLocality: 'London',
        postalCode: 'EC1V 2NX',
        addressCountry: 'GB',
      },
      contactPoint: {
        '@type': 'ContactPoint',
        email: 'info@holistichealthhub.live',
        contactType: 'customer support',
      },
      sameAs: [
        'https://www.instagram.com/holistichealthhub1',
        'https://www.facebook.com/profile.php?id=61555967331192',
      ],
    });

    updateJsonLd('hhh-schema-website', {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Holistic Health Hub',
      url: CANONICAL_ORIGIN,
    });

    // Page Specific Schema
    if (path === '/faq') {
      updateJsonLd('hhh-schema-faq', {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.map(([q, a]) => ({
          '@type': 'Question',
          name: q,
          acceptedAnswer: {
            '@type': 'Answer',
            text: a,
          },
        })),
      });
    } else {
      updateJsonLd('hhh-schema-faq', null);
    }

    if (article) {
      updateJsonLd('hhh-schema-article', {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: article.title,
        description: article.excerpt,
        author: {
          '@type': 'Person',
          name: article.author,
        },
        publisher: {
          '@type': 'Organization',
          name: 'Holistic Health Hub',
          logo: {
            '@type': 'ImageObject',
            url: `${CANONICAL_ORIGIN}/holistic-health-hub-logo.png`,
          },
        },
        datePublished: article.dateIso,
        mainEntityOfPage: canonicalUrl,
      });
    } else {
      updateJsonLd('hhh-schema-article', null);
    }

    return () => {
      // Clean up dynamic schemas on unmount
      updateJsonLd('hhh-schema-faq', null);
      updateJsonLd('hhh-schema-article', null);
    };
  }, [path]);

  if (path === '/') return <HomePage />;
  if (path === '/how-it-works') return <HowItWorksPage />;
  if (path === '/conditions') return <ConditionsPage />;
  if (path === '/pricing') return <PricingPage />;
  if (path === '/about') return <AboutPage />;
  if (path === '/faq' || path === '/general-5') return <FaqPage />;
  if (path === '/contact') return <ContactPage />;
  if (path === '/blog' || path.startsWith('/blog/categories/')) return <BlogPage />;
  if (path === '/privacy' || path === '/general-5-1') return <PrivacyPage />;
  if (path === '/consent') return <ConsentPage />;
  if (path.startsWith('/post/')) return <ArticlePage slug={path.slice('/post/'.length)} />;

  return <NotFoundPage />;
}
