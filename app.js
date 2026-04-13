import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

const MODEL_ID = "Llama-3.2-1B-Instruct-q4f32_1-MLC";
const MIN_SCORE = 0.2;
const TOP_K = 3;

let kb = [];
let engine = null;

async function loadKB() {
  const res = await fetch("./kb.json");
  if (!res.ok) throw new Error("Impossibile caricare kb.json");
  return await res.json();
}

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreChunk(question, chunkText) {
  const qWords = new Set(normalize(question).split(" "));
  const cWords = new Set(normalize(chunkText).split(" "));
  let hits = 0;

  for (const w of qWords) {
    if (w.length > 2 && cWords.has(w)) hits++;
  }

  return hits / Math.max(qWords.size, 1);
}

function searchChunks(question, kb, topK = TOP_K) {
  return kb
    .map(chunk => ({
      ...chunk,
      score: scoreChunk(question, chunk.text || "")
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function addMessage(text, role) {
  const chat = document.getElementById("chat");
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

function buildPrompt(question, chunks) {
  const context = chunks.map(
    c => `[Sezione: ${c.section || "N/D"}]\n${c.text}`
  ).join("\n\n");

  return `
Sei un assistente specializzato esclusivamente nel documento fornito.

Regole obbligatorie:
- Rispondi solo usando il contesto.
- Non usare conoscenze esterne.
- Se il contesto non basta, rispondi esattamente: "Informazione non presente nel documento".
- Se la domanda è fuori topic, rispondi esattamente: "Domanda fuori ambito".
- Rispondi in italiano in modo chiaro e breve.
- Quando possibile, cita la sezione tra parentesi.

DOMANDA:
${question}

CONTESTO:
${context}

RISPOSTA:
`.trim();
}

async function answerWithLLM(question) {
  const results = searchChunks(question, kb, TOP_K);

  if (!results.length || results[0].score < MIN_SCORE) {
    return "Domanda fuori ambito";
  }

  const prompt = buildPrompt(question, results);

  const completion = await engine.chat.completions.create({
    messages: [
      { role: "user", content: prompt }
    ],
    temperature: 0,
    max_tokens: 180
  });

  const text = completion.choices?.[0]?.message?.content?.trim();
  return text || "Informazione non presente nel documento";
}

async function init() {
  setStatus("Carico kb.json...");
  kb = await loadKB();

  setStatus("Carico il modello nel browser... il primo avvio può richiedere un po'.");
  engine = await CreateMLCEngine(MODEL_ID);

  setStatus("Pronto.");
}

document.getElementById("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const input = document.getElementById("question");
  const sendBtn = document.getElementById("sendBtn");
  const question = input.value.trim();
  if (!question) return;

  addMessage(question, "user");
  input.value = "";
  input.disabled = true;
  sendBtn.disabled = true;
  setStatus("Sto elaborando...");

  try {
    const reply = await answerWithLLM(question);
    addMessage(reply, "bot");
    setStatus("Pronto.");
  } catch (err) {
    console.error(err);
    addMessage("Errore nel modello o nel caricamento.", "bot");
    setStatus("Errore.");
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
});

await init();
