import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

const MODEL_ID = "Llama-3.2-1B-Instruct-q4f32_1-MLC";
const MIN_SCORE = 0.15;
const TOP_K = 5;

let kb = [];
let engine = null;

// =========================
// LOAD KB
// =========================
async function loadKB() {
  const res = await fetch("./kb.json");
  return await res.json();
}

// =========================
// NORMALIZE
// =========================
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s%€.,]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// =========================
// SCORE CHUNK
// =========================
function scoreChunk(question, chunkText) {
  const qWords = new Set(normalize(question).split(" "));
  const cWords = new Set(normalize(chunkText).split(" "));

  let hits = 0;
  for (const w of qWords) {
    if (w.length > 2 && cWords.has(w)) hits++;
  }

  return hits / Math.max(qWords.size, 1);
}

// =========================
// SEARCH CHUNKS
// =========================
function searchChunks(question, kb, topK = TOP_K) {
  return kb
    .map(chunk => ({
      ...chunk,
      score: scoreChunk(question, chunk.text || "")
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// =========================
// SPLIT SENTENCES
// =========================
function sentenceSplit(text) {
  return text.split(/(?<=[.!?])\s+/);
}

// =========================
// NUMERIC FILTER
// =========================
function isNumericSentence(s) {
  s = s.toLowerCase();

  const hasNumber = /\d/.test(s);
  const hasMoney = s.includes("€") || s.includes("euro");
  const hasPercent = s.includes("%");
  const hasKeywords = [
    "spesa", "costo", "pil", "finanziamento",
    "ricavi", "disavanzo", "avanzo"
  ].some(k => s.includes(k));

  return hasNumber && (hasMoney || hasPercent || hasKeywords);
}

// =========================
// SCORE SENTENCE
// =========================
function scoreSentence(question, sentence) {
  const qWords = new Set(normalize(question).split(" "));
  const sWords = new Set(normalize(sentence).split(" "));

  let hits = 0;
  for (const w of qWords) {
    if (w.length > 2 && sWords.has(w)) hits++;
  }

  let score = hits / Math.max(qWords.size, 1);

  if (/\d/.test(sentence)) score += 0.2;
  if (sentence.includes("%")) score += 0.15;
  if (sentence.includes("€")) score += 0.15;

  if (["spesa", "costo", "pil"].some(k => sentence.toLowerCase().includes(k))) {
    score += 0.1;
  }

  return score;
}

// =========================
// BUILD CONTEXT (🔥 MIGLIORATO)
// =========================
function buildContext(question, chunks) {
  let candidates = [];

  chunks.forEach(chunk => {
    const sentences = sentenceSplit(chunk.text || "");

    sentences.forEach((s, i) => {
      s = s.trim();
      if (!s) return;

      const sc = scoreSentence(question, s);

      // filtro meno aggressivo
      if (!isNumericSentence(s) && sc < 0.15) return;

      let context = s;

      if (i > 0) context = sentences[i - 1] + " " + context;
      if (i < sentences.length - 1) context = context + " " + sentences[i + 1];

      candidates.push({
        text: context,
        section: chunk.section,
        score: sc
      });
    });
  });

  if (!candidates.length) {
    // fallback
    return chunks[0].text.slice(0, 800);
  }

  candidates.sort((a, b) => b.score - a.score);

  return candidates
    .slice(0, 2)
    .map(c => `[Sezione: ${c.section}]\n${c.text}`)
    .join("\n\n");
}

// =========================
// PROMPT
// =========================
function buildPrompt(question, context) {
  return `
Sei un assistente che risponde SOLO usando il contesto.

REGOLE:
- Non inventare nulla
- Se non trovi risposta: "Informazione non presente nel documento"
- Se fuori tema: "Domanda fuori ambito"
- Rispondi in italiano

DOMANDA:
${question}

CONTESTO:
${context}

RISPOSTA:
`.trim();
}

// =========================
// ANSWER
// =========================
async function answer(question) {
  const results = searchChunks(question, kb);

  if (!results.length || results[0].score < MIN_SCORE) {
    return "Domanda fuori ambito";
  }

  const context = buildContext(question, results);
  const prompt = buildPrompt(question, context);

  const completion = await engine.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 120
  });

  return completion.choices[0].message.content;
}

// =========================
// UI
// =========================
function addMessage(text, role) {
  const chat = document.getElementById("chat");
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  chat.appendChild(div);
}

function setStatus(t) {
  document.getElementById("status").textContent = t;
}

// =========================
// INIT
// =========================
async function init() {
  setStatus("Carico KB...");
  kb = await loadKB();

  setStatus("Carico modello...");
  engine = await CreateMLCEngine(MODEL_ID);

  setStatus("Pronto!");
}

document.getElementById("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const input = document.getElementById("question");
  const q = input.value.trim();
  if (!q) return;

  addMessage(q, "user");
  input.value = "";

  setStatus("Rispondo...");

  const reply = await answer(q);

  addMessage(reply, "bot");
  setStatus("Pronto");
});

await init();
