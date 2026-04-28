function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/Page\s+(\d+)/gi, "\n\n[Page $1]\n")
    .trim();
}

function getDocuments(modules) {
  return modules.flatMap((module) =>
    (module.resources || [])
      .filter((resource) => cleanText(resource.text).length > 120)
      .map((resource) => ({
        moduleTitle: module.title || "Module non précisé",
        semester: module.semester || "Non précisé",
        moduleSummary: module.summary || "",
        objectives: module.objectives || [],
        chapters: module.chapters || [],
        title: resource.title || resource.fileName || "Document",
        fileName: resource.fileName || "non précisé",
        text: cleanText(resource.text),
      }))
  );
}

function buildDocumentContext(modules) {
  const documents = getDocuments(modules);
  let remainingChars = 65000;

  return documents
    .map((document, index) => {
      const text = document.text.slice(0, Math.max(0, Math.min(remainingChars, 22000)));
      remainingChars -= text.length;

      return `DOCUMENT ${index + 1}
Module: ${document.moduleTitle}
Semestre: ${document.semester}
Titre du document: ${document.title}
Fichier: ${document.fileName}
Résumé du module: ${document.moduleSummary}
Objectifs du module: ${document.objectives.join("; ")}
Chapitres du module: ${document.chapters.join("; ")}

Texte extrait du PDF:
${text}`;
    })
    .join("\n\n====================\n\n");
}

function getTaskInstruction(task) {
  const tasks = {
    summary: `
MISSION: produire un vrai résumé pédagogique à partir du texte fourni.
FORMAT OBLIGATOIRE:
1. Titre du cours analysé
2. Résumé global en 8 à 12 lignes
3. Plan logique du document
4. Concepts clés avec définitions simples
5. Points importants à retenir pour l'examen
6. Exemples d'application en management ou organisation
7. Mini-fiche de révision finale
RÈGLES: base-toi sur le document. Si une information manque, écris "Non précisé dans le document".`,
    quiz: `
MISSION: créer un vrai quiz d'entraînement à partir du document fourni.
FORMAT OBLIGATOIRE:
1. Titre du quiz
2. Consignes
3. Partie A - 6 QCM avec 4 choix chacun
4. Partie B - 5 questions courtes
5. Partie C - 2 questions d'analyse ou cas pratiques
6. Corrigé complet: réponse correcte + justification courte pour chaque question
7. Barème proposé sur 20
RÈGLES: les questions doivent venir du document. Évite les questions trop générales.`,
    qa: `
MISSION: répondre précisément à la question à partir du document.
FORMAT: réponse directe, justification, notions utilisées, limites éventuelles du document.`,
    study_plan: `
MISSION: créer un plan de révision réaliste.
FORMAT: priorités, planning sur 4 jours, notions à mémoriser, exercices, auto-évaluation.`,
    explanation: `
MISSION: expliquer le cours clairement.
FORMAT: explication simple, explication niveau master, exemple concret, synthèse finale.`,
    chat: `
MISSION: aider l'étudiant à comprendre le document et le module.
FORMAT: réponse structurée avec titres courts, listes utiles et conseils concrets.`,
  };

  return tasks[task] || tasks.chat;
}

function extractOutputText(data) {
  if (data.output_text) return data.output_text;

  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.text) chunks.push(content.text);
    }
  }

  return chunks.join("\n") || "Aucune réponse générée.";
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Méthode non autorisée." }),
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "OPENAI_API_KEY n'est pas configurée dans Netlify." }),
    };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const task = payload.task || "chat";
    const question = payload.question || "";
    const modules = Array.isArray(payload.modules) ? payload.modules : [];
    const documents = getDocuments(modules);

    if (!documents.length) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({
          error:
            "Aucun texte exploitable n'a été trouvé. Réuploadez un PDF avec la dernière version du site pour permettre l'extraction du texte.",
        }),
      };
    }

    const documentContext = buildDocumentContext(modules);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5",
        max_output_tokens: task === "quiz" ? 3500 : 2600,
        instructions:
          "Tu es l'assistant IA avancé d'une plateforme de Master Leadership Managérial. Réponds toujours en français académique clair. Tu dois exploiter en priorité le texte extrait des PDF fournis. Ne fais pas semblant d'avoir lu un document si le texte ne contient pas l'information. Produis des réponses directement utilisables par des étudiants de master.",
        input: `${getTaskInstruction(task)}

DEMANDE DE L'UTILISATEUR:
${question}

DOCUMENTS À ANALYSER:
${documentContext}`,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: data.error?.message || "Erreur OpenAI." }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        answer: extractOutputText(data),
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || "Erreur serveur." }),
    };
  }
};
