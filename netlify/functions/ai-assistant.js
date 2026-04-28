function buildDocumentContext(modules) {
  let remainingChars = 85000;

  return modules
    .map((module) => {
      const resources = (module.resources || [])
        .map((resource) => {
          const text = String(resource.text || "").slice(0, Math.max(0, Math.min(remainingChars, 24000)));
          remainingChars -= text.length;

          return `DOCUMENT
Titre: ${resource.title || resource.fileName || "PDF"}
Fichier: ${resource.fileName || "non précisé"}
Texte extrait:
${text || "[Aucun texte extrait pour ce document]"}`;
        })
        .join("\n\n");

      return `MODULE
Titre: ${module.title || "Module non précisé"}
Semestre: ${module.semester || "Non précisé"}
Résumé du module: ${module.summary || ""}
Objectifs pédagogiques: ${(module.objectives || []).join("; ")}
Chapitres: ${(module.chapters || []).join("; ")}

${resources}`;
    })
    .join("\n\n====================\n\n")
    .slice(0, 90000);
}

function getTaskInstruction(task) {
  const tasks = {
    summary:
      "Produis un résumé approfondi du document : idée générale, concepts essentiels, structure du cours, points à retenir, définitions importantes, exemples, et points de vigilance pour l'examen.",
    quiz:
      "Crée un quiz pédagogique solide : 10 questions au minimum, mélange QCM, questions courtes et questions d'analyse. Ajoute les réponses attendues et une courte justification pour chaque réponse.",
    qa:
      "Réponds à la question de façon précise à partir des documents. Cite les parties ou notions du document utilisées. Si une réponse n'est pas dans le document, dis-le clairement.",
    study_plan:
      "Crée un plan de révision détaillé : ordre de travail, durée recommandée, concepts prioritaires, exercices à faire, questions d'auto-évaluation, et méthode de mémorisation.",
    explanation:
      "Explique le cours simplement puis progressivement : niveau débutant, puis niveau master. Utilise des exemples concrets de management et termine par une mini-synthèse.",
    chat:
      "Réponds comme un assistant pédagogique avancé. Structure la réponse avec des titres courts et des listes utiles.",
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
    const documentContext = buildDocumentContext(modules);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
