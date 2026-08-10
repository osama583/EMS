import { ChangeDetectionStrategy, Component } from '@angular/core';

interface FooterAward {
  readonly alt: string;
  readonly kind: 'digital' | 'qs' | 'world' | 'work' | 'talentbank';
  readonly src: string;
}

interface FooterLink {
  readonly label: string;
  readonly href: string;
  readonly external?: boolean;
}

interface FooterLinkGroup {
  readonly title: string;
  readonly links: readonly FooterLink[];
}

interface SocialLink {
  readonly label: string;
  readonly href: string;
  readonly icon: string;
}

@Component({
  selector: 'app-site-footer',
  templateUrl: './site-footer.html',
  styleUrl: './site-footer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteFooterComponent {
  readonly awards: readonly FooterAward[] = [
    {
      alt: 'Premier Digital Tech Institution',
      kind: 'digital',
      src: '/assets/media/footer/award-premier-digital-tech.png',
    },
    {
      alt: 'QS 5 Stars Plus',
      kind: 'qs',
      src: '/assets/media/footer/award-qs-five-stars.png',
    },
    {
      alt: 'QS World University Rankings',
      kind: 'world',
      src: '/assets/media/footer/award-qs-world-ranking.png',
    },
    {
      alt: 'Life at Work Awards winner',
      kind: 'work',
      src: '/assets/media/footer/award-life-at-work.png',
    },
    {
      alt: 'Talentbank Graduate Employability Index',
      kind: 'talentbank',
      src: '/assets/media/footer/award-talentbank-employability.jpg',
    },
  ];

  readonly socialLinks: readonly SocialLink[] = [
    {
      label: 'APU on Facebook',
      href: 'https://facebook.com/apuniversity',
      icon: '/assets/media/footer/social-facebook.png',
    },
    {
      label: 'APU on Instagram',
      href: 'https://instagram.com/asiapacificuniversity',
      icon: '/assets/media/footer/social-instagram.png',
    },
    {
      label: 'APU on LinkedIn',
      href: 'https://www.linkedin.com/school/apumalaysia',
      icon: '/assets/media/footer/social-linkedin.png',
    },
    {
      label: 'APU on X',
      href: 'https://twitter.com/AsiaPacificU',
      icon: '/assets/media/footer/social-x.png',
    },
    {
      label: 'APU on YouTube',
      href: 'https://www.youtube.com/c/AsiaPacificUniversityKualaLumpur',
      icon: '/assets/media/footer/social-youtube.png',
    },
    {
      label: 'APU on TikTok',
      href: 'https://www.tiktok.com/@apumalaysia',
      icon: '/assets/media/footer/social-tiktok.png',
    },
  ];

  readonly linkGroups: readonly FooterLinkGroup[] = [
    {
      title: 'Study',
      links: [
        { label: 'Courses', href: 'https://www.apu.edu.my/our-courses' },
        { label: 'Intake Calendar', href: 'https://www.apu.edu.my/intake-calendar' },
        {
          label: 'Download e-Brochures',
          href: 'https://www.apu.edu.my/download-eBrochures',
        },
        { label: 'Apply Now', href: 'https://admissions.apu.edu.my/', external: true },
        {
          label: 'Scholarships & Loan',
          href: 'https://www.apu.edu.my/scholarships-financial-aids',
        },
        {
          label: 'APU Holiday Schedule',
          href: 'https://www.apu.edu.my/apu-holiday-schedule',
        },
      ],
    },
    {
      title: 'Campus',
      links: [
        { label: 'Campus Living', href: 'https://www.apu.edu.my/life-apu' },
        { label: 'Campus Facilities', href: 'https://www.apu.edu.my/campus-facilities' },
        { label: 'APU Residence', href: 'https://www.apu.edu.my/apu-residence' },
        {
          label: 'Student Activities',
          href: 'https://studentaffairold.sites.apiit.edu.my/club-and-society/',
          external: true,
        },
        {
          label: 'Sports & Recreation',
          href: 'https://studentaffairold.sites.apiit.edu.my/sports/',
          external: true,
        },
        { label: 'Student Services', href: 'https://www.apu.edu.my/student-services' },
      ],
    },
    {
      title: 'Hall',
      links: [
        {
          label: 'Awards & Recognitions',
          href: 'https://www.apu.edu.my/awards-recognitions',
        },
        { label: 'News Articles', href: 'https://www.apu.edu.my/news-happening' },
        {
          label: 'DMU - Our Partner in Quality',
          href: 'https://www.apu.edu.my/dmu-our-partner-quality',
        },
        {
          label: 'Sustainability @ APU',
          href: 'https://www.apu.edu.my/sustainability-apu',
        },
        { label: 'Video Gallery', href: 'https://www.apu.edu.my/video-gallery' },
      ],
    },
    {
      title: 'International',
      links: [
        { label: 'Living in Malaysia', href: 'https://www.apu.edu.my/study-malaysia' },
        {
          label: 'International Applications',
          href: 'https://www.apu.edu.my/international-students-application-procedures',
        },
        { label: 'Study Abroad', href: 'https://www.apu.edu.my/study-abroad' },
        {
          label: 'Student Ambassadors',
          href: 'https://www.apu.edu.my/student-ambassadors',
        },
      ],
    },
    {
      title: 'About',
      links: [
        { label: 'The University', href: 'https://www.apu.edu.my/the-university' },
        {
          label: 'Premier Digital Tech University',
          href: 'https://www.apu.edu.my/premier-digital-tech-institution',
        },
        {
          label: 'APU Erasmus+ Friends',
          href: 'https://www.apu.edu.my/apu-erasmus-friends-project',
        },
      ],
    },
    {
      title: 'Connect',
      links: [
        { label: 'Contact Us', href: 'https://www.apu.edu.my/connect' },
        {
          label: 'Getting There',
          href: 'https://www.google.com/maps?daddr=3.0554057%2C101.7005614',
          external: true,
        },
        {
          label: 'Connect with Counsellors',
          href: 'https://www.apu.edu.my/apu-e-counselling',
        },
        {
          label: 'Collaborative Industrial Partners',
          href: 'https://www.apu.edu.my/collaborative-industrial-partners',
        },
        { label: 'Refund Policy', href: 'https://www.apu.edu.my/fees-refund-policy' },
      ],
    },
  ];
}
