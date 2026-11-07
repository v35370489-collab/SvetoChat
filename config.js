// {
  "hosting": { "public": "public", "ignore": ["firebase.json","**/.*"], "cleanUrls": true },
  "functions": [{ "source": "functions", "codebase": "default" }],
  "firestore": { "rules": "firestore.rules" },
  "storage": { "rules": "storage.rules" }
}
// Firebase Console → ⚙ Project settings → Your apps → Web app → SDK setup and configuration
window.SC_CFG={
  apiKey:"19179282726",
  authDomain:"",
  projectId:"",
  storageBucket:"",
  messagingSenderId:"",
  appId:"",
  region:"us-central1",          // регион Cloud Functions (как в functions/index.js)
  owner:"you@example.com"         // почта владельца: он создаст канал «Создатель» и будет им управлять
};
