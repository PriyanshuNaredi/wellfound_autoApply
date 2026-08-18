/*
 * Gemini cover-letter generator for Wellfound Auto Apply
 * Model: gemini-3.1-flash-lite
 */

async function generateGeminiCoverLetter({
  apiKey,
  company,
  title,
  jobDescription,
  resume
}) {
  if (!apiKey) {
    console.log("[gemini] No GEMINI_KEY configured. Using fallback cover letter.");
    return null;
  }

  const model = "gemini-3.1-flash-lite";

  const prompt = `
You are writing a concise, highly personalized job application cover letter.

Candidate resume:
${resume}

Job title:
${title}

Company:
${company}

Job description:
${jobDescription}

Write a personalized application message for this specific job.

Requirements:
- Write 150 to 200 words.
- Prioritize exactly 2 or 3 experiences from the resume that directly match the JD.
- Do not list technologies unless they are relevant to the JD.
- Do not mention work authorization, location, OPT, salary, or availability unless the JD/application specifically asks about it.
- Do not claim "scalable", "production", "high-performance", "expert", "deep experience", or similar qualifications unless the resume explicitly supports the claim.
- Do not repeat the resume as a list.
- Make the letter sound like a technically strong early-career engineer writing directly to the company.
- 180 to 260 words maximum.
- Natural human writing.
- Do not sound like AI.
- Do not mention that you are an AI.
- Do not invent experience, technologies, employers, education, metrics, or achievements.
- Only use information supported by the resume.
- Prioritize the 2-4 strongest matches between the resume and the job description.
- Mention the company and exact role naturally.
- Explain briefly why the candidate is interested in this particular role.
- Focus on engineering impact and relevant technical experience.
- Avoid generic phrases such as "I am excited to apply" as the opening sentence.
- Do not use em dashes.
- Do not include a subject line.
- Do not include "Dear Hiring Manager".
- Do not include a signature.
- Return ONLY the cover-letter body.
`;

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        model +
        ":generateContent?key=" +
        encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.65,
            maxOutputTokens: 700
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.log(
        `[gemini] API error ${response.status}: ${errorText.slice(0, 500)}`
      );
      return null;
    }

    const data = await response.json();

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p?.text || "")
        .join("")
        .trim();

    if (!text) {
      console.log("[gemini] Empty response. Using fallback.");
      return null;
    }

    return text
      .replace(/^```(?:text|markdown)?/i, "")
      .replace(/```$/i, "")
      .trim();

  } catch (err) {
    console.log(`[gemini] Request failed: ${err.message}`);
    return null;
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    generateGeminiCoverLetter
  };
}
