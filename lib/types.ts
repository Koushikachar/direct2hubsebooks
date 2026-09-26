export interface ProductView {
  id: string;
  title: string;
  tagline?: string;
  aboutTitle: string;
  about: string;
  bullets: string[];
  learnFrom: string;
  learnFromBio: string;
  contactPhone: string;
  whatsappUrl: string;
  whatsappGroupUrl: string;
  youtubeUrl: string;
  instagramUrl: string;
  logoUrl: string;
  heroImageUrl: string;
  videoUrl?: string;
  previewImage1Url?: string;
  previewImage2Url?: string;
  previewImage3Url?: string;
  pdfUrl?: string;
  pdfSizeKb: number;
  // See prisma/schema.prisma — blank by default; the UI hides the
  // "Business details" section until these are filled in via /admin.
  businessLegalName?: string;
  registeredAddress?: string;
  grievanceOfficerName?: string;
  grievanceOfficerEmail?: string;
}

export interface ReviewView {
  id: string;
  name: string;
  rating: number;
  comment: string;
  createdAt: string;
  // True only when the reviewer proved a paid purchase (their order access
  // code was checked against a paid Submission at write time). Absent/false
  // for older reviews written before verification existed.
  verified?: boolean;
}

export interface ReviewsSummary {
  average: number;
  count: number;
  breakdown: Record<1 | 2 | 3 | 4 | 5, number>;
}
