// Minimal worker - just serves static assets
// Assets are handled automatically by the assets config

export default {
  async fetch(request, env) {
    // This worker doesn't need to do anything
    // Static assets are served automatically
    return new Response('Not found', { status: 404 });
  }
};
