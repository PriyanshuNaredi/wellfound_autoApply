/**
 * Wellfound Auto-Apply â€” personal data loaded from .env
 * =====================================
 * HOW TO USE:
 * 1. Log in to wellfound.com, open https://wellfound.com/jobs
 *    and set your search filters (role, location, remote, etc.).
 * 2. Open DevTools console (F12 â†’ Console), paste this whole file, press Enter.
 * 3. It runs in DRY_RUN mode first: it fills everything but does NOT press Send.
 *    Watch one or two applications, then re-run with DRY_RUN = false to actually apply.
 *
 * NOTES:
 * - Wellfound changes its HTML often; button/field lookup is text-based to survive
 *   that, but if it stops finding things, update the SELECTORS section.
 * - Optional: put a Google Gemini API key in CONFIG.geminiKey and any question the
 *   built-in answer bank can't match gets answered by Gemini using your CV.
 * - Auto-applying may violate Wellfound's ToS and can get an account rate-limited
 *   or banned â€” the delays below are deliberately human-ish. Use at your own risk.
 */
(async function wellfoundAutoApply() {
  'use strict';

  // Personal data is injected by the runner from .env (window.__APPLY_CONFIG); nothing PII is hard-coded here.
  const __CFG = (typeof window !== 'undefined' && window.__APPLY_CONFIG) || {};
  // window.__aaSkipJob = false;
  // if (typeof window.__aaSkipJob !== 'boolean') {
  //   window.__aaSkipJob = false;
  // }
  if (typeof window.__aaSkipJob !== 'boolean') {
  window.__aaSkipJob = false;
}

  // ======================= CONFIG =======================
  const CONFIG = {
    DRY_RUN: true,             // true = fill forms but never click Send. Flip to false when ready.
    MAX_APPLICATIONS: 50,      // stop after this many applications this run (runner overrides with 50/day cap minus today's count)
    // 8-20s tripped Wellfound's DataDome bot-check on Jul 31 â€” human pace or bust.
    // 50 apps Ã— ~1.5-3 min â‰ˆ 1.5-2.5h, well inside the runner's 100-min window per batch.
    MIN_DELAY_MS: 60000,       // wait between applications (randomized between min/max)
    MAX_DELAY_MS: 150000,
    geminiKey: __CFG.geminiKey || '',   // optional: Gemini API key for unmatched questions
    HOME_LOCATION: __CFG.homeLocation || '', // profile location is restored to this when the run ends

    // Job titles to apply to (case-insensitive substring match on the job title)
    // Tuned to the resume: full-stack (React/Next.js/TS), Python backends
    // (FastAPI/Django/Node), AI-LLM systems (LangGraph/RAG/MCP), Go/AWS cloud.
    TITLE_KEYWORDS: [
      "software engineer",
      "software developer",
      "software development engineer",
      "sde",
      "backend engineer",
      "backend developer",
      "back-end",
      "back end",
      "full stack engineer",
      "full-stack engineer",
      "fullstack engineer",
      "full stack developer",
      "full-stack developer",
      "fullstack developer",
      "frontend engineer",
      "frontend developer",
      "front-end",
      "python engineer",
      "python developer",
      "django",
      "fastapi",
      "golang",
      "go developer",
      "go engineer",
      "cloud engineer",
      "platform engineer",
      "web engineer",
      "web developer",
      "react developer",
      "react engineer",
      "node developer",
      "nodejs developer",
      "node.js developer",
      "mern",
      "mean stack",
      "typescript developer",
      "typescript engineer",
      "next.js developer",
      "application engineer",
      "application developer",
      "machine learning engineer",
      "ml engineer",
      "ai engineer",
      "ai developer",
      "ai/ml engineer",
      "applied ai",
      "llm engineer",
      "genai",
      "generative ai",
      "agentic",
      "forward deployed",
      "forward-deployed",
      "founding engineer",
    ],
    // Skip jobs whose title contains any of these
    TITLE_BLOCKLIST: [
      "senior",
      "staff",
      "principal",
      "lead",
      "manager",
      "director",
      "architect",
      "intern",
      "internship",
      "ios",
      "android",
      ".net",
      "ruby",
      "php",
      "ruby on rails",
    ],
    // Experience filter: target entry-level / new-grad roles
    MAX_YEARS_EXPERIENCE: 3,

    // Explicitly reject jobs asking for more experience than we want
    EXPERIENCE_BLOCKLIST: [
      /\b4\+?\s*years?\b/i,
      /\b5\+?\s*years?\b/i,
      /\b6\+?\s*years?\b/i,
      /\b7\+?\s*years?\b/i,
      /\b8\+?\s*years?\b/i,
      /\b9\+?\s*years?\b/i,
      /\b10\+?\s*years?\b/i,
      /\b(?:10|11|12|13|14|15|20)\+?\s*(?:-|to\s+)?\s*years?\b/i,
      /\b(?:10|11|12|13|14|15|20)\+?\s*(?:-|to\s+)?\s*years?\s*(?:of|in)?\s*(?:engineering|software|product|backend|frontend|full[- ]stack|ai|ml|platform)\b/i,
      /\b4\s*-\s*5\s*years?\b/i,
      /\b5\s*-\s*7\s*years?\b/i,
      /\b5\s*-\s*8\s*years?\b/i,
      /\b6\s*-\s*8\s*years?\b/i,
      /\b(?:10|11|12|13|14|15|20)\s*-\s*(?:12|13|14|15|20)\s*years?\b/i,
      /\b(?:senior|staff|principal|lead|director|head|vp)\b(?:[- ]level)?\b/i,
      /\b(?:senior|staff|principal|lead|director)\s+(?:engineer|developer|software|full[- ]stack|backend|frontend|platform|ml|ai)\b/i,
      /\b10\+\s*(?:years?|yrs?)\s*(?:of|in)\s*experience\b/i,
      /\bminimum\s+\d+\+?\s*years?\s*(?:of|in)\s*experience\b/i
    ],
  };

  // ======================= CV DATA (from .env via the runner) =======================
  const CV = __CFG.CV || {
    name: '', email: '', phone: '', location: '', currentRole: '', company: '', education: '',
    yearsOfExperience: '', skills: '', highlights: ['', '', '', '', ''], noticePeriod: '',
    currentCTC: '', expectedCTC: '', currentSalary: '', expectedSalary: '', dob: '', gender: '',
    workAuth: '', github: '', linkedin: '', portfolio: '', links: '', remoteOk: '', relocate: '', startDate: '',
  };

  // ============== QUESTION â†’ ANSWER BANK ==============
  // First pattern that matches the question text wins. Answers come from the CV above.
  const QA_BANK = [
    [/company name|current (company|employer)|organi[sz]ation/i, CV.company], // before /name/ so "company name" isn't caught as a person's name
    [/years? of (work |professional )?experience|how (long|many years)/i,
      `I have ${CV.yearsOfExperience}. Hands-on with ${CV.skills.split(',').slice(0, 8).join(',')} and more.`],
    [/notice period|when can you (start|join)|start date|joining/i,
      `${CV.startDate}`],
    [/current .{0,15}(ctc|salary|compensation)/i, CV.currentSalary],
    [/(expected|desired) .{0,15}(ctc|salary|compensation|pay)|salary expectation/i, CV.expectedSalary],
    [/remote|work from home|wfh/i, CV.remoteOk],
    [/reloc|move to|shift to|based out of|work from (our )?office|on-?site/i, CV.relocate],
    [/visa|sponsorship|work authorization|legally authorized|right to work|citizen/i, CV.workAuth],
    [/how did you hear about us/i,
      `I found Bobyard on Wellfound while searching for product-focused engineering roles and was excited by the team's direction.`],
    [/what interests you about bobyard|why bobyard\??/i,
      `I am interested in Bobyard because the Fullstack Engineer in-office role matches my experience building full-stack applications with Python, TypeScript, React, Next.js, and FastAPI. I have worked across both frontend and backend systems and have built AI-driven products where I owned features from development through integration. I would be excited to bring that experience to Bobyard and contribute to building products end to end.`],
    [/what interests you about working for this company/i,
      `I am interested in this role because it matches my experience building production software across frontend, backend, and AI-driven workflows. I like roles where I can own features end to end and contribute directly to product outcomes.`],
    [/use of ai tools/i,
      `I use AI tools such as ChatGPT, Claude, Cursor, and GitHub Copilot to speed up prototyping, debugging, and code review, while still validating outputs carefully before shipping.`],
    [/evidence of exceptional skill/i,
      `I have delivered full-stack products end to end, built AI-powered features, and worked across React, Next.js, TypeScript, Python, FastAPI, and distributed systems with production ownership.`],
    [/years spent coding in react or python/i,
      `Strong frontend experience: React.js, Next.js, Redux, TypeScript and Tailwind CSS, plus React Native for cross-platform mobile apps.`],
    [/this role is in person sf,? is that do-able\??|in person sf|in person san francisco/i, 'Yes'],
    [/are you authorized to work in the united states\s*\??/i, 'Yes'],
    [/do you require sponsorship\??/i, 'Authorized to work in the United States under F-1 OPT.'],
    [/where are you (based|located)|current location|city/i, CV.location],
    [/linkedin|github|portfolio|website|link/i, CV.links],
    [/why (do you want|are you interested|this role|this company|us|join)/i,
      `I ship production features end to end. ${CV.highlights[0] || ''}. This role matches my stack directly, and I want to keep building products with real ownership.`],
    [/tell (us|me) about yourself|introduce yourself|about you/i,
      `I'm ${CV.name}, ${CV.currentRole}. ${CV.highlights[0] || ''}. Previously: ${CV.highlights[2] || ''}. ${CV.highlights[3] || ''}.`],
    [/(biggest|proudest|favorite) (project|achievement|accomplishment)|worked on/i,
      `${CV.highlights[0] || ''}. I owned it end to end, from architecture through deployment and CI/CD.`],
    [/react|frontend|front-end/i,
      `Strong frontend experience: React.js, Next.js, Redux, TypeScript and Tailwind CSS, plus React Native for cross-platform mobile apps.`],
    [/node|backend|back-end|api/i,
      `I build production backends daily: Node.js/Express and Python/FastAPI, REST + GraphQL, WebSockets, MongoDB/PostgreSQL/Redis, on cloud with Docker and CI/CD.`],
    [/\b(ai|llm|ml|machine learning|genai|langchain)\b/i,
      `AI is a core focus: production GenAI agents, RAG pipelines, prompt engineering, tool calling, MCP and multi-agent systems.`],
    [/education|degree|university|college/i, CV.education],
    [/phone|contact number|mobile/i, CV.phone],
    [/e-?mail/i, CV.email],
    [/your name|full name|\bname\b/i, CV.name],
  ];

  const aiPickRadio = async (questionContext, radios) => {
    if (!CONFIG.geminiKey) return null;
    const options = radios.map((r, i) => `${i}. ${labelTextOf(r)}`).join('\n');
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text:
                  `You are answering a job application question on my behalf. Given the question and available options, return ONLY the index number (0-based) of the best answer. Be truthful and pick what makes me the strongest candidate.\n\nMy CV:\n${JSON.stringify(CV)}\n\nQuestion: ${questionContext}\n\nOptions:\n${options}\n\nReturn ONLY the index number, nothing else.`
              }]
            }],
          }),
        }
      );
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) {
        const idx = parseInt(text, 10);
        if (!isNaN(idx) && idx >= 0 && idx < radios.length) {
          log(`  \u{1F916} AI picked radio option ${idx}: “${labelTextOf(radios[idx]).slice(0, 60)}”`);
          return radios[idx];
        }
      }
    } catch (e) {
      log('  \u26A0 AI radio pick failed:', e.message);
    }
    return null;
  };

  const GENERIC_ANSWER =
    `I'm ${CV.name}, ${CV.currentRole}. Happy to elaborate in an interview — key highlights: ` +
    CV.highlights.slice(0, 2).join('; ') + '.';

  // ============== COVER LETTER (per-job: company + title filled in) ==============
  //   function coverLetter(company, title) {
  //     return `${CV.name}
  // ${CV.phone} Â· ${CV.email}
  // ${CV.linkedin} Â· ${CV.github} Â· ${CV.portfolio}

  // Dear ${company ? company + ' team' : 'Hiring Manager'},

  // I'd like to apply for the ${title || 'Full Stack Developer'} position at ${company || 'your company'}.

  // I'm currently ${CV.currentRole || 'a software developer'}, working daily with ${CV.skills.split(',').slice(0, 8).join(',').trim()}. A recent example of my work: ${CV.highlights[0] || 'shipping production features end to end'}.

  // ${CV.highlights[1] || ''}${CV.highlights[2] ? ' ' + CV.highlights[2] + '.' : ''}

  // I'm interested in this role because the ${title || 'Full Stack Developer'} role matches the stack I work in every day, and I'd get to own features end to end${company ? ' at ' + company : ''}. Happy to walk through any of the above if it's useful.

  // Thank you for your time.

  // Sincerely,
  // ${CV.name}`;
  //   }
  function coverLetter(company, title) {
    const companyName = company && company !== '?' ? company : 'your company';
    const role = title || 'Software Engineer';

    const frontendRoles = /frontend|front-end|react|ui|web/i.test(role);
    const backendRoles = /backend|back-end|api|python/i.test(role);
    const aiRoles = /\b(ai|artificial intelligence|machine learning|ml|llm|generative ai)\b/i.test(role);
    const fullStackRoles = /full.?stack/i.test(role);

    let paragraph;

    if (aiRoles) {
      paragraph =
        `I am interested in ${companyName} because the ${role} role combines software engineering with practical AI applications. ` +
        `I have built AI-driven products using Python, Flask, GPT-based models, and Next.js, including a healthcare automation platform that reduced manual triage workload by 30%. ` +
        `I have also built a LangGraph multi-agent code review system using specialist agents, Semgrep, and Bandit. ` +
        `I would be excited to bring this experience to ${companyName} and contribute to building reliable AI-powered products.`;
    } else if (frontendRoles) {
      paragraph =
        `I am interested in ${companyName} because the ${role} role aligns closely with my experience building user-facing applications with React, Next.js, TypeScript, and JavaScript. ` +
        `I have worked on full-stack products where I owned features from implementation through integration, including AI-driven applications built with Next.js and Python backends. ` +
        `I would be excited to bring that experience to ${companyName} and contribute to building simple, reliable experiences for users.`;
    } else if (backendRoles) {
      paragraph =
        `I am interested in ${companyName} because the ${role} role aligns well with my experience building backend systems and APIs with Python, FastAPI, Flask, and SQL-based technologies. ` +
        `I have developed RESTful APIs and backend workflows for production-oriented applications, including an AI-driven healthcare automation platform that reduced manual triage workload by 30%. ` +
        `I would be excited to bring that experience to ${companyName} and contribute to building reliable and scalable systems.`;
    } else if (fullStackRoles) {
      paragraph =
        `I am interested in ${companyName} because the ${role} role matches my experience building full-stack applications with Python, TypeScript, React, Next.js, and FastAPI. ` +
        `I have worked across both frontend and backend systems and have built AI-driven products where I owned features from development through integration. ` +
        `I would be excited to bring that experience to ${companyName} and contribute to building products end to end.`;
    } else {
      paragraph =
        `I am interested in ${companyName} because the ${role} role aligns well with my software engineering experience and interest in building practical products. ` +
        `I have worked with Python, TypeScript, JavaScript, React, Next.js, FastAPI, Flask, and Node.js, and have built both full-stack and AI-driven applications. ` +
        `I would be excited to bring this experience to ${companyName}, take ownership of meaningful engineering work, and continue growing as a software engineer.`;
    }

    return paragraph;
  }

  // ======================= HELPERS =======================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const humanDelay = () => sleep(CONFIG.MIN_DELAY_MS + Math.random() * (CONFIG.MAX_DELAY_MS - CONFIG.MIN_DELAY_MS));
  const log = (...a) => console.log('%c[auto-apply]', 'color:#0a84ff;font-weight:bold', ...a);

  // React-controlled inputs ignore plain .value writes â€” use the native setter + input event.
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function labelTextOf(el) {
    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();

    const direct = normalize(
      el.closest('label')?.textContent ||
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent)
    );

    if (direct) {
      return direct;
    }

    const labelledBy = (el.getAttribute('aria-labelledby') || '').trim();
    if (labelledBy) {
      const labelText = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ');
      const normalized = normalize(labelText);
      if (normalized) {
        return normalized;
      }
    }

    let node = el;
    for (let depth = 0; depth < 6 && node; depth++) {
      let prev = node.previousElementSibling;
      while (prev) {
        const text = normalize(prev.textContent);
        if (
          text &&
          text.length <= 220 &&
          (/\?|\*/.test(text) || /how|why|authorized|sponsorship|years?|experience|relocat|in person|work in the/i.test(text))
        ) {
          return text;
        }
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
    }

    return normalize(
      el.closest('div')?.previousElementSibling?.textContent ||
      el.parentElement?.textContent || ''
    );
  }

  // function visible(el) {
  //   // getClientRects, not offsetParent â€” offsetParent is null for position:fixed
  //   // elements (modal footers), which made real Send buttons look invisible
  //   return el && el.getClientRects().length > 0 && !el.disabled;
  // }
  function visible(el) {
    if (!el || el.disabled) return false;

    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const style = getComputedStyle(el);

    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      return false;
    }

    return true;
  }

  function getApplyModals() {
    return [...document.querySelectorAll(SELECTORS.modal)]
      .filter((d) => {
        if (!visible(d)) return false;

        const text = d.textContent || '';

        return /apply to /i.test(text);
      });
  }

  function getTopApplyModal() {
    const modals = getApplyModals();

    if (!modals.length) return null;

    // Prefer the modal containing the visible application textarea.
    const withTextarea = modals.filter((d) =>
      [...d.querySelectorAll('textarea')].some(visible)
    );

    const candidates = withTextarea.length ? withTextarea : modals;

    // Pick the highest z-index / last rendered modal.
    return candidates
      .map((el) => {
        const style = getComputedStyle(el);
        const z = parseInt(style.zIndex, 10);

        return {
          el,
          z: Number.isNaN(z) ? 0 : z
        };
      })
      .sort((a, b) => a.z - b.z)
      .pop()?.el || null;
  }

  // Job cards concatenate title + location + salary + "Posted 3 weeks ago" etc.
  // into one string â€” keep only the actual title part.
  function cleanTitle(raw) {
    return (raw || '')
      .replace(/\s+/g, ' ')
      .split(/remote only|on-?site|in[- ]?office|hybrid|â‚¹|\$\d|â‚¬|posted \d|recruiter|â€¢|\d+\s?(?:weeks?|days?|months?|hours?)\s?ago/i)[0]
      .replace(/\(?\s*remote\s*\)?$/i, '')
      .replace(/[\s\-â€“â€”|(,/]+$/g, '')
      .trim();
  }

  // Company name from the opened job pane. Falls back to '' (letter then says
  // "Hi there team" / "your team") rather than a wrong heading like "About the job".
  function getCompany() {
    // 2026 UI: the apply panel header reads "Apply to <Company>"
    const panelHeader = [...document.querySelectorAll('h1, h2, h3, div')]
      .map((e) => (e.children.length === 0 ? e.textContent.trim() : ''))
      .find((t) => /^apply to .{2,60}$/i.test(t));
    if (panelHeader) return panelHeader.replace(/^apply to /i, '').trim();
    const el =
      document.querySelector('a[href^="/company/"] h2') ||
      document.querySelector('[data-test="StartupHeader"] h1') ||
      document.querySelector('a[href^="/company/"]');
    let name = (el?.textContent || '').split('\n')[0].replace(/\s+/g, ' ').trim();
    // Reject obvious non-names (section headings, buttons, follower counts)
    if (/about the job|about us|apply|jobs|follow|save|^$/i.test(name) || name.split(' ').length > 6) name = '';
    return name;
  }

  function findButtonByText(root, regex) {
    return [...root.querySelectorAll('button, a[role="button"], [type="submit"]')]
      .find((b) => visible(b) && regex.test(b.textContent.trim()));
  }

  // async function waitFor(fn, timeoutMs = 8000, pollMs = 300) {
  //   const end = Date.now() + timeoutMs;
  //   while (Date.now() < end) {
  //     const res = fn();
  //     if (res) return res;
  //     await sleep(pollMs);
  //   }
  //   return null;
  // }
  async function waitFor(fn, timeoutMs = 8000, pollMs = 300) {
    const end = Date.now() + timeoutMs;

    while (Date.now() < end) {

      if (window.__aaSkipJob) {
        return null;
      }

      const res = fn();

      if (res) {
        return res;
      }

      await sleep(pollMs);
    }

    return null;
  }

  async function answerQuestion(questionText) {
    for (const [pattern, answer] of QA_BANK) {
      if (pattern.test(questionText)) return answer;
    }
    if (CONFIG.geminiKey) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text:
                    `You are answering a job application question on my behalf. Answer in first person, 2-4 sentences, professional, no markdown.\n\nMy CV:\n${JSON.stringify(CV)}\n\nQuestion: ${questionText}`
                }]
              }],
            }),
          }
        );
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      } catch (e) {
        log('Gemini call failed, using generic answer:', e.message);
      }
    }
    return GENERIC_ANSWER;
  }

  // ======================= SELECTORS (edit here if Wellfound changes) =======================
  const SELECTORS = {
    // job cards in the search results list â€” Wellfound uses div[data-test] attrs on job listings
    jobCards: '[data-test="StartupResult"] a[href*="/jobs/"], a[href^="/jobs/"][class]',
    modal: '[role="dialog"], [class*="modal" i]',
    applyButtonText: /^apply$|apply now/i,
    // 2026 UI: the submit button in the "Apply to <Company>" panel is labeled "Apply"
    // sendButtonText: /^send application$|^send$|^submit application$/i,
    sendButtonText: /^send application$|^send$|^submit application$/i,
    alreadyApplied: /applied/i,

    openApplicationButtonText: /^apply$/i,
    sendButtonText: /^send application$|^send$|^submit application$/i,
  };

  // ======================= APPLY TO ONE JOB =======================
  //
  // IMPORTANT:
  //
  // Wellfound uses TWO application stages.
  //
  // Stage 1:
  //
  //   Apply
  //
  // Stage 2:
  //
  //   YOUR APPLICATION
  //   Send application
  //
  // Clicking Stage 1 is NOT an application submission.
  //
  // This function only returns true after the REAL
  // "Send application" submission is confirmed.
  //
  // ===============================================================

  async function fillAndSubmit(company, title, cardText, jobHref) {

    log(
      `  🔎 Wellfound application flow: ${company} / ${title}`
    );

    // ============================================================
    // HELPER: visible element
    // ============================================================

    const isVisible = (el) => {

      if (!el) {
        return false;
      }

      try {

        if (typeof visible === 'function') {
          return visible(el);
        }

      } catch (_) { }

      const style =
        window.getComputedStyle(el);

      const rect =
        el.getBoundingClientRect();

      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const isTopLayerElement = (el) => {
      if (!el || !el.getBoundingClientRect) {
        return false;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }

      const points = [
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.left + Math.min(8, rect.width / 2), rect.top + Math.min(8, rect.height / 2)],
        [rect.right - Math.min(8, rect.width / 2), rect.top + Math.min(8, rect.height / 2)]
      ];

      return points.some(([x, y]) => {
        const top = document.elementFromPoint(x, y);
        return !!top && (top === el || el.contains(top) || top.contains(el));
      });
    };

    // ============================================================
    // HELPER: normalized text
    // ============================================================

    const elementText = (el) => {

      if (!el) {
        return '';
      }

      return (
        el.textContent || ''
      )
        .replace(/\s+/g, ' ')
        .trim();
    };

    // ============================================================
    // HELPER: ALL VISIBLE ELEMENTS
    // ============================================================

    const visibleElements = (selector) => {

      return [
        ...document.querySelectorAll(selector)
      ].filter((el) => isVisible(el) && isTopLayerElement(el));
    };

    // ============================================================
    // REAL SEND BUTTON
    // ============================================================

    const isApplicationContext = (el) => {

      if (!el) {
        return false;
      }

      let node = el;

      for (let i = 0; i < 12 && node; i++) {
        const text = elementText(node);

        if (
          /your application|what interests you about working for this company|tell us about yourself|how did you hear about us|years spent coding|authorized to work|do you require sponsorship|cover letter|work authorization|resume|experience preferred for this role/i.test(text)
        ) {
          return true;
        }

        node = node.parentElement;
      }

      return false;
    };

    const isRealSendButton = (el) => {

      if (!el) {
        return false;
      }

      const text =
        elementText(el);
      const ariaLabel =
        (el.getAttribute('aria-label') || '').trim();
      const combined = `${text} ${ariaLabel}`.trim();

      if (!combined) {
        return false;
      }

      const isSubmitLikeText =
        /(^|\s)(send application|send|submit application|submit|review application|review|continue to submit|apply(?: now)?)(\s|$)/i.test(combined) ||
        /^apply$/i.test(text);

      const inApplicationContext =
        isApplicationContext(el);

      return (
        isSubmitLikeText &&
        inApplicationContext &&
        !/cancel|close|save|back/i.test(combined)
      );
    };

    // ============================================================
    // INITIAL APPLY BUTTON
    // ============================================================

    const isInitialApplyButton = (el) => {

      if (!el) {
        return false;
      }

      const text =
        elementText(el);

      return /^apply(?: now)?$/i.test(text) || /^continue$/i.test(text);
    };

    // ============================================================
    // FIND REAL SEND BUTTON GLOBALLY
    //
    // Do NOT limit this to:
    //
    //   [role="dialog"]
    //
    // because Wellfound can render the second panel
    // outside the first modal.
    // ============================================================

    const findRealSendButton = (scopeRoot = document, requireTopLayer = true) => {

      const buttons =
        [...(scopeRoot.querySelectorAll ? scopeRoot.querySelectorAll('button, [role="button"], input[type="submit"]') : document.querySelectorAll('button, [role="button"], input[type="submit"]'))]
          .filter((el) => isVisible(el) && (!requireTopLayer || isTopLayerElement(el)));

      const exactSend =
        buttons.find((button) => {
          const text = elementText(button);
          const aria = (button.getAttribute('aria-label') || '').trim();
          const combined = `${text} ${aria}`.trim();
          return /(^|\s)send application(\s|$)/i.test(combined) && isApplicationContext(button);
        });

      if (exactSend) {
        return exactSend;
      }

      const matches =
        buttons.filter(
          isRealSendButton
        );

      return (
        matches.find((button) => isApplicationContext(button)) ||
        matches[0] ||
        null
      );
    };

    const findVisibleApplicationModal = () => {
      const modalCandidates = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="sheet" i], [class*="drawer" i], [class*="dialog" i]')]
        .filter((el) => {
          if (!isVisible(el)) return false;
          const text = elementText(el);
          return /your application|what interests you about working for this company|how did you hear about us|are you authorized to work|do you require sponsorship|apply to /i.test(text);
        });

      if (!modalCandidates.length) return null;

      return modalCandidates
        .map((el) => ({
          el,
          z: Number.parseInt(getComputedStyle(el).zIndex || '0', 10),
          area: el.getBoundingClientRect()
        }))
        .sort((a, b) => b.z - a.z || b.area.width * b.area.height - a.area.width * a.area.height)
        .map((x) => x.el)[0];
    };

    const closeVisibleApplicationModal = async () => {
      const root = findVisibleApplicationModal() || panel;

      if (!root) {
        return false;
      }

      const clickEscape = () => {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true
        }));
      };

      const stillVisible = () => {
        const active = findVisibleApplicationModal();
        return !!active;
      };

      for (let attempt = 0; attempt < 3; attempt++) {
        const closeButton =
          root.querySelector('button[aria-label="Close" i], [aria-label*="close" i], button[title*="Close" i], [data-testid*="close" i]') ||
          findButtonByText(root, /^close$|^cancel$|^dismiss$/i) ||
          [...root.querySelectorAll('button, [role="button"]')].find((btn) => {
            const text = `${btn.innerText || ''} ${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('title') || ''}`;
            return /close|cancel|dismiss|×|✕/i.test(text);
          });

        if (closeButton) {
          try {
            closeButton.click();
          } catch (_) {
            // continue to fallback strategies
          }
        }

        if (stillVisible()) {
          try {
            const rect = root.getBoundingClientRect();
            const x = Math.max(1, rect.left - 8);
            const y = Math.max(1, rect.top + 8);
            const backdrop = document.elementFromPoint(x, y);
            if (backdrop && !root.contains(backdrop) && backdrop instanceof HTMLElement) {
              backdrop.click();
            }
          } catch (_) { }
        }

        if (stillVisible()) {
          try {
            clickEscape();
          } catch (_) { }
        }

        await sleep(350);

        if (!stillVisible()) {
          return true;
        }
      }

      return false;
    };

    // ============================================================
    // FIND REAL APPLICATION PANEL
    // ============================================================

    const findRealApplicationPanel = () => {
      // Earlier stable strategy: anchor on the REAL send button first, then walk up.
      const sendButton = findRealSendButton();

      if (sendButton) {
        let node = sendButton;
        for (let i = 0; i < 12 && node; i++) {
          const text = elementText(node);
          const hasFormControl = !!node.querySelector?.('textarea, [role="textbox"], input:not([type="hidden"]), select, [role="radio"], input[type="radio"], input[type="checkbox"]');
          if (
            hasFormControl &&
            /your application|what interests you about working for this company|how did you hear about us|tell us about yourself|apply to /i.test(text)
          ) {
            return node;
          }

          node = node.parentElement;
        }
      }

      const modalRoot = findVisibleApplicationModal();
      if (modalRoot) {
        const formControl = [...modalRoot.querySelectorAll('textarea, [role="textbox"], input:not([type="hidden"]), select, [role="radio"], input[type="radio"], input[type="checkbox"]')].find(isVisible);
        const hasAForm = /your application|what interests you about working for this company|how did you hear about us|authorized to work|require sponsorship|apply/i.test(elementText(modalRoot));
        if (formControl && hasAForm) return modalRoot;
      }

      const applicationCandidates = [
        ...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="sheet" i], [class*="drawer" i], [class*="dialog" i], section, form, div')
      ].filter((el) => {
        if (!isVisible(el)) {
          return false;
        }

        const text = elementText(el);
        const hasFormControl = !!el.querySelector?.('textarea, [role="textbox"], input:not([type="hidden"]), select, [role="radio"], input[type="radio"], input[type="checkbox"]');
        const hasApplicationHeader = /your application|what interests you about working for this company|how did you hear about us|tell us about yourself|apply to /i.test(text);
        const hasSendAction = !!el.querySelector?.('button, [role="button"], input[type="submit"]') && /send application|submit|apply/i.test(text);

        return hasFormControl && (hasApplicationHeader || hasSendAction);
      });

      const panelFromPrompt = applicationCandidates
        .map((el) => ({
          el,
          z: Number.parseInt(getComputedStyle(el).zIndex || '0', 10),
          area: el.getBoundingClientRect()
        }))
        .sort((a, b) => b.z - a.z || b.area.width * b.area.height - a.area.width * a.area.height)
        .map((x) => x.el)[0] || null;

      if (panelFromPrompt) {
        return panelFromPrompt;
      }

      const fallbackSendButton = findRealSendButton();
      if (!fallbackSendButton) return null;

      let node = fallbackSendButton;
      for (let i = 0; i < 12 && node; i++) {
        const text = elementText(node);

        if (/YOUR APPLICATION|your application|what interests you about working for this company|how did you hear about us|tell us about yourself|apply to /i.test(text)) {
          return node;
        }

        if (node.querySelector && node.querySelector('textarea, [role="textbox"]')) {
          const rect = node.getBoundingClientRect();
          if (rect.width > 250 && rect.height > 150) {
            return node;
          }
        }

        node = node.parentElement;
      }

      return null;
    };

    // ============================================================
    // FIND INITIAL APPLY BUTTON
    // ============================================================

    const findInitialApplyButton = () => {

      const buttons =
        visibleElements(
          'button, [role="button"], input[type="submit"]'
        );

      const applyButtons =
        buttons.filter(
          isInitialApplyButton
        );

      if (!applyButtons.length) {
        return null;
      }

      // Prefer the button inside the small:
      //
      // Apply to Company
      //
      // popup.

      const preferred =
        applyButtons.find((button) => {

          let node =
            button;

          for (
            let i = 0;
            i < 10 && node;
            i++
          ) {

            const text =
              elementText(node);

            if (
              /apply to /i.test(text) &&
              /what interests you about working for this company/i.test(text)
            ) {
              return true;
            }

            node =
              node.parentElement;
          }

          return false;
        });

      return (
        preferred ||
        applyButtons[0]
      );
    };

    // ============================================================
    // STEP 1
    // CHECK WHETHER REAL APPLICATION PANEL ALREADY EXISTS
    // ============================================================

    let panel =
      findRealApplicationPanel();

    if (panel) {

      log(
        '  ✅ real YOUR APPLICATION panel already open'
      );

    } else {

      // ==========================================================
      // STEP 2
      // FIND INITIAL APPLY
      // ==========================================================

      const applyButton =
        await waitFor(
          () =>
            findInitialApplyButton(),
          10000
        );

      if (!applyButton) {

        log(
          '  ❌ initial Apply button not found'
        );

        return false;
      }

      log(
        '  ▶ clicking INITIAL Apply button'
      );

      // IMPORTANT:
      //
      // This click ONLY opens the application form.
      //
      // We do NOT count it as an application.

      // applyButton.click();
      applyButton.click();

      await sleep(300);

      if (window.__aaSkipJob) {
        window.__aaSkipJob = false;

        log('⏭ manually skipped current job');

        findButtonByText(panel || document, /^cancel$/i)?.click();

        return false;
      }

      // ==========================================================
      // STEP 3
      // WAIT FOR SECOND PANEL
      // ==========================================================

      panel =
        await waitFor(
          () =>
            findRealApplicationPanel(),
          15000
        );

      if (!panel) {

        log(
          '  ❌ REAL application panel did not appear'
        );

        return false;
      }

      log(
        '  ✓ REAL YOUR APPLICATION panel detected'
      );
    }

    // ============================================================
    // LOCATION BLOCK
    // ============================================================

    const panelText =
      elementText(panel);

    const panelVisibleText =
      [...panel.querySelectorAll('*')]
        .filter((el) => isVisible(el) && isTopLayerElement(el))
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ');

    // IMPORTANT: do not skip based on questionnaire text inside the popup.
    // Wellfound often renders prompts like "experience preferred for this role
    // (10+ years)" in the application form even for roles we want to apply to.
    // We already filter roles up-front with experienceOk(job card text).

    // if (
    //   /not accepting applications from your (current )?location/i.test(
    //     panelText
    //   )
    // ) {
    //   log(
    //     '🚫 application blocked by location/timezone — skipping'
    //   );

    //   return false;
    // }
    if (
      /not accepting applications from your (current )?location/i.test(
        panelText
      )
    ) {
      log(
        '🚫 application blocked by location/timezone — attempting location fix'
      );

      await closeVisibleApplicationModal();

      // Fix by matching the profile location to the job. The location combobox only
      // exists on /profile/edit, so store a flag and navigate there; the resume point
      // near the top of this script performs the edit on re-injection, then returns
      // to /jobs where the loop retries this job under the new profile location.
      let jobLoc = extractJobLocation((document.body.innerText || '').replace(/\s+/g, ' '))
        // the SPA overlay behind the apply panel carries the structured job details
        // ("Job Location Seattle Visa Sponsorship …") — richest source, no network
        || extractJobLocation(cardText || '')
        || extractJobLocation(panelText);
      if (!jobLoc && jobHref) {
        log('📍 no location in DOM — fetching the job page');
        jobLoc = await fetchJobLocation(jobHref);
      }
      if (jobLoc) {
        const locFixCount = parseInt(localStorage.getItem('__aaLocFixCount') || '0', 10);
        if (locFixCount < 3) { // max 3 location fixes per day — prevents loops
          try { localStorage.setItem('__aaLocFixCount', String(locFixCount + 1)); } catch (_) { }
          console.log('AA_LOC_FIX ' + JSON.stringify({ loc: jobLoc, jobHref: jobHref || location.href }));
          locationFixUsedThisRun = true;
          log(`📍 navigating to /profile/edit to set location "${jobLoc}"`);
          applied = CONFIG.MAX_APPLICATIONS; // end this instance cleanly
          location.href = 'https://wellfound.com/profile/edit';
          return false;
        } else {
          log('📍 Location fix limit reached (3/day) — skipping this job');
        }
      } else {
        log('📍 Could not extract job location — skipping');
      }

      return false;
    }

    // ============================================================
    // FIND TEXTAREA
    // ============================================================

    let textareas = [
      ...panel.querySelectorAll(
        'textarea'
      )
    ].filter(isVisible);

    // Fallback: search globally.
    if (!textareas.length) {

      textareas =
        visibleElements(
          'textarea'
        ).filter((textarea) => {

          let node =
            textarea;

          for (
            let i = 0;
            i < 10 && node;
            i++
          ) {

            if (
              /YOUR APPLICATION/i.test(
                elementText(node)
              )
            ) {
              return true;
            }

            node =
              node.parentElement;
          }

          return false;
        });
    }

    // ============================================================
    // FILL REAL COVER LETTER
    // ============================================================

    if (textareas.length) {

      const coverField =
        textareas[0];

      const letter =
        coverLetter(
          company,
          title
        );

      setValue(
        coverField,
        letter
      );

      log(
        '  ✅ REAL application textarea filled'
      );

    } else {

      log(
        '  ⚠  REAL application textarea not found'
      );
    }

    // ============================================================
    // EXTRA TEXT INPUTS
    // ============================================================

    const extraInputs =
      visibleElements(
        'input[type="text"], input[type="email"], input[type="url"], input:not([type]):not([type="hidden"]), textarea'
      ).filter((field) => {

        if (
          panel.contains(field)
        ) {
          return true;
        }

        return false;
      });

    for (
      const field of extraInputs
    ) {

      const label =
        labelTextOf(field);

      if (!label || field.value?.trim()) {
        continue;
      }

      if (
        /search/i.test(label)
      ) {
        continue;
      }

      const answer =
        await answerQuestion(
          label
        );

      const required =
        field.required ||
        field.getAttribute(
          'aria-required'
        ) === 'true' ||
        /\*/.test(label);

      if (
        answer === GENERIC_ANSWER &&
        !required
      ) {

        log(
          `  ⏭ optional question skipped: "${label.slice(0, 60)}"`
        );

        continue;
      }

      setValue(
        field,
        answer
      );

      log(
        `  ✅ answered: "${label.slice(0, 60)}..."`
      );
    }

    // ============================================================
    // SELECT DROPDOWNS
    // ============================================================

    const YES =
      /yes|willing|open to|agree|relocat|remote|immediat|i am able|i can/i;

    const PLACEHOLDER =
      /^select|^choose|^--|^pick/i;

    const selects =
      visibleElements(
        'select'
      ).filter((select) =>
        panel.contains(select)
      );

    for (
      const select of selects
    ) {

      const options =
        [
          ...select.options
        ].filter(
          (option) =>
            option.value &&
            !PLACEHOLDER.test(
              option.text.trim()
            )
        );

      if (!options.length) {
        continue;
      }

      const pick =
        options.find(
          (option) =>
            YES.test(
              option.text
            )
        ) ||
        options.find(
          (option) =>
            CV.location &&
            option.text
              .toLowerCase()
              .includes(
                CV.location
                  .split(',')[0]
                  .trim()
                  .toLowerCase()
              )
        ) ||
        options[0];

      setValue(
        select,
        pick.value
      );

      log(
        `  ✓ selected "${pick.text.trim()}"`
      );
    }

    // ============================================================
    // RADIO BUTTONS
    // ============================================================

    const radioGroups = {};

    const radios =
      [...panel.querySelectorAll('input[type="radio"], [role="radio"]')]
        .filter(isVisible);

    const radioIsChecked = (radio) => {
      if (!radio) return false;
      if (radio.matches?.('[role="radio"]')) {
        return radio.getAttribute('aria-checked') === 'true';
      }
      return !!radio.checked;
    };

    const clickRadioIfNeeded = (radio) => {
      if (!radio) return;
      if (!radioIsChecked(radio)) {
        radio.click();
      }
    };

    for (
      const radio of radios
    ) {

      const key =
        radio.name ||
        labelTextOf(radio);

      (
        radioGroups[key] ||=
        []
      ).push(radio);
    }

    for (
      const group of Object.values(
        radioGroups
      )
    ) {

      const context = (
        group[0]
          .closest('fieldset')
          ?.textContent ||
        group
          .map(
            labelTextOf
          )
          .join(' ')
      )
        .replace(/\s+/g, ' ')
        .trim();

      let pick =
        null;
      if (/in[- ]person|on[- ]site|san francisco|presidio|i confirm/i.test(context)) {
        pick =
          group.find((radio) => /i confirm|yes|able to come|can come|i can/i.test(labelTextOf(radio))) ||
          group[0];

        if (pick && !radioIsChecked(pick)) {
          clickRadioIfNeeded(pick);
          log('  ☑ in-person confirmation selected');
        }

        continue;
      }
      if (/legally authorized to work|authorized to work in the united states|work in the united states/i.test(context)) {
        pick = group.find((radio) => /^(yes)\b/i.test(labelTextOf(radio).trim())) || group[0];

        if (pick && !radioIsChecked(pick)) {
          clickRadioIfNeeded(pick);
          log('  ☑ work authorization selected: Yes');
        }

        continue;
      }
      if (/require visa sponsorship|visa sponsorship|require sponsorship/i.test(context)) {
        pick = group.find((radio) => /^(no)\b/i.test(labelTextOf(radio).trim())) || group[0];

        if (pick && !radioIsChecked(pick)) {
          clickRadioIfNeeded(pick);
          log('  ☑ visa sponsorship selected: No');
        }

        continue;
      }
      if (/security clearance|u\.s\.?\s*citizenship|us citizen|u\.s\.?\s*citizen/i.test(context)) {
        pick = group.find((radio) =>
          /^(no)\b/i.test(labelTextOf(radio).trim())
        );

        if (pick) {
          clickRadioIfNeeded(pick);
          log('  ☑ security clearance/citizenship: No');
        }

        continue;
      }
      if (
        /gender|^sex\b/i.test(
          context
        )
      ) {

        pick =
          group.find(
            (radio) => {

              const label =
                labelTextOf(
                  radio
                );

              return (
                /male/i.test(label) &&
                !/female/i.test(label)
              );
            }
          );
      }

      if (
        /disability|disabled/i.test(
          context
        )
      ) {

        pick =
          group.find(
            (radio) =>
              /no disability|not disabled|^no\b|none/i.test(
                labelTextOf(
                  radio
                )
              )
          );
      }

      pick =
        pick ||
        group.find(
          (radio) =>
            YES.test(
              labelTextOf(
                radio
              )
            )
        ) ||
        await aiPickRadio(context, group) ||
        group[0];

      if (
        pick &&
        !radioIsChecked(pick)
      ) {
        clickRadioIfNeeded(pick);
      }

      if (pick) {

        log(
          `  ✓ radio "${labelTextOf(pick).slice(0, 60)}"`
        );
      }
    }

    // Force required compliance questions that are frequently missed by DOM heuristics.
    const forceComplianceAnswers = async () => {
      const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();

      const clickNativeRadio = (input) => {
        if (!input) return false;
        const label = input.id ? panel.querySelector(`label[for="${input.id}"]`) : null;

        if (label) {
          label.click();
        } else {
          input.click();
        }

        input.checked = true;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };

      // First: explicit Wellfound custom-question radio groups.
      const customGroups = [...panel.querySelectorAll('[data-test^="RadioGroup-customQuestionAnswers"]')];
      for (const group of customGroups) {
        const wrapper = group.closest('.mb-2') || group.closest('label') || group.parentElement;
        const questionText = normalize(wrapper?.querySelector('.text-dark-aaaa')?.textContent || wrapper?.textContent || group.textContent);
        const radios = [...group.querySelectorAll('input[type="radio"]')];

        if (!radios.length) continue;
        if (radios.some((r) => r.checked)) continue;

        let pick = null;
        if (/in[- ]person|presidio|san francisco|able to work in person/i.test(questionText)) {
          pick = radios[0]; // single "I confirm" option
          if (clickNativeRadio(pick)) log('  ☑ forced in-person confirmation: Yes');
          continue;
        }

        if (/legally authorized to work|authorized to work in the united states|work in the united states/i.test(questionText)) {
          pick = radios.find((r) => /^\s*yes\s*$/i.test(normalize(panel.querySelector(`label[for="${r.id}"]`)?.textContent))) || radios[0];
          if (clickNativeRadio(pick)) log('  ☑ forced work authorization: Yes');
          continue;
        }

        if (/require visa sponsorship|visa sponsorship/i.test(questionText)) {
          pick = radios.find((r) => /^\s*no\s*$/i.test(normalize(panel.querySelector(`label[for="${r.id}"]`)?.textContent))) || radios[radios.length - 1];
          if (clickNativeRadio(pick)) log('  ☑ forced sponsorship: No');
          continue;
        }

        // Any still-required generic custom question: use AI to pick, fall back to first option.
        const required = /\*/.test(questionText) || /this question is required/i.test(normalize(group.textContent));
        if (required && radios[0]) {
          const aiPick = await aiPickRadio(questionText, radios);
          const chosen = aiPick || radios[0];
          if (clickNativeRadio(chosen)) {
            log(`  ☉ forced required custom radio: ${labelTextOf(chosen).slice(0, 60)}`);
          }
        }
      }
    };

    await forceComplianceAnswers();

    // ============================================================
    // CHECKBOXES
    // ============================================================

    const checkboxes =
      visibleElements(
        'input[type="checkbox"]'
      ).filter((checkbox) =>
        panel.contains(checkbox)
      );

    for (
      const checkbox of checkboxes
    ) {

      const own =
        labelTextOf(
          checkbox
        );

      const fieldset =
        checkbox.closest(
          'fieldset, [role="group"]'
        );

      const groupText = (
        fieldset?.textContent ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();

      // ==========================================================
      // WELLFOUND RELOCATION QUESTION
      //
      // Example:
      //
      // Based out of NYC or willing to relocate?
      //
      // Currently in NYC
      //
      // Willing to Relocate
      //
      // Select ONLY relocation.
      // ==========================================================

      if (
        /based out of .* or willing to relocate/i.test(
          groupText
        ) ||
        /willing to relocate/i.test(
          groupText
        )
      ) {

        const boxes =
          fieldset
            ? [
              ...fieldset.querySelectorAll(
                'input[type="checkbox"]'
              )
            ]
            : [checkbox];

        const relocate =
          boxes.find(
            (box) =>
              /willing to relocate|relocate/i.test(
                labelTextOf(
                  box
                )
              )
          );

        if (
          relocate &&
          !relocate.checked
        ) {

          relocate.click();

          log(
            '  â˜‘ selected "Willing to Relocate"'
          );
        }

        continue;
      }

      // ==========================================================
      // AGREEMENT CHECKBOXES
      // ==========================================================

      if (
        !checkbox.checked &&
        /agree|confirm|authorize|acknowledge|terms/i.test(
          own
        )
      ) {

        checkbox.click();

        log(
          `  â˜‘ checked "${own.slice(0, 80)}"`
        );
      }
    }

    // ============================================================
    // REQUIRED FINAL PASS (fill any remaining required text/select fields)
    // ============================================================

    const requiredCandidates = [
      ...panel.querySelectorAll('input, textarea, select')
    ].filter((field) => isVisible(field) && isTopLayerElement(field));

    for (const field of requiredCandidates) {
      if (field.matches('input[type="hidden"], input[type="checkbox"], input[type="radio"], [role="radio"]')) {
        continue;
      }

      const label = labelTextOf(field);
      const groupText = (field.closest('fieldset, [role="group"]')?.textContent || '').replace(/\s+/g, ' ').trim();
      const required =
        field.required ||
        field.getAttribute('aria-required') === 'true' ||
        /\*/.test(label) ||
        /\*/.test(groupText);

      const value = String(field.value || '').trim();
      if (!required || value) {
        continue;
      }

      const answer = await answerQuestion(label || groupText || 'required field');
      setValue(field, answer);

      log(
        `  ✅ required filled: "${(label || groupText || 'required field').slice(0, 70)}"`
      );
    }

    // Ensure required radio groups have one selected choice.
    const requiredRadioGroups = new Map();
    for (const radio of radios) {
      const key = radio.name || radio.closest('fieldset, [role="group"]') || labelTextOf(radio);
      if (!key) continue;
      if (!requiredRadioGroups.has(key)) requiredRadioGroups.set(key, []);
      requiredRadioGroups.get(key).push(radio);
    }

    for (const group of requiredRadioGroups.values()) {
      if (group.some((radio) => radioIsChecked(radio))) {
        continue;
      }

      const context = (
        group[0]?.closest('fieldset, [role="group"]')?.textContent ||
        group.map((radio) => labelTextOf(radio)).join(' ')
      ).replace(/\s+/g, ' ').trim();

      const required =
        group.some((radio) => radio.required || radio.getAttribute('aria-required') === 'true') ||
        /\*/.test(context);

      if (!required) {
        continue;
      }

      let pick =
        group.find((radio) => /^(yes)\b/i.test(labelTextOf(radio).trim())) ||
        group.find((radio) => /^(no)\b/i.test(labelTextOf(radio).trim())) ||
        await aiPickRadio(context, group) ||
        group[0];

      if (pick && !radioIsChecked(pick)) {
        clickRadioIfNeeded(pick);
        log(`  ✅ required radio selected: "${labelTextOf(pick).slice(0, 60)}"`);
      }
    }

    const listMissingRequired = () => {
      const missing = [];

      const requiredFields = [...panel.querySelectorAll('input, textarea, select')]
        .filter((field) => isVisible(field) && isTopLayerElement(field));

      for (const field of requiredFields) {
        if (field.matches('input[type="hidden"], input[type="checkbox"], input[type="radio"], [role="radio"]')) {
          continue;
        }

        const label = labelTextOf(field);
        const groupText = (field.closest('fieldset, [role="group"]')?.textContent || '').replace(/\s+/g, ' ').trim();
        const required =
          field.required ||
          field.getAttribute('aria-required') === 'true' ||
          /\*/.test(label) ||
          /\*/.test(groupText);

        if (!required) {
          continue;
        }

        if (!String(field.value || '').trim()) {
          missing.push((label || groupText || field.tagName).slice(0, 120));
        }
      }

      for (const group of requiredRadioGroups.values()) {
        const context = (
          group[0]?.closest('fieldset, [role="group"]')?.textContent ||
          group.map((radio) => labelTextOf(radio)).join(' ')
        ).replace(/\s+/g, ' ').trim();

        const required =
          group.some((radio) => radio.required || radio.getAttribute('aria-required') === 'true') ||
          /\*/.test(context);

        if (required && !group.some((radio) => radioIsChecked(radio))) {
          missing.push((context || 'required yes/no question').slice(0, 120));
        }
      }

      return [...new Set(missing.filter(Boolean))];
    };

    const missingRequired = listMissingRequired();
    if (missingRequired.length) {
      log(`  ❌ cannot submit; required fields still empty (${missingRequired.length})`);
      for (const m of missingRequired.slice(0, 5)) {
        log(`    • ${m}`);
      }
      await closeVisibleApplicationModal();
      return false;
    }

    // ============================================================
    // SECOND REQUIRED SWEEP
    // Use the panel itself, not the top-layer heuristic, so visible required
    // questions are still filled even if their center point is inside a scrollable
    // region or otherwise not treated as top-most.
    // ============================================================

    const panelFields = [...panel.querySelectorAll('input, textarea, select')].filter(isVisible);

    for (const field of panelFields) {
      if (field.matches('input[type="hidden"]')) {
        continue;
      }

      const label = labelTextOf(field);
      const groupText = (field.closest('fieldset, [role="group"]')?.textContent || '').replace(/\s+/g, ' ').trim();

      if (field.matches('input[type="radio"], [role="radio"], input[type="checkbox"]')) {
        continue;
      }

      const required =
        field.required ||
        field.getAttribute('aria-required') === 'true' ||
        /\*/.test(label) ||
        /\*/.test(groupText);

      if (!required || String(field.value || '').trim()) {
        continue;
      }

      const answer = await answerQuestion(label || groupText || 'required field');
      setValue(field, answer);
      log(`  ✅ required sweep filled: "${(label || groupText || 'required field').slice(0, 70)}"`);
    }

    const panelRadioGroups = new Map();
    for (const radio of panelFields.filter((field) => field.matches('input[type="radio"], [role="radio"]'))) {
      const key = radio.name || radio.closest('fieldset, [role="group"]') || labelTextOf(radio);
      if (!key) continue;
      if (!panelRadioGroups.has(key)) panelRadioGroups.set(key, []);
      panelRadioGroups.get(key).push(radio);
    }

    for (const group of panelRadioGroups.values()) {
      if (group.some((radio) => radioIsChecked(radio))) {
        continue;
      }

      const context = (
        group[0]?.closest('fieldset, [role="group"]')?.textContent ||
        group.map((radio) => labelTextOf(radio)).join(' ')
      ).replace(/\s+/g, ' ').trim();

      const required =
        group.some((radio) => radio.required || radio.getAttribute('aria-required') === 'true') ||
        /\*/.test(context);

      if (!required) {
        continue;
      }

      let pick = null;
      if (/in[- ]person|on[- ]site|san francisco|presidio|i confirm/i.test(context)) {
        pick = group.find((radio) => /i confirm|yes|able to come|can come|i can/i.test(labelTextOf(radio))) || group[0];
      } else if (/legally authorized to work|authorized to work in the united states|work in the united states/i.test(context)) {
        pick = group.find((radio) => /^(yes)\b/i.test(labelTextOf(radio).trim())) || group[0];
      } else if (/require visa sponsorship|visa sponsorship|require sponsorship/i.test(context)) {
        pick = group.find((radio) => /^(no)\b/i.test(labelTextOf(radio).trim())) || group[0];
      } else {
        pick = group.find((radio) => /^(yes)\b/i.test(labelTextOf(radio).trim())) ||
          await aiPickRadio(context, group) ||
          group[0];
      }

      if (pick && !radioIsChecked(pick)) {
        clickRadioIfNeeded(pick);
        log(`  ✅ required radio selected: "${labelTextOf(pick).slice(0, 60)}"`);
      }
    }

    const hasSubmissionConfirmation = () => {
      const body = document.body?.innerText || '';

      if (
        /application has been sent/i.test(body) ||
        /application sent/i.test(body) ||
        /application submitted/i.test(body) ||
        /has been submitted/i.test(body) ||
        /congrats!?\s*your application has been submitted/i.test(body) ||
        /you('ve| have) applied/i.test(body) ||
        /thanks for applying/i.test(body)
      ) {
        return true;
      }

      const overlayText = [
        ...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="sheet" i], [class*="drawer" i], [class*="dialog" i]')
      ]
        .filter((el) => isVisible(el) && isTopLayerElement(el))
        .map((el) => elementText(el))
        .join(' ');

      return (
        /application has been sent/i.test(overlayText) ||
        /application sent/i.test(overlayText) ||
        /application submitted/i.test(overlayText) ||
        /has been submitted/i.test(overlayText) ||
        /congrats!?\s*your application has been submitted/i.test(overlayText)
      );
    };

    // ============================================================
    // WAIT FOR REAL SEND APPLICATION BUTTON
    // ============================================================
    // ============================================================
    // CLOSE WELLFOUND SUCCESS OVERLAY
    // ============================================================

    async function closeWellfoundSuccessOverlay() {

      log('  ✕ closing Wellfound success overlay...');

      // Look specifically for the application-success panel.
      const successPanel = await waitFor(() => {

        const candidates = [
          ...document.querySelectorAll(
            '[role="dialog"], [class*="modal" i], [class*="Modal" i]'
          )
        ];

        return candidates
          .filter(visible)
          .find(el => {
            const text = el.innerText || el.textContent || '';

            return (
              /success.*application has been sent/i.test(text) ||
              /application has been sent/i.test(text) ||
              /application sent/i.test(text) ||
              /application submitted/i.test(text) ||
              /has been submitted/i.test(text) ||
              /congrats!?\s*your application has been submitted/i.test(text)
            );
          });

      }, 5000);

      if (!successPanel) {
        log('  ⚠ success panel not found for closing');
        return;
      }

      // ------------------------------------------------------------
      // Find close button inside the success panel
      // ------------------------------------------------------------

      const closeButtons = [
        ...successPanel.querySelectorAll(
          'button, [role="button"]'
        )
      ].filter(visible);

      let closeButton =
        closeButtons.find(btn => {

          const text =
            `${btn.innerText || ''} ${btn.getAttribute('aria-label') || ''
            } ${btn.getAttribute('title') || ''
            }`;

          return /close|cancel|×|✕/i.test(text);

        });

      // ------------------------------------------------------------
      // Sometimes Wellfound's close button has no text/aria-label.
      // Try the common close selectors.
      // ------------------------------------------------------------

      if (!closeButton) {

        const selectorCandidates = [
          'button[aria-label="Close"]',
          'button[aria-label*="close" i]',
          '[data-testid*="close" i]',
          '[class*="close" i]',
          'button'
        ];

        for (const selector of selectorCandidates) {

          const candidates = [
            ...successPanel.querySelectorAll(selector)
          ].filter(visible);

          if (candidates.length) {

            // For generic button fallback, only use the first/last
            // button if it looks like a close control.
            if (selector === 'button') {

              const candidate =
                candidates.find(btn => {

                  const rect =
                    btn.getBoundingClientRect();

                  // Close buttons are generally near the upper-right
                  // of the dialog.
                  return (
                    rect.top <
                    successPanel.getBoundingClientRect().top + 100 &&
                    rect.left >
                    successPanel.getBoundingClientRect().left +
                    successPanel.getBoundingClientRect().width * 0.70
                  );

                });

              if (candidate) {
                closeButton = candidate;
                break;
              }

            } else {

              closeButton = candidates[candidates.length - 1];
              break;

            }
          }
        }
      }

      // ------------------------------------------------------------
      // Click close button
      // ------------------------------------------------------------

      if (closeButton) {

        try {

          closeButton.click();

          log('  ✓ success overlay close button clicked');

          await sleep(800);

        } catch (err) {

          log(
            `  ⚠ could not click success close button: ${err?.message || err
            }`
          );

        }

      } else {

        log(
          '  ⚠ no close button found, trying Escape'
        );

        // ----------------------------------------------------------
        // Escape fallback
        // ----------------------------------------------------------

        try {

          document.dispatchEvent(
            new KeyboardEvent(
              'keydown',
              {
                key: 'Escape',
                code: 'Escape',
                keyCode: 27,
                which: 27,
                bubbles: true,
                cancelable: true
              }
            )
          );

          await sleep(800);

        } catch (_) { }

      }

      // ------------------------------------------------------------
      // Wait until success overlay is actually gone
      // ------------------------------------------------------------

      const closed = await waitFor(() => {

        const stillOpen = [
          ...document.querySelectorAll(
            '[role="dialog"], [class*="modal" i], [class*="Modal" i]'
          )
        ]
          .filter(visible)
          .some(el => {

            const text =
              el.innerText ||
              el.textContent ||
              '';

            return (
              /application has been sent/i.test(text) ||
              /application sent/i.test(text) ||
              /application submitted/i.test(text) ||
              /has been submitted/i.test(text) ||
              /congrats!?\s*your application has been submitted/i.test(text) ||
              /success.*application/i.test(text)
            );

          });

        return !stillOpen;

      }, 5000);

      if (closed) {

        log(
          '  ✓ Wellfound success overlay closed'
        );

      } else {

        log(
          '  ⚠ success overlay is still visible'
        );

      }

      // Give Wellfound's SPA time to restore the underlying job page.
      await sleep(1000);
    }

    // If a popup is still hanging around with blank fields, close it instead of
    // waiting forever on the stale modal. This is the failure mode where the
    // form body behind the dialog gets filled but the visible popup remains empty.
    const staleModal = findVisibleApplicationModal();
    if (staleModal) {
      const staleInputs = [...staleModal.querySelectorAll('input, textarea, select')].filter(isVisible);
      const staleSend = findRealSendButton(staleModal, false);
      const hasBlankRequiredField = staleInputs.some((field) => {
        if (field.matches('input[type="hidden"]')) return false;
        if (field.matches('input[type="checkbox"], input[type="radio"]')) return false;
        const label = labelTextOf(field);
        const required = field.required || field.getAttribute('aria-required') === 'true' || /\*/.test(label);
        return required && !String(field.value || '').trim();
      });

      if (hasBlankRequiredField && !staleSend) {
        log('  ⚠ stale application popup has empty required fields and no real Send button — closing it and continuing');
        await closeVisibleApplicationModal();
        await sleep(500);
      }
    }

    const revealSubmitControls = async () => {
      const roots = [panel, findVisibleApplicationModal()].filter(Boolean);

      for (const root of roots) {
        const scrollers = [
          root,
          ...root.querySelectorAll('[style*="overflow"], [class*="scroll" i], [class*="content" i], [class*="body" i]')
        ];

        for (const scroller of scrollers) {
          try {
            if (typeof scroller.scrollTo === 'function') {
              scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });
            } else {
              scroller.scrollTop = scroller.scrollHeight;
            }
          } catch (_) { }
        }
      }

      await sleep(250);
    };

    let sendButton =
      await waitFor(
        () =>
          findRealSendButton(panel, false) ||
          findRealSendButton(),
        4000
      );

    if (!sendButton) {
      // Some Wellfound dialogs keep the submit CTA in a scrollable footer region.
      for (let attempt = 0; attempt < 6 && !sendButton; attempt++) {
        await revealSubmitControls();
        sendButton = findRealSendButton(panel, false) || findRealSendButton();
      }
    }

    if (!sendButton) {
      sendButton = await waitFor(
        () => findRealSendButton(panel, false) || findRealSendButton(),
        8000
      );
    }

    if (!sendButton) {

      log(
        '  ❌ REAL "Send application" button not found'
      );

      return false;
    }

    log(
      `  âœ“ REAL button found: "${elementText(sendButton)}"`
    );

    // Run one last compliance click pass right before submit in case
    // Wellfound re-rendered radio options while typing long answers.
    await forceComplianceAnswers();

    // ============================================================
    // DRY RUN
    // ============================================================

    if (
      CONFIG.DRY_RUN
    ) {

      log(
        '  ðŸ” DRY_RUN â€” would click REAL Send application'
      );

      // IMPORTANT:
      //
      // Return true here only means:
      //
      // "application was prepared correctly"
      //
      // The runner's dry-run mode handles the fact that
      // nothing was actually submitted.

      return true;
    }

    // ============================================================
    // CHECK DISABLED
    // ============================================================

    if (
      sendButton.disabled ||
      sendButton.getAttribute(
        'aria-disabled'
      ) === 'true'
    ) {

      log(
        '  🚫 REAL Send application button is disabled'
      );

      return false;
    }

    // ============================================================
    // REAL SUBMISSION
    // ============================================================

    log(
      '  â–¶ clicking REAL Send application'
    );

    sendButton.click();

    log(
      '  ⏳ waiting for Wellfound confirmation...'
    );

    // ============================================================
    // WAIT FOR CONFIRMATION
    // ============================================================

    const confirmed =
      await waitFor(
        () => hasSubmissionConfirmation(),
        15000
      );

    if (confirmed) {

      log(
        '  ✅ APPLICATION CONFIRMED BY WELLFOUND'
      );
      await closeWellfoundSuccessOverlay();

      return true;
    }

    // ============================================================
    // NEVER CLAIM SUCCESS IF SEND BUTTON STILL EXISTS
    // ============================================================

    const sendStillVisible =
      findRealSendButton();

    if (
      sendStillVisible
    ) {

      // One strict retry: radios may not be committed after textarea updates.
      await forceComplianceAnswers();
      await sleep(200);

      const retrySend = findRealSendButton(panel, false) || findRealSendButton();
      if (retrySend && !(retrySend.disabled || retrySend.getAttribute('aria-disabled') === 'true')) {
        log('  ↻ retrying submit after forced compliance selection');
        retrySend.click();

        const confirmedAfterRetry = await waitFor(
          () => hasSubmissionConfirmation(),
          6000
        );

        if (confirmedAfterRetry) {
          log('  ✅ APPLICATION CONFIRMED BY WELLFOUND (retry submit)');
          await closeWellfoundSuccessOverlay();
          return true;
        }
      }

      const stillMissing = listMissingRequired();
      if (stillMissing.length) {
        log(`  ⚠ submit blocked by required fields (${stillMissing.length})`);
        for (const m of stillMissing.slice(0, 5)) {
          log(`    • ${m}`);
        }
      }

      log(
        '  ❌ submission failed — Send application is still visible'
      );

      return false;
    }

    // ============================================================
    // PANEL DISAPPEARED WITHOUT CONFIRMATION
    // ============================================================

    log(
      '  âš  application panel disappeared, but Wellfound gave no confirmation'
    );

    const confirmedAfterPanelClose = await waitFor(
      () => hasSubmissionConfirmation(),
      5000
    );

    if (confirmedAfterPanelClose) {
      log('  ✅ APPLICATION CONFIRMED BY WELLFOUND (post-close check)');
      await closeWellfoundSuccessOverlay();
      return true;
    }

    // Safety fallback for Wellfound variants where the success sheet is ephemeral:
    // if the application panel is gone and no submit button is visible anymore,
    // treat this as submitted to avoid a false failure loop.
    const panelStillOpen = !!findRealApplicationPanel();
    const sendAfterClose = findRealSendButton();
    if (!panelStillOpen && !sendAfterClose) {
      log('  ✅ submission assumed successful (panel closed and submit button gone)');
      await closeWellfoundSuccessOverlay();
      return true;
    }

    return false;
  }
  if (window.__aaSkipJob) {
    window.__aaSkipJob = false;
    log('⏭ manually skipped current job');
    return false;
  }
  if (window.__aaSkipJob) {
    window.__aaSkipJob = false;
    log('⏭ manually skipped current job');
    return false;
  }
  // ======================= MAIN LOOP =======================
  // const titleOk = (t) => {
  //   const lower = t.toLowerCase();
  //   return CONFIG.TITLE_KEYWORDS.some((k) => lower.includes(k)) &&
  //     !CONFIG.TITLE_BLOCKLIST.some((k) => lower.includes(k));
  // };
  const titleOk = (t) => {
    const lower = t.toLowerCase();

    return CONFIG.TITLE_KEYWORDS.some((k) => lower.includes(k.toLowerCase())) &&
      !CONFIG.TITLE_BLOCKLIST.some((k) => lower.includes(k.toLowerCase()));
  };

  // Check experience requirements from the job card/description.
  // Only reject explicit requirements above our target.
  const experienceOk = (text) => {
    if (!text) return true;

    const normalized = text.replace(/\s+/g, ' ');

    return !(
      CONFIG.EXPERIENCE_BLOCKLIST.some((pattern) => pattern.test(normalized)) ||
      /(?:minimum|preferred|requires?|experience).*?(?:\b(?:10|11|12|13|14|15|20)\+?\s*(?:-|to\s+)?years?\b|\b(?:10|11|12|13|14|15|20)\+\b)/i.test(normalized) ||
      /\b(?:10|11|12|13|14|15|20)\+?\s*(?:-|to\s+)?years?\s*(?:in|of)?\s*(?:engineering|software|product|backend|frontend|full[- ]stack|ai|ml|platform)/i.test(normalized)
    );
  };

  // 2026 UI: job cards no longer carry an Apply button. Clicking the job link opens
  // an SPA overlay (URL gains ?job_listing_slug=â€¦) with the "Apply to <Company>"
  // panel â€” a client-side route change, so this pasted script keeps running.
  function findJobRows() {
    const rows = [];
    for (const a of document.querySelectorAll('a[href*="/jobs/"]')) {
      // real job links look like /jobs/4491644-some-slug (nav "Jobs" link has no id)
      if (!/\/jobs\/\d/.test(a.getAttribute('href') || '')) continue;
      if (!visible(a) || a.textContent.trim().length < 4) continue;
      let row = a.closest('div');
      for (let i = 0; i < 5 && row && row.textContent.trim().length < 60; i++) row = row.parentElement;
      row = row || a.parentElement;
      // already applied? the card shows an "Applied" stamp
      if (SELECTORS.alreadyApplied.test([...row.querySelectorAll('button, span')].map((e) => e.textContent.trim()).find((t) => /^applied$/i.test(t)) || '')) continue;
      // only fresh jobs: skip anything posted more than 14 days ago (cards without a
      // "posted X ago" stamp are kept â€” wellfound delists stale jobs anyway)
      const posted = row.textContent.match(/posted[: ] ?(?:about )?(\d+)\+? ?(day|week|month)s? ago/i);
        if (posted) {
          const n = +posted[1];
          const unit = posted[2].toLowerCase();
          const days = unit === 'day' ? n : unit === 'week' ? n * 7 : n * 30;
          if (days > 45) continue;
        }
      const company = (row.querySelector('img[alt*="logo" i]')?.alt || '')
        .replace(/company logo/i, '').trim();
      const salary = (row.textContent.match(/(?:â‚¹|\$|â‚¬)\s?[\d.,k]+\s?(?:[â€“-]\s?(?:â‚¹|\$|â‚¬)?\s?[\d.,k]+)?k?/i) || [''])[0].trim();
      // rows.push({ href: a.href, title: cleanTitle(a.textContent), company, salary, linkEl: a });
      rows.push({
        href: a.href,
        title: cleanTitle(a.textContent),
        company,
        salary,
        cardText: row.textContent || '',
        linkEl: a
      });
    }
    return rows;
  }

  // When the current page runs out of matching jobs, hop to these Wellfound
  // search pages (remote + all-location role pages). Navigation uses Wellfound's
  // own Next.js router (window.next.router) â€” a client-side route change, so
  // this pasted script KEEPS RUNNING across pages. A bad/404 slug just yields
  // zero jobs and we move on to the next one.
  // /role/* pages render empty for logged-in sessions (verified Jul 2026) â€” the
  // /jobs feed with infinite scroll is the real inventory. /location/india as backup.
  // '/location/india' removed: job clicks there are FULL navigations (no SPA
  // overlay) â€” the script dies, gets re-injected each page, and phantom-applied
  // to the same jobs in a loop (2026-08-06). /jobs infinite scroll only.
  const SEARCH_PAGES = ['/jobs'];
  // after a full page load onto one of the search pages, resume from the NEXT one â€”
  // restarting at 0 would reload the same page forever
  let searchIdx = SEARCH_PAGES.indexOf(location.pathname) + 1;

  async function goToNextSearchPage() {
    if (searchIdx >= SEARCH_PAGES.length) return false;
    const url = SEARCH_PAGES[searchIdx++];
    log(`ðŸŒ Moving to next search page: ${url}`);
    if (window.next?.router?.push) {
      window.next.router.push(url);
    } else {
      log('âš  SPA router not found â€” doing a full page load. PASTE THE SCRIPT AGAIN after the page loads to continue.');
      location.href = url;
      return false; // script dies on full reload; user re-pastes
    }
    await sleep(6000); // let the new results render
    window.scrollTo(0, 400);
    return true;
  }

  // ======================= LOCATION FIX (profile location auto-update) =======================
  // Some companies reject applications "from your current location". When that happens we
  // rewrite the profile location (the "Where are you based?" combobox on /profile/edit) to
  // match the job, then come back to /jobs and retry. Guarded per-job + per-day so it can
  // never loop. On any failure we degrade to the old behaviour (skip the job).

  function extractJobLocation(cardText) {
    const text = (cardText || '').replace(/\s+/g, ' ');
    let m;
    m = text.match(/job location[:\s]+([A-Za-z][A-Za-z .,'-]{1,40})/i);
    if (m) return trimCity(m[1]);
    m = text.match(/hires remotely in[:\s]+([A-Za-z][A-Za-z .,'-]{1,40})/i);
    if (m) return trimCity(m[1]);
    m = text.match(/remote\s*\([^)]*\)\s*[•·]\s*([A-Za-z][A-Za-z .,'-]{1,40})/i);
    if (m) return trimCity(m[1]);
    m = text.match(/remote\s*\(([^)]+)\)/i);
    if (m) return trimCity(m[1]);
    // Bare "Remote (United States)" on cards that lack the "Remote •" separator
    m = text.match(/remote\s*\(\s*(united states|usa|us)\s*\)/i);
    if (m) return 'San Francisco'; // US-remote roles accept SF-based profiles
    return '';
  }

  // Card/page text runs the city straight into the next label ("San Francisco Remote
  // Work Policy..."); cut the capture at the first known section label.
  function trimCity(raw) {
    const stop = (raw || '').search(/\b(remote work policy|remote work|hires remotely|visa sponsorship|relocation|skills|about the job|about the role|what you|what success|posted|recruiter recently|employees|job type|preferred timezone|timezones|company size|benefits)\b/i);
    const head = (stop > 0 ? raw.slice(0, stop) : raw).split(/[•·|]/)[0];
    return head.replace(/[|\s,]+$/, '').trim();
  }

  // Same-origin fetch of the full job page; its "Job Location" / "Hires remotely in"
  // sections survive in the SSR HTML, so stripping tags yields parseable text.
  async function fetchJobLocation(jobUrl) {
    try {
      const res = await fetch(jobUrl, { credentials: 'include' });
      const text = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      return extractJobLocation(text);
    } catch (e) {
      log('📍 job page fetch failed:', e.message);
      return '';
    }
  }

  // The location field is a Downshift combobox; its id changes every page load, so anchor on
  // the "Where are you based?" title and walk up to the nearest [role="combobox"].
  function findLocationCombobox() {
    const titles = [...document.querySelectorAll('div')].filter((d) =>
      /^where are you based\??$/i.test((d.textContent || '').replace(/\s+/g, ' ').trim()) &&
      d.children.length === 0
    );
    for (const t of titles) {
      let node = t;
      for (let i = 0; i < 8 && node; i++) {
        const cb = node.querySelector ? node.querySelector('[role="combobox"]') : null;
        if (cb) return cb;
        node = node.parentElement;
      }
    }
    return null;
  }

  async function updateProfileLocation(targetLoc) {
    if (!targetLoc) return false;
    const cb = await waitFor(() => findLocationCombobox(), 12000);
    if (!cb) { log('  ✗ location combobox not found'); return false; }
    cb.scrollIntoView({ block: 'center' });
    await sleep(400);

    // The display-only combobox ignores click/keyboard; the ✕ clear button is the
    // only entry point — clicking it swaps the control to an editable input
    // (id "downshift-0-input", placeholder "e.g. San Francisco"). Verified live.
    let input = cb.querySelector('input');
    if (!input) {
      const clearBtn = cb.querySelector('[class*="close" i]');
      if (!clearBtn) { log('  ✗ no clear button on location combobox'); return false; }
      clearBtn.click();
      input = await waitFor(() => cb.querySelector('input'), 6000);
    }
    if (!input) { log('  ✗ no editable input appeared after clearing location'); return false; }

    input.focus();
    setValue(input, '');
    await sleep(200);
    setValue(input, targetLoc);
    await sleep(3000); // LocationTagAutocompleteField query + render

    // Pick the best match from the visible options; prefer one STARTING with the
    // target ("Syracuse, New York" over "Province of Syracuse").
    const lower = targetLoc.toLowerCase();
    const option = await waitFor(() => {
      const opts = [...document.querySelectorAll('[role="option"]')]
        .filter((o) => (o.textContent || '').trim().length > 1);
      if (!opts.length) return null;
      return opts.find((o) => o.textContent.toLowerCase().startsWith(lower)) ||
        opts.find((o) => o.textContent.toLowerCase().includes(lower)) || opts[0];
    }, 8000);
    if (!option) { log(`  ✗ no autocomplete option for "${targetLoc}"`); return false; }

    // Keyboard selection commits through Downshift's onChange (a plain option
    // click was observed NOT to fire ProfileSavePrimaryLocation).
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(1500);
    // Fallback: real click if the synthetic keys didn't commit.
    if (findLocationCombobox()?.querySelector('input')) {
      option.click();
    }
    await sleep(3000); // ProfileSavePrimaryLocation fires on selection; no Save button exists

    const shown = findLocationCombobox()?.textContent || '';
    if (!shown.toLowerCase().includes(lower.split(',')[0])) {
      log(`  ⚠ location display does not reflect "${targetLoc}" yet: "${shown.replace(/\s+/g, ' ').trim().slice(0, 60)}"`);
      return false;
    }
    log(`  ✓ profile location set to "${shown.replace(/\s+/g, ' ').trim()}"`);
    return true;
  }

  // Resume point: the runner hands us a pending location fix via __APPLY_CONFIG
  // (this site/profile wipes localStorage on every load, so state must ride
  // through the Node side).
  if (((__CFG.locFix) || {}).loc) {
    if (/\/profile\/edit/.test(location.pathname)) {
      const locFix = __CFG.locFix;
      log(`📍 Location fix: updating profile location to "${locFix.loc}"`);
      await sleep(3000); // let the profile-edit page fully hydrate
      const ok = await updateProfileLocation(locFix.loc);
      if (ok && locFix.jobHref) console.log('AA_SEEN_REMOVE ' + locFix.jobHref);
      console.log('AA_LOC_DONE ' + (ok ? 'ok' : 'failed'));
      log(`📍 Location fix ${ok ? 'succeeded' : 'FAILED'} — returning to /jobs`);
      await sleep(1500);
      location.href = 'https://wellfound.com/jobs';
      return; // this instance stops; the re-injection on /jobs resumes applying
    }
  }

  let applied = 0;
  let locationFixUsedThisRun = false; // set when a job forced a profile-location change
  const seen = new Set();

  // The runner re-injects this script every time it finishes, and each injection
  // gets a fresh seen-set; persisting hrefs stops blocked/skipped jobs from being
  // retried in an endless loop.
  // Seen-jobs restore: localStorage works within one browser session but this
  // profile wipes it on relaunch, so the runner ALSO passes today's hrefs in
  // window.__APPLY_CONFIG.seenHrefs (persisted to .wellfound-seen-<site>.json).
  ((__CFG.seenHrefs) || []).forEach((h) => h && seen.add(h));
  try {
    const storedSeen = JSON.parse(localStorage.getItem('__aaSeenJobs') || '{}');
    if (storedSeen.date === new Date().toDateString()) {
      (storedSeen.hrefs || []).forEach((h) => seen.add(h));
    }
  } catch (_) { }
  if (seen.size) log(`↩ restored ${seen.size} previously-seen jobs`);
  const persistSeen = () => {
    try {
      localStorage.setItem('__aaSeenJobs', JSON.stringify({ date: new Date().toDateString(), hrefs: [...seen].slice(-500) }));
    } catch (e) {
      log('⚠ seen persist failed:', e.message);
    }
  };

  // Reset location-fix counter daily so a new run gets fresh attempts
  const locFixDate = localStorage.getItem('__aaLocFixDate') || '';
  if (locFixDate !== new Date().toDateString()) {
    localStorage.setItem('__aaLocFixDate', new Date().toDateString());
    localStorage.setItem('__aaLocFixCount', '0');
  }

  log(`Starting. DRY_RUN=${CONFIG.DRY_RUN}, max=${CONFIG.MAX_APPLICATIONS}`);
  log('Tip: keep this tab focused and do not navigate away.');
  await sleep(5000); // job cards render after load â€” don't declare the page empty too early

  while (applied < CONFIG.MAX_APPLICATIONS) {
    const allRows = findJobRows();
    // const jobs = allRows.filter((j) => !seen.has(j.href) && titleOk(j.title));
    const jobs = allRows.filter((j) =>
      !seen.has(j.href) &&
      titleOk(j.title) &&
      // experienceOk(j.title + ' ' + j.company)
      experienceOk(j.cardText || (j.title + ' ' + j.company))
    );

    // if (!jobs.length) {
    //   // Diagnostics so failures are debuggable from the console output
    //   log(`(this page: ${allRows.length} job cards found, 0 match filters` +
    //     (allRows.length ? ` â€” sample titles: ${allRows.slice(0, 3).map((j) => `"${j.title}"`).join(', ')}` : '') + ')');

    //   // Try to load more results on this page first
    //   const more = findButtonByText(document, /load more|show more/i); // "next" is too generic â€” could hit a form's Next button
    //   if (more) { more.click(); await sleep(3000); continue; }
    //   // infinite-scroll feed: keep scrolling â€” new cards load in batches
    //   let grew = false;
    //   for (let s = 0; s < 6 && !grew; s++) {
    //     window.scrollTo(0, document.body.scrollHeight);
    //     await sleep(3000);
    //     grew = findJobRows().some((j) => !seen.has(j.href) && titleOk(j.title));
    //   }
    //   if (grew) continue;

    //   // Page exhausted â†’ search globally across role pages
    //   if (await goToNextSearchPage()) continue;
    //   log('All search pages exhausted. Done.');
    //   break;
    // }

    // let grew = false;

    // for (let s = 0; s < 3; s++) {
    //   const before = findJobRows().length;

    //   window.scrollTo(
    //     0,
    //     document.body.scrollHeight
    //   );

    if (!jobs.length) {

      let grew = false;

      for (let s = 0; s < 10; s++) {
        const before = findJobRows().length;

        window.scrollTo(
          0,
          document.body.scrollHeight
        );

        await sleep(3000);

        const rows = findJobRows();

        const eligible = rows.some(
          (j) =>
            !seen.has(j.href) &&
            titleOk(j.title) &&
            experienceOk(j.title + ' ' + j.company)
        );

        const after = rows.length;

        log(
          `  scroll ${s + 1}/3: ${before} -> ${after} cards, eligible=${eligible}`
        );

        if (eligible) {
          grew = true;
          log('  ✓ eligible job found in loaded cards');
          break;
        }

        if (after === before) {
          break;
        }
      }

      if (grew) {
        continue;
      }

      log(
        'No eligible jobs found after 10 scrolls. Search exhausted.'
      );

      break;
    }

    //   await sleep(3000);

    //   const rows = findJobRows();

    //   // const eligible = rows.some(
    //   //   (j) =>
    //   //     !seen.has(j.href) &&
    //   //     titleOk(j.title) &&
    //   //     experienceOk(j.title + ' ' + j.company)
    //   // );

    //   const eligible = rows.some(
    //     (j) =>
    //       !seen.has(j.href) &&
    //       titleOk(j.title) &&
    //       experienceOk(j.title + ' ' + j.company)
    //   );

    //   const after = rows.length;

    //   log(
    //     `  scroll ${s + 1}/3: ${before} -> ${after} cards, eligible=${eligible}`
    //   );

    //   if (eligible) {
    //     grew = true;
    //     break;
    //   }

    //   if (eligible) {
    //     log('  ✓ eligible job found in loaded cards');
    //     break;
    //   }

    //   if (after === before) {
    //     break;
    //   }
    // }

    // if (grew) {
    //   continue;
    // }

    // log(
    //   'No eligible jobs found after scrolling. Ending this search batch.'
    // );

    // break;

    const job = jobs[0];
    seen.add(job.href);
    persistSeen();
    console.log('AA_SEEN ' + job.href); // runner persists this across restarts
    log(`â–¶ Applying: ${job.title} @ ${job.company || '?'} | ${job.href} | ${job.salary || ''}`);
    job.linkEl.scrollIntoView({ block: 'center' });
    await sleep(500);
    job.linkEl.click(); // SPA overlay opens with the "Apply to <Company>" panel
    await sleep(3000);

    const ok = await fillAndSubmit(job.company || getCompany(), job.title, job.cardText || '', job.href);
    if (ok) {
      applied++;
      log(`  progress: ${applied}/${CONFIG.MAX_APPLICATIONS}`);
    }
    // close the job overlay (top-right âœ•) so the next card is clickable
    await sleep(1000);
    (document.querySelector('button[aria-label="Close" i], [class*="Modal" i] button[class*="close" i]') ||
      findButtonByText(document, /^Ã—$|^âœ•$/))?.click();
    await sleep(1000);
    await humanDelay();
  }

  // End-of-run hygiene: if a job forced the profile location elsewhere today,
  // hand the runner a final fix request so the resume point puts it back to
  // the home location before the run fully ends. locRestoreNeeded covers the
  // case where the fix (and its page navigation) happened in an EARLIER
  // injection of this same runner process.
  if ((locationFixUsedThisRun || __CFG.locRestoreNeeded) && CONFIG.HOME_LOCATION) {
    console.log('AA_LOC_FIX ' + JSON.stringify({ loc: CONFIG.HOME_LOCATION }));
    log(`📍 restoring profile location to "${CONFIG.HOME_LOCATION}"`);
    await sleep(800);
    location.href = 'https://wellfound.com/profile/edit';
    return; // resume point restores, returns to /jobs; that scan then finishes for good
  }

  // Marks this injection done so the runner's idle re-injection becomes a no-op
  // instead of restarting the same exhausted scan forever.
  window.__aaFinished = true;

  log(`Finished. ${CONFIG.DRY_RUN ? 'DRY RUN â€” nothing was actually sent. Set CONFIG.DRY_RUN = false and re-run to apply for real.' : `Applied to ${applied} jobs.`}`);
})();


