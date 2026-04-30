// api/match-score.js — Job match scoring for Roei Klein's profile

const WEIGHTS = { title: 35, keywords: 30, seniority: 15, company_tier: 10, location_lang: 10 };

const PROFILE = {
  target_titles: ['AI Analyst', 'Data Analyst', 'Growth Analyst', 'Product Manager', 'AI Product Manager', 'Analytics Manager', 'Business Analyst', 'Growth Manager'],
  skills: ['Python', 'SQL', 'Machine Learning', 'Statistics', 'Pandas', 'Scikit-Learn', 'Excel', 'BI', 'SPSS', 'CRM', 'Product Roadmap', 'User Research', 'Growth Metrics', 'Business Analysis', 'Data Science', 'Analytics', 'KPI', 'Dashboard', 'Tableau', 'Power BI', 'A/B Testing'],
  years_experience: 5,
  preferred_seniority: ['mid', 'senior', 'junior'],
  location: 'Israel',
  willing_remote: true,
  languages: ['Hebrew', 'English'],
  preferred_companies: ['Wix', 'Monday', 'monday.com', 'AppsFlyer', 'Lightricks', 'SentinelOne', 'Riskified', 'Fiverr', 'Payoneer', 'Taboola', 'Outbrain', 'Amdocs', 'Check Point', 'CyberArk', 'IronSource', 'ironSource', 'Kaltura', 'Playtika'],
};

function scoreTitle(jobTitle, targetTitles) {
  if (!jobTitle) return 40;
  const t = jobTitle.toLowerCase();
  for (const target of targetTitles) {
    const tl = target.toLowerCase();
    if (t.includes(tl) || tl.includes(t)) return 95;
    const words = tl.split(' ');
    const matchedWords = words.filter(w => t.includes(w));
    if (matchedWords.length >= words.length * 0.6) return 80;
  }
  // Partial keyword matches
  const jobWords = t.split(/\s+/);
  const allTargetWords = targetTitles.join(' ').toLowerCase().split(/\s+/);
  const overlap = jobWords.filter(w => w.length > 3 && allTargetWords.includes(w)).length;
  return Math.min(70, 40 + overlap * 15);
}

function scoreKeywords(text, profileSkills) {
  if (!text) return 30;
  const found = profileSkills.filter(s => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
  return Math.min(100, Math.round((found.length / Math.max(8, profileSkills.length * 0.3)) * 100));
}

function scoreSeniority(text, userYears) {
  if (!text) return 60;
  const t = text.toLowerCase();
  const yearMatch = t.match(/(\d+)\+?\s*(?:years?|שנ)/i);
  if (yearMatch) {
    const required = parseInt(yearMatch[1]);
    if (required <= userYears + 1) return 90;
    if (required <= userYears + 2) return 70;
    return 40;
  }
  if (/junior|entry.level|0-2|1-2|fresher/i.test(t)) return 85;
  if (/senior|lead|principal|staff|7\+|8\+|10\+/i.test(t)) return 55;
  return 70;
}

function scoreCompanyTier(company, preferredCompanies) {
  if (!company) return 60;
  const c = company.toLowerCase();
  if (preferredCompanies.some(p => c.includes(p.toLowerCase()) || p.toLowerCase().includes(c))) return 100;
  if (/google|apple|microsoft|amazon|meta|facebook|netflix|uber|airbnb|stripe/i.test(c)) return 95;
  return 65;
}

function scoreLocationLang(jobLocation, profile) {
  if (!jobLocation) return 70;
  const l = jobLocation.toLowerCase();
  if (l.includes('israel') || l.includes('ישראל') || l.includes('tel aviv') || l.includes('תל אביב') ||
      l.includes('herzliya') || l.includes('petah tikva') || l.includes('ramat gan') || l.includes('remote')) return 100;
  if (profile.willing_remote && l.includes('remote')) return 100;
  return 50;
}

function extractMissingKeywords(text, skills) {
  if (!text) return [];
  return skills.filter(s => !new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)).slice(0, 5);
}

function calculateMatch(job, profile) {
  const desc = (job.description_full || job.description_summary || job.description || '');
  const breakdown = {
    title: scoreTitle(job.title, profile.target_titles),
    keywords: scoreKeywords(desc, profile.skills),
    seniority: scoreSeniority(desc, profile.years_experience),
    company_tier: scoreCompanyTier(job.company, profile.preferred_companies),
    location_lang: scoreLocationLang(job.location || '', profile),
  };
  const total = Object.entries(breakdown).reduce((sum, [k, v]) => sum + (v * WEIGHTS[k] / 100), 0);
  return {
    score: Math.round(total),
    breakdown,
    matched_keywords: profile.skills.filter(s => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(desc)),
    missing_keywords: extractMissingKeywords(desc, profile.skills),
    match_explanation: buildExplanation(breakdown, job),
  };
}

function buildExplanation(breakdown, job) {
  const parts = [];
  if (breakdown.title >= 80) parts.push(`כותרת "${job.title}" מתאימה מצוין`);
  else if (breakdown.title >= 60) parts.push(`כותרת "${job.title}" קרובה לפרופיל`);
  if (breakdown.keywords >= 70) parts.push('התאמת מיומנויות גבוהה');
  if (breakdown.company_tier >= 90) parts.push(`${job.company} — חברה מועדפת`);
  if (breakdown.seniority < 60) parts.push('דרישת ניסיון גבוהה — שים לב');
  return parts.join('. ') || 'ניתוח בסיסי';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { job, profile_override } = req.body || {};
    if (!job) return res.status(400).json({ error: 'Missing job object' });
    const p = profile_override ? { ...PROFILE, ...profile_override } : PROFILE;
    const result = calculateMatch(job, p);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
