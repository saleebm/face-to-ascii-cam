// server.ts — Bun.serve with HTML import.
// Bun bundles index.html's <script> tags (including TypeScript) automatically.
// Docs: https://bun.com/docs/bundler/fullstack
import index from "./index.html";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": index,
  },
  // Fallback so favicon etc. don't 500.
  fetch() {
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`▶  face-ascii-bun running at ${server.url}`);
console.log(`   Note: webcam access requires localhost OR https.`);
