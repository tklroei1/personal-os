// job-hunt-config.js — Roei's job-hunt knowledge base.
// ROLE_DOMAINS: the full taxonomy of roles that fit Roei (student/junior only),
// with synonyms, used both for LinkedIn keyword rotation and for filtering
// company career-page listings.
// COMPANIES: curated Israeli tech & finance companies (Tel Aviv + center),
// with interest level 1-3 (3 = most interesting for Roei's startup ambitions)
// and ATS info — greenhouse/lever slugs let the agent scan their job boards
// for FREE via public APIs. Slugs are best-effort; 404s are skipped silently.

export const ROLE_DOMAINS = {
  ai_data: {
    label: 'AI & Data',
    priority: 3,
    linkedinKeywords: ['AI Analyst', 'GenAI Specialist', 'Junior Data Analyst', 'AI Operations', 'Prompt Engineer', 'Data Analyst Student', 'AI Product Analyst', 'Analytics Engineer Junior'],
    titles: [
      'AI Analyst', 'GenAI Specialist', 'Generative AI Specialist', 'LLM Specialist', 'Prompt Engineer',
      'AI Operations', 'AI Ops', 'AI Implementation Specialist', 'AI Solutions Specialist', 'AI Enablement',
      'AI Product Analyst', 'AI Research Analyst', 'AI Trainer', 'Conversation Designer',
      'Data Analyst', 'Junior Data Analyst', 'Data Analyst Student', 'Student Data Analyst',
      'BI Analyst', 'Business Intelligence Analyst', 'BI Developer Junior', 'Insights Analyst',
      'Junior Data Scientist', 'Data Science Student', 'Data Science Intern',
      'Analytics Engineer', 'Junior ML Engineer', 'ML Engineer Student', 'Machine Learning Intern',
      'Research Analyst', 'Quantitative Analyst Junior',
    ],
  },
  product: {
    label: 'Product',
    priority: 3,
    linkedinKeywords: ['Junior Product Manager', 'Associate Product Manager', 'Product Analyst', 'Product Operations', 'Business Analyst Product'],
    titles: [
      'Junior Product Manager', 'Associate Product Manager', 'APM', 'Product Management Intern',
      'Product Analyst', 'Junior Product Analyst', 'Product Data Analyst',
      'Product Operations', 'Product Ops', 'Product Operations Analyst', 'Product Specialist',
      'Junior Product Owner', 'Technical Product Manager Junior', 'Product Associate',
    ],
  },
  growth_marketing: {
    label: 'Growth & Marketing',
    priority: 2,
    linkedinKeywords: ['Growth Analyst', 'Marketing Analyst', 'Marketing Data Analyst', 'Performance Marketing Analyst', 'User Acquisition Analyst'],
    titles: [
      'Growth Analyst', 'Growth Marketing Analyst', 'Growth Associate', 'Growth Operations',
      'Marketing Analyst', 'Marketing Data Analyst', 'Digital Marketing Analyst',
      'Performance Marketing Analyst', 'PPC Analyst', 'User Acquisition Analyst', 'UA Analyst',
      'Monetization Analyst', 'CRO Analyst', 'Conversion Analyst', 'Marketing Operations Analyst',
    ],
  },
  business_strategy: {
    label: 'Business & Strategy',
    priority: 2,
    linkedinKeywords: ['Business Analyst', 'Strategy Analyst', 'Business Operations Analyst', 'Revenue Operations Analyst', 'Sales Operations Analyst'],
    titles: [
      'Business Analyst', 'Junior Business Analyst', 'Business Analyst Student',
      'Strategy Analyst', 'Corporate Strategy Analyst', 'Strategy & Operations',
      'Business Operations Analyst', 'BizOps Analyst', 'Operations Analyst',
      'Revenue Operations Analyst', 'RevOps Analyst', 'Sales Operations Analyst', 'Sales Ops',
      'Business Development Associate', 'BizDev Associate', 'Chief of Staff Associate',
      'Commercial Analyst', 'GTM Analyst', 'Partnerships Analyst',
    ],
  },
  finance_investments: {
    label: 'Finance & Investments',
    priority: 3,
    linkedinKeywords: ['Investment Analyst', 'VC Analyst', 'Private Equity Analyst', 'Financial Analyst Junior', 'Equity Research Analyst', 'Economist Junior', 'M&A Analyst'],
    titles: [
      'Investment Analyst', 'Junior Investment Analyst', 'Investment Associate Junior',
      'VC Analyst', 'Venture Capital Analyst', 'Venture Analyst', 'Investment Team Analyst',
      'Private Equity Analyst', 'PE Analyst', 'Equity Research Analyst', 'Research Analyst Finance',
      'Financial Analyst', 'Junior Financial Analyst', 'FP&A Analyst', 'Finance Student',
      'M&A Analyst', 'Corporate Development Analyst', 'Corporate Finance Analyst',
      'Economist', 'Junior Economist', 'Economic Analyst', 'Credit Analyst', 'Portfolio Analyst',
      'Fintech Analyst', 'Investment Banking Analyst', 'Fund Analyst', 'Due Diligence Analyst',
    ],
  },
  student_intern: {
    label: 'Student & Internships',
    priority: 2,
    linkedinKeywords: ['Student Data', 'Student Analyst', 'Product Intern', 'AI Intern', 'Finance Student Position'],
    titles: [
      'Student Position', 'Student Analyst', 'Working Student', 'Intern', 'Internship',
      'Student Data Analyst', 'Student BI', 'Student Product', 'Student Economist',
      'Data Intern', 'AI Intern', 'Product Intern', 'Finance Intern', 'Strategy Intern',
    ],
  },
};

// Negative title filter — discard immediately (senior/irrelevant/abroad)
export const TITLE_BLOCKLIST = /\b(senior|sr\.?|staff|principal|lead|head|director|vp|chief|architect|expert|manager(?!.*(junior|associate|intern))|frontend|backend|fullstack|full-stack|devops|qa|embedded|hardware|mechanical|electrical|attorney|lawyer|nurse|physician)\b/i;

// Allowed locations (company job boards list global offices — keep Israel center only)
export const LOCATION_ALLOW = /(tel.?aviv|ramat.?gan|givatayim|herzliya|petah|petach|ra'?anana|raanana|bnei.?brak|holon|rosh.?ha'?ayin|or.?yehuda|kfar.?saba|netanya|israel|tlv|תל אביב|רמת גן|הרצליה|פתח|רעננה|ישראל)/i;

// COMPANIES — interest: 3=dream/startup-relevant, 2=great, 1=solid.
// ats: { type: 'greenhouse'|'lever', slug } → scanned automatically (free public API).
// Companies without ats are kept for reference / future scraping.
export const COMPANIES = [
  // ── AI-first / hot startups (interest 3) ──
  { name: 'AI21 Labs', domain: 'ai', interest: 3, ats: { type: 'greenhouse', slug: 'ai21labs' } },
  { name: 'Lightricks', domain: 'ai', interest: 3, ats: { type: 'greenhouse', slug: 'lightricks' } },
  { name: 'D-ID', domain: 'ai', interest: 3, ats: { type: 'greenhouse', slug: 'did' } },
  { name: 'Verbit', domain: 'ai', interest: 2, ats: { type: 'greenhouse', slug: 'verbit' } },
  { name: 'Gong', domain: 'ai', interest: 3, ats: { type: 'greenhouse', slug: 'gong' } },
  { name: 'Tabnine', domain: 'ai', interest: 3, ats: { type: 'greenhouse', slug: 'tabnine' } },
  { name: 'Pinecone', domain: 'ai', interest: 3, ats: { type: 'greenhouse', slug: 'pinecone' } },
  { name: 'Base44/Wix AI', domain: 'ai', interest: 3, ats: null },
  { name: 'Aleph Alpha IL', domain: 'ai', interest: 2, ats: null },

  // ── Big product companies (interest 3) ──
  { name: 'monday.com', domain: 'product', interest: 3, ats: { type: 'greenhouse', slug: 'monday' } },
  { name: 'Wix', domain: 'product', interest: 3, ats: null, careersUrl: 'https://www.wix.com/jobs' },
  { name: 'Fiverr', domain: 'product', interest: 3, ats: { type: 'greenhouse', slug: 'fiverr' } },
  { name: 'Lemonade', domain: 'product', interest: 3, ats: { type: 'greenhouse', slug: 'lemonade' } },
  { name: 'Riskified', domain: 'product', interest: 2, ats: { type: 'greenhouse', slug: 'riskified' } },
  { name: 'Melio', domain: 'fintech', interest: 3, ats: { type: 'greenhouse', slug: 'melio' } },
  { name: 'Payoneer', domain: 'fintech', interest: 2, ats: { type: 'greenhouse', slug: 'payoneer' } },
  { name: 'Rapyd', domain: 'fintech', interest: 2, ats: { type: 'greenhouse', slug: 'rapyd' } },
  { name: 'AppsFlyer', domain: 'data', interest: 3, ats: { type: 'greenhouse', slug: 'appsflyer' } },
  { name: 'Similarweb', domain: 'data', interest: 3, ats: { type: 'greenhouse', slug: 'similarweb' } },
  { name: 'Taboola', domain: 'adtech', interest: 2, ats: { type: 'greenhouse', slug: 'taboola' } },
  { name: 'Outbrain', domain: 'adtech', interest: 2, ats: { type: 'greenhouse', slug: 'outbrain' } },
  { name: 'Unity Israel (ironSource)', domain: 'gaming', interest: 2, ats: null },
  { name: 'Playtika', domain: 'gaming', interest: 2, ats: null, careersUrl: 'https://www.playtika.com/careers/' },
  { name: 'Moon Active', domain: 'gaming', interest: 2, ats: { type: 'lever', slug: 'moonactive' } },
  { name: 'Papaya Gaming', domain: 'gaming', interest: 2, ats: null },
  { name: 'Next Insurance', domain: 'fintech', interest: 2, ats: { type: 'greenhouse', slug: 'nextinsurance' } },
  { name: 'HoneyBook', domain: 'product', interest: 3, ats: { type: 'greenhouse', slug: 'honeybook' } },
  { name: 'Bringg', domain: 'product', interest: 2, ats: null },
  { name: 'Yotpo', domain: 'product', interest: 2, ats: { type: 'greenhouse', slug: 'yotpo' } },
  { name: 'Optimove', domain: 'data', interest: 2, ats: { type: 'greenhouse', slug: 'optimove' } },
  { name: 'Riverside.fm', domain: 'product', interest: 3, ats: { type: 'greenhouse', slug: 'riversidefm' } },
  { name: 'Lusha', domain: 'data', interest: 2, ats: { type: 'greenhouse', slug: 'lusha' } },
  { name: 'Walnut', domain: 'product', interest: 2, ats: null },
  { name: 'Guesty', domain: 'product', interest: 2, ats: { type: 'greenhouse', slug: 'guesty' } },
  { name: 'Duda', domain: 'product', interest: 2, ats: { type: 'greenhouse', slug: 'duda' } },
  { name: 'WSC Sports', domain: 'ai', interest: 2, ats: { type: 'greenhouse', slug: 'wscsports' } },
  { name: 'Artlist', domain: 'product', interest: 2, ats: { type: 'greenhouse', slug: 'artlist' } },
  { name: 'Elementor', domain: 'product', interest: 2, ats: { type: 'greenhouse', slug: 'elementor' } },

  // ── Cyber (interest 2 — strong companies, good learning) ──
  { name: 'Wiz', domain: 'cyber', interest: 3, ats: { type: 'greenhouse', slug: 'wizinc' } },
  { name: 'Check Point', domain: 'cyber', interest: 2, ats: null, careersUrl: 'https://careers.checkpoint.com' },
  { name: 'CyberArk', domain: 'cyber', interest: 2, ats: null },
  { name: 'SentinelOne', domain: 'cyber', interest: 2, ats: { type: 'greenhouse', slug: 'sentinelone' } },
  { name: 'Cato Networks', domain: 'cyber', interest: 2, ats: { type: 'greenhouse', slug: 'catonetworks' } },
  { name: 'Claroty', domain: 'cyber', interest: 2, ats: { type: 'greenhouse', slug: 'claroty' } },
  { name: 'Axonius', domain: 'cyber', interest: 2, ats: { type: 'greenhouse', slug: 'axonius' } },
  { name: 'Orca Security', domain: 'cyber', interest: 2, ats: { type: 'greenhouse', slug: 'orcasecurity' } },
  { name: 'Aqua Security', domain: 'cyber', interest: 2, ats: { type: 'greenhouse', slug: 'aquasec' } },
  { name: 'Island', domain: 'cyber', interest: 2, ats: { type: 'greenhouse', slug: 'island' } },
  { name: 'Cyera', domain: 'cyber', interest: 2, ats: { type: 'greenhouse', slug: 'cyera' } },
  { name: 'Snyk', domain: 'cyber', interest: 2, ats: { type: 'greenhouse', slug: 'snyk' } },
  { name: 'Pentera', domain: 'cyber', interest: 2, ats: { type: 'greenhouse', slug: 'pentera' } },
  { name: 'Silverfort', domain: 'cyber', interest: 2, ats: { type: 'greenhouse', slug: 'silverfort' } },

  // ── Infra / Dev tools ──
  { name: 'JFrog', domain: 'devtools', interest: 2, ats: { type: 'greenhouse', slug: 'jfrog' } },
  { name: 'Redis', domain: 'devtools', interest: 2, ats: { type: 'greenhouse', slug: 'redis' } },
  { name: 'Port', domain: 'devtools', interest: 2, ats: { type: 'greenhouse', slug: 'getport' } },
  { name: 'Komodor', domain: 'devtools', interest: 2, ats: { type: 'greenhouse', slug: 'komodor' } },

  // ── Fintech / Finance-tech ──
  { name: 'eToro', domain: 'fintech', interest: 3, ats: { type: 'greenhouse', slug: 'etoro' } },
  { name: 'Pagaya', domain: 'fintech', interest: 3, ats: { type: 'greenhouse', slug: 'pagaya' } },
  { name: 'Tipalti', domain: 'fintech', interest: 2, ats: { type: 'greenhouse', slug: 'tipalti' } },
  { name: 'Fundbox', domain: 'fintech', interest: 2, ats: null },
  { name: 'Stampli', domain: 'fintech', interest: 2, ats: { type: 'greenhouse', slug: 'stampli' } },
  { name: 'Unit', domain: 'fintech', interest: 2, ats: null },
  { name: 'Mesh Payments', domain: 'fintech', interest: 2, ats: { type: 'greenhouse', slug: 'meshpayments' } },

  // ── Enterprise / global with strong IL center ──
  { name: 'Google Israel', domain: 'bigtech', interest: 3, ats: null, careersUrl: 'https://careers.google.com' },
  { name: 'Microsoft Israel', domain: 'bigtech', interest: 3, ats: null, careersUrl: 'https://careers.microsoft.com' },
  { name: 'Meta TLV', domain: 'bigtech', interest: 3, ats: null },
  { name: 'Amazon / AWS Israel', domain: 'bigtech', interest: 3, ats: null, careersUrl: 'https://www.amazon.jobs' },
  { name: 'Nvidia Israel', domain: 'bigtech', interest: 3, ats: null, careersUrl: 'https://www.nvidia.com/en-us/about-nvidia/careers/' },
  { name: 'Intel Israel', domain: 'bigtech', interest: 1, ats: null },
  { name: 'Apple Israel', domain: 'bigtech', interest: 2, ats: null },
  { name: 'Salesforce Israel', domain: 'bigtech', interest: 2, ats: null },
  { name: 'Mobileye', domain: 'bigtech', interest: 2, ats: null, careersUrl: 'https://careers.mobileye.com' },
  { name: 'Palo Alto Networks IL', domain: 'cyber', interest: 2, ats: null },

  // ── Finance: Big-4 / investment houses / VC / PE (interest by Roei's B.A.) ──
  { name: 'EY Israel', domain: 'finance', interest: 3, ats: null, careersUrl: 'https://www.ey.com/he_il/careers' },
  { name: 'Deloitte Israel', domain: 'finance', interest: 2, ats: null },
  { name: 'PwC Israel', domain: 'finance', interest: 2, ats: null },
  { name: 'KPMG Israel', domain: 'finance', interest: 2, ats: null },
  { name: 'McKinsey TLV', domain: 'consulting', interest: 3, ats: null },
  { name: 'BCG TLV', domain: 'consulting', interest: 3, ats: null },
  { name: 'Bain TLV', domain: 'consulting', interest: 3, ats: null },
  { name: 'Psagot', domain: 'investments', interest: 2, ats: null },
  { name: 'Meitav', domain: 'investments', interest: 2, ats: null },
  { name: 'Altshuler Shaham', domain: 'investments', interest: 2, ats: null },
  { name: 'More Investment House', domain: 'investments', interest: 2, ats: null },
  { name: 'IBI Investment House', domain: 'investments', interest: 2, ats: null },
  { name: 'Phoenix Group', domain: 'investments', interest: 2, ats: null },
  { name: 'Menora Mivtachim', domain: 'investments', interest: 1, ats: null },
  { name: 'Harel Insurance & Finance', domain: 'investments', interest: 1, ats: null },
  { name: 'Aleph VC', domain: 'vc', interest: 3, ats: null, careersUrl: 'https://aleph.vc' },
  { name: 'TLV Partners', domain: 'vc', interest: 3, ats: null },
  { name: 'Viola Group', domain: 'vc', interest: 3, ats: null, careersUrl: 'https://www.viola-group.com' },
  { name: 'Pitango', domain: 'vc', interest: 3, ats: null },
  { name: 'Vertex Ventures IL', domain: 'vc', interest: 3, ats: null },
  { name: 'Glilot Capital', domain: 'vc', interest: 3, ats: null },
  { name: 'Team8', domain: 'vc', interest: 3, ats: null, careersUrl: 'https://team8.vc/careers' },
  { name: 'Cyberstarts', domain: 'vc', interest: 3, ats: null },
  { name: 'Entrée Capital', domain: 'vc', interest: 3, ats: null },
  { name: 'Insight Partners IL', domain: 'vc', interest: 3, ats: null },
  { name: 'Bessemer IL', domain: 'vc', interest: 3, ats: null },
  { name: 'FIMI', domain: 'pe', interest: 3, ats: null },
  { name: 'Fortissimo Capital', domain: 'pe', interest: 3, ats: null },
  { name: 'Tene Capital', domain: 'pe', interest: 2, ats: null },
  { name: 'LeumiTech', domain: 'finance', interest: 2, ats: null },
  { name: 'Poalim Tech', domain: 'finance', interest: 2, ats: null },
];

// Build one regex that matches any role title from the taxonomy (for ATS filtering)
export function buildTitleRegex() {
  const all = Object.values(ROLE_DOMAINS).flatMap(d => d.titles);
  const escaped = [...new Set(all)].map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(${escaped.join('|')})`, 'i');
}
